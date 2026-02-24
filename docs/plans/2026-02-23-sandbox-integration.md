# Sandbox Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `node:fs` operations with Vercel Sandbox-backed operations so agents have an isolated filesystem in production.

**Architecture:** Tools remain static module-level exports. The `Sandbox` instance flows through the AI SDK's `experimental_context` mechanism from `generateText` → tool `execute` → `extractSandbox` → operations. Agents do not create sandboxes — they receive a `sandboxId` in their Inngest event data and connect via `Sandbox.get()`. Dedicated Inngest functions manage sandbox lifecycle.

**Tech Stack:** `@vercel/sandbox` ^1.6.0, AI SDK `experimental_context`, Inngest `NonRetriableError`, Zod 4 runtime validation

**Design doc:** `docs/plans/2026-02-23-sandbox-integration-design.md`

---

## Commit 1: `feat: sandbox-backed filesystem operations`

### Task 1: Create Sandbox Context Helper

**Files:**
- Create: `src/lib/agent/fs/context.ts`

**Step 1: Create `src/lib/agent/fs/context.ts`**

```typescript
import { Sandbox } from "@vercel/sandbox"
import * as errors from "@superbuilders/errors"
import * as logger from "@superbuilders/slog"
import { z } from "zod"

const ErrSandboxContext = errors.new("sandbox missing from tool context")

const sandboxContextSchema = z.object({
	sandbox: z.instanceof(Sandbox)
})

function extractSandbox(context: unknown): Sandbox {
	const parsed = sandboxContextSchema.safeParse(context)
	if (!parsed.success) {
		logger.error("sandbox context extraction failed", { error: parsed.error })
		throw ErrSandboxContext
	}
	return parsed.data.sandbox
}

export { ErrSandboxContext, extractSandbox }
```

---

### Task 2: Rewrite Operations to Use Sandbox

**Files:**
- Rewrite: `src/lib/agent/fs/operations.ts`

**Step 1: Replace `src/lib/agent/fs/operations.ts` with sandbox-backed implementation**

Delete all existing content and replace with:

```typescript
import type { Sandbox } from "@vercel/sandbox"
import * as errors from "@superbuilders/errors"
import * as logger from "@superbuilders/slog"

const MAX_FILE_SIZE = 100 * 1024
const MAX_GLOB_RESULTS = 1000
const MAX_GREP_RESULTS = 100

const ErrNotFound = errors.new("not found")
const ErrNotAFile = errors.new("path is not a file")
const ErrNotADirectory = errors.new("path is not a directory")
const ErrTooLarge = errors.new("file too large for context")
const ErrTooManyResults = errors.new("too many results")
const ErrInvalidPattern = errors.new("invalid regex pattern")
const ErrWriteFailed = errors.new("write failed")
const ErrNoMatch = errors.new("old string not found in file")
const ErrAmbiguousMatch = errors.new("old string found multiple times without replaceAll")

interface ReadResult {
	content: string
	path: string
	size: number
	lineCount: number
}

async function read(sandbox: Sandbox, filePath: string): Promise<ReadResult> {
	const bufResult = await errors.try(sandbox.readFileToBuffer({ path: filePath }))
	if (bufResult.error) {
		logger.error("file read failed", { error: bufResult.error, path: filePath })
		throw errors.wrap(bufResult.error, `read '${filePath}'`)
	}

	if (bufResult.data === null) {
		logger.error("file not found", { path: filePath })
		throw errors.wrap(ErrNotFound, filePath)
	}

	const buf = bufResult.data

	if (buf.length > MAX_FILE_SIZE) {
		logger.error("file too large", { path: filePath, size: buf.length, maxSize: MAX_FILE_SIZE })
		throw errors.wrap(ErrTooLarge, `${filePath} (${buf.length} bytes, max ${MAX_FILE_SIZE})`)
	}

	const content = buf.toString("utf-8")
	const lineCount = content.length === 0 ? 0 : content.split("\n").length

	logger.debug("read complete", { path: filePath, size: buf.length, lineCount })

	return { content, path: filePath, size: buf.length, lineCount }
}

interface GlobMatch {
	path: string
	name: string
	size: number
}

interface GlobResult {
	pattern: string
	basePath: string
	matches: GlobMatch[]
}

// Supported patterns:
//   "**/*.ext"  → recursive search by extension (strips **/ prefix, uses -name)
//   "*.ext" / "*" → current directory only (no slash → -maxdepth 1 -name)
// Patterns with "/" that aren't "**/" prefixed are not supported — change dirPath instead.
function buildFindArgs(dirPath: string, pattern: string): string[] {
	if (pattern.startsWith("**/")) {
		const namePattern = pattern.slice(3)
		return [dirPath, "-type", "f", "-name", namePattern, "-printf", "%p\\t%s\\n"]
	}
	if (pattern.includes("/")) {
		logger.error("unsupported glob pattern", { pattern, dirPath })
		throw errors.wrap(ErrInvalidPattern, `pattern '${pattern}' contains '/'; use dirPath to scope instead`)
	}
	return [dirPath, "-maxdepth", "1", "-type", "f", "-name", pattern, "-printf", "%p\\t%s\\n"]
}

function parseGlobLine(line: string, basePath: string): GlobMatch {
	const tabIndex = line.lastIndexOf("\t")
	if (tabIndex === -1) {
		return { path: line, name: line, size: 0 }
	}
	const filePath = line.slice(0, tabIndex)
	const size = Number.parseInt(line.slice(tabIndex + 1), 10)
	const prefix = basePath.endsWith("/") ? basePath : `${basePath}/`
	const name = filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath
	return { path: filePath, name, size }
}

async function glob(sandbox: Sandbox, dirPath: string, pattern: string): Promise<GlobResult> {
	const args = buildFindArgs(dirPath, pattern)
	const cmdResult = await errors.try(sandbox.runCommand("find", args))
	if (cmdResult.error) {
		logger.error("glob command failed", { error: cmdResult.error, dirPath, pattern })
		throw errors.wrap(cmdResult.error, `glob '${pattern}' in '${dirPath}'`)
	}

	const cmd = cmdResult.data

	const stdoutResult = await errors.try(cmd.stdout())
	if (stdoutResult.error) {
		logger.error("glob stdout failed", { error: stdoutResult.error })
		throw errors.wrap(stdoutResult.error, "glob stdout")
	}

	const stderrResult = await errors.try(cmd.stderr())
	if (stderrResult.error) {
		logger.error("glob stderr failed", { error: stderrResult.error })
		throw errors.wrap(stderrResult.error, "glob stderr")
	}

	logger.debug("glob command complete", {
		cmdId: cmd.cmdId,
		cwd: cmd.cwd,
		startedAt: cmd.startedAt,
		exitCode: cmd.exitCode,
		stdoutLength: stdoutResult.data.length,
		stderr: stderrResult.data
	})

	if (cmd.exitCode !== 0 && stdoutResult.data.length === 0) {
		logger.error("glob find returned non-zero", {
			exitCode: cmd.exitCode,
			stderr: stderrResult.data,
			dirPath,
			pattern
		})
		throw errors.wrap(ErrNotFound, `find in '${dirPath}'`)
	}

	const lines = stdoutResult.data.trim().split("\n").filter(Boolean)

	if (lines.length >= MAX_GLOB_RESULTS) {
		logger.warn("glob result limit reached", { dirPath, pattern, limit: MAX_GLOB_RESULTS })
		throw errors.wrap(ErrTooManyResults, `pattern '${pattern}' in '${dirPath}' (limit ${MAX_GLOB_RESULTS})`)
	}

	const matches = lines.map(function parseMatch(line) {
		return parseGlobLine(line, dirPath)
	})

	logger.debug("glob complete", { dirPath, pattern, matchCount: matches.length })

	return { pattern, basePath: dirPath, matches }
}

interface GrepMatch {
	path: string
	lineNumber: number
	lineContent: string
}

interface GrepOptions {
	glob?: string
	maxResults?: number
}

interface GrepResult {
	pattern: string
	matches: GrepMatch[]
}

// grep -Z outputs null byte between filename and the rest ("path\0lineNum:content")
// This avoids misparse when filenames contain colons.
function parseGrepLine(line: string): GrepMatch {
	const nullIndex = line.indexOf("\0")
	if (nullIndex === -1) {
		return { path: line, lineNumber: 0, lineContent: line }
	}
	const path = line.slice(0, nullIndex)
	const rest = line.slice(nullIndex + 1)
	const colonIndex = rest.indexOf(":")
	if (colonIndex === -1) {
		return { path, lineNumber: 0, lineContent: rest }
	}
	const lineNumber = Number.parseInt(rest.slice(0, colonIndex), 10)
	const lineContent = rest.slice(colonIndex + 1)
	return { path, lineNumber, lineContent }
}

async function grep(
	sandbox: Sandbox,
	dirPath: string,
	pattern: string,
	options?: GrepOptions
): Promise<GrepResult> {
	const limit = options?.maxResults ? options.maxResults : MAX_GREP_RESULTS
	const args = ["-rnZ", pattern, dirPath]
	if (options?.glob) {
		args.push("--include", options.glob)
	}

	const cmdResult = await errors.try(sandbox.runCommand("grep", args))
	if (cmdResult.error) {
		logger.error("grep command failed", { error: cmdResult.error, dirPath, pattern })
		throw errors.wrap(cmdResult.error, `grep '${pattern}' in '${dirPath}'`)
	}

	const cmd = cmdResult.data

	const stdoutResult = await errors.try(cmd.stdout())
	if (stdoutResult.error) {
		logger.error("grep stdout failed", { error: stdoutResult.error })
		throw errors.wrap(stdoutResult.error, "grep stdout")
	}

	const stderrResult = await errors.try(cmd.stderr())
	if (stderrResult.error) {
		logger.error("grep stderr failed", { error: stderrResult.error })
		throw errors.wrap(stderrResult.error, "grep stderr")
	}

	logger.debug("grep command complete", {
		cmdId: cmd.cmdId,
		cwd: cmd.cwd,
		startedAt: cmd.startedAt,
		exitCode: cmd.exitCode,
		stdoutLength: stdoutResult.data.length,
		stderr: stderrResult.data
	})

	if (cmd.exitCode === 2) {
		logger.error("grep pattern error", { stderr: stderrResult.data, pattern })
		throw errors.wrap(ErrInvalidPattern, pattern)
	}

	if (cmd.exitCode === 1) {
		return { pattern, matches: [] }
	}

	const lines = stdoutResult.data.trim().split("\n").filter(Boolean)
	const truncated = lines.slice(0, limit)
	const matches = truncated.map(function parseMatch(line) {
		return parseGrepLine(line)
	})

	logger.debug("grep complete", { dirPath, pattern, matchCount: matches.length })

	return { pattern, matches }
}

interface WriteResult {
	path: string
	size: number
	created: boolean
}

async function write(sandbox: Sandbox, filePath: string, content: string): Promise<WriteResult> {
	const testResult = await errors.try(sandbox.runCommand("test", ["-f", filePath]))
	const created = testResult.error !== undefined || testResult.data.exitCode !== 0

	const buf = Buffer.from(content, "utf-8")
	const writeResult = await errors.try(sandbox.writeFiles([{ path: filePath, content: buf }]))
	if (writeResult.error) {
		logger.error("write failed", { error: writeResult.error, path: filePath })
		throw errors.wrap(ErrWriteFailed, filePath)
	}

	logger.debug("write complete", { path: filePath, size: buf.length, created })

	return { path: filePath, size: buf.length, created }
}

interface EditResult {
	path: string
	replacements: number
}

async function edit(
	sandbox: Sandbox,
	filePath: string,
	oldString: string,
	newString: string,
	replaceAll?: boolean
): Promise<EditResult> {
	const bufResult = await errors.try(sandbox.readFileToBuffer({ path: filePath }))
	if (bufResult.error) {
		logger.error("file read failed", { error: bufResult.error, path: filePath })
		throw errors.wrap(bufResult.error, `read '${filePath}'`)
	}

	if (bufResult.data === null) {
		logger.error("file not found", { path: filePath })
		throw errors.wrap(ErrNotFound, filePath)
	}

	const content = bufResult.data.toString("utf-8")

	let count = 0
	let searchFrom = 0
	while (true) {
		const idx = content.indexOf(oldString, searchFrom)
		if (idx === -1) {
			break
		}
		count++
		searchFrom = idx + oldString.length
	}

	if (count === 0) {
		logger.error("old string not found", { path: filePath, oldString })
		throw errors.wrap(ErrNoMatch, filePath)
	}

	if (count > 1 && !replaceAll) {
		logger.error("ambiguous match", { path: filePath, oldString, count })
		throw errors.wrap(ErrAmbiguousMatch, `${count} occurrences in '${filePath}'`)
	}

	let newContent: string
	let replacements: number
	if (replaceAll) {
		newContent = content.replaceAll(oldString, newString)
		replacements = count
	} else {
		newContent = content.replace(oldString, newString)
		replacements = 1
	}

	const buf = Buffer.from(newContent, "utf-8")
	const writeResult = await errors.try(sandbox.writeFiles([{ path: filePath, content: buf }]))
	if (writeResult.error) {
		logger.error("file write failed", { error: writeResult.error, path: filePath })
		throw errors.wrap(writeResult.error, `write '${filePath}'`)
	}

	logger.debug("edit complete", { path: filePath, replacements })

	return { path: filePath, replacements }
}

export {
	ErrAmbiguousMatch,
	ErrInvalidPattern,
	ErrNoMatch,
	ErrNotADirectory,
	ErrNotAFile,
	ErrNotFound,
	ErrTooLarge,
	ErrTooManyResults,
	ErrWriteFailed,
	MAX_FILE_SIZE,
	MAX_GLOB_RESULTS,
	MAX_GREP_RESULTS,
	edit,
	glob,
	grep,
	read,
	write
}

export type {
	EditResult,
	GlobMatch,
	GlobResult,
	GrepMatch,
	GrepOptions,
	GrepResult,
	ReadResult,
	WriteResult
}
```

---

### Task 3: Update Tools for experimental_context

**Files:**
- Modify: `src/lib/agent/fs/tools.ts`

**Step 1: Update all execute functions to extract sandbox from experimental_context**

Replace the entire file:

```typescript
import * as errors from "@superbuilders/errors"
import * as logger from "@superbuilders/slog"
import { tool } from "ai"
import { z } from "zod"
import { extractSandbox } from "@/lib/agent/fs/context"
import { edit, glob, grep, read, write } from "@/lib/agent/fs/operations"

async function executeRead(
	{ path }: { path: string },
	{ experimental_context }: { experimental_context?: unknown }
) {
	const sandbox = extractSandbox(experimental_context)
	const result = await errors.try(read(sandbox, path))
	if (result.error) {
		logger.warn("read tool failed", { error: result.error, path })
		return { error: String(result.error) }
	}
	return {
		content: result.data.content,
		path: result.data.path,
		size: result.data.size,
		lineCount: result.data.lineCount
	}
}

const readTool = tool({
	description:
		"Read the contents of a file at the given path. Returns the file content, byte size, and line count. Returns an error message if the file does not exist or exceeds the size limit.",
	inputSchema: z.object({
		path: z.string().describe("Absolute path to the file to read")
	}),
	strict: true,
	execute: executeRead
})

async function executeGlob(
	{ dirPath, pattern }: { dirPath: string; pattern: string },
	{ experimental_context }: { experimental_context?: unknown }
) {
	const sandbox = extractSandbox(experimental_context)
	const result = await errors.try(glob(sandbox, dirPath, pattern))
	if (result.error) {
		logger.warn("glob tool failed", { error: result.error, dirPath, pattern })
		return { error: String(result.error) }
	}
	return {
		pattern: result.data.pattern,
		basePath: result.data.basePath,
		matches: result.data.matches
	}
}

const globTool = tool({
	description:
		"Find files matching a glob pattern in a directory tree. Supports *, **, ? wildcards. Returns matching file paths with names and sizes. Use pattern '*' to list a directory.",
	inputSchema: z.object({
		dirPath: z.string().describe("Absolute path to the directory to search"),
		pattern: z.string().describe("Glob pattern to match files against (e.g. '**/*.ts', '*.json')")
	}),
	strict: true,
	execute: executeGlob
})

async function executeGrep(
	{
		dirPath,
		pattern,
		glob: globFilter,
		maxResults
	}: {
		dirPath: string
		pattern: string
		glob?: string
		maxResults?: number
	},
	{ experimental_context }: { experimental_context?: unknown }
) {
	const sandbox = extractSandbox(experimental_context)
	const result = await errors.try(grep(sandbox, dirPath, pattern, { glob: globFilter, maxResults }))
	if (result.error) {
		logger.warn("grep tool failed", { error: result.error, dirPath, pattern })
		return { error: String(result.error) }
	}
	return {
		pattern: result.data.pattern,
		matches: result.data.matches
	}
}

const grepTool = tool({
	description:
		"Search for a regex pattern across files in a directory tree. Returns matching lines with file path and line number. Optionally filter by glob pattern. Skips binary files.",
	inputSchema: z.object({
		dirPath: z.string().describe("Absolute path to the directory to search"),
		pattern: z.string().describe("Regex pattern to search for in file contents"),
		glob: z.string().describe("Optional glob pattern to filter which files to search").optional(),
		maxResults: z
			.number()
			.describe("Maximum number of matching lines to return (default 100)")
			.optional()
	}),
	execute: executeGrep
})

async function executeWrite(
	{ path, content }: { path: string; content: string },
	{ experimental_context }: { experimental_context?: unknown }
) {
	const sandbox = extractSandbox(experimental_context)
	const result = await errors.try(write(sandbox, path, content))
	if (result.error) {
		logger.warn("write tool failed", { error: result.error, path })
		return { error: String(result.error) }
	}
	return {
		path: result.data.path,
		size: result.data.size,
		created: result.data.created
	}
}

const writeTool = tool({
	description:
		"Write content to a file, creating parent directories if needed. Returns the file path, byte size, and whether the file was newly created. Overwrites existing content.",
	inputSchema: z.object({
		path: z.string().describe("Absolute path to the file to write"),
		content: z.string().describe("Content to write to the file")
	}),
	strict: true,
	execute: executeWrite
})

async function executeEdit(
	{
		path,
		oldString,
		newString,
		replaceAll
	}: {
		path: string
		oldString: string
		newString: string
		replaceAll?: boolean
	},
	{ experimental_context }: { experimental_context?: unknown }
) {
	const sandbox = extractSandbox(experimental_context)
	const result = await errors.try(edit(sandbox, path, oldString, newString, replaceAll))
	if (result.error) {
		logger.warn("edit tool failed", { error: result.error, path })
		return { error: String(result.error) }
	}
	return {
		path: result.data.path,
		replacements: result.data.replacements
	}
}

const editTool = tool({
	description:
		"Replace exact string matches in a file. Finds oldString and replaces with newString. Fails if oldString is not found or is ambiguous (found multiple times without replaceAll). Use replaceAll to replace every occurrence.",
	inputSchema: z.object({
		path: z.string().describe("Absolute path to the file to edit"),
		oldString: z.string().describe("The exact string to find and replace"),
		newString: z.string().describe("The string to replace oldString with"),
		replaceAll: z
			.boolean()
			.describe("Replace all occurrences instead of failing on ambiguous matches")
			.optional()
	}),
	execute: executeEdit
})

export { editTool, globTool, grepTool, readTool, writeTool }
```

**Step 2: Typecheck**

Run: `bun typecheck`
Expected: PASS (all three files compile together)

**Step 3: Lint**

Run: `bun lint:all`
Expected: PASS

**Step 4: Commit**

```bash
git add src/lib/agent/fs/context.ts src/lib/agent/fs/operations.ts src/lib/agent/fs/tools.ts
git commit -m "feat: sandbox-backed filesystem operations

Replace node:fs operations with Vercel Sandbox SDK calls.
Tools receive sandbox via AI SDK experimental_context.

- context.ts: ErrSandboxContext sentinel + extractSandbox helper
- operations.ts: read/glob/grep/write/edit backed by sandbox
- tools.ts: execute functions extract sandbox from context"
```

---

## Commit 2: `feat: sandbox lifecycle inngest functions`

### Task 4: Update Event Schemas

**Files:**
- Modify: `src/inngest/index.ts`

**Step 1: Add sandboxId to agent events and new sandbox lifecycle events**

In `src/inngest/index.ts`, replace the `schema` object with:

```typescript
const schema = {
	"superstarter/hello": z.object({
		message: z.string().min(1)
	}),
	"paul/agents/fs/read": z.object({
		path: z.string().min(1)
	}),
	"paul/agents/fs/glob": z.object({
		dirPath: z.string().min(1),
		pattern: z.string().min(1)
	}),
	"paul/agents/fs/grep": z.object({
		dirPath: z.string().min(1),
		pattern: z.string().min(1),
		glob: z.string().optional(),
		maxResults: z.number().optional()
	}),
	"paul/agents/fs/write": z.object({
		path: z.string().min(1),
		content: z.string()
	}),
	"paul/agents/fs/edit": z.object({
		path: z.string().min(1),
		oldString: z.string().min(1),
		newString: z.string(),
		replaceAll: z.boolean().optional()
	}),
	"paul/agents/explore": z.object({
		prompt: z.string().min(1),
		sandboxId: z.string().min(1)
	}),
	"paul/agents/code": z.object({
		prompt: z.string().min(1),
		sandboxId: z.string().min(1)
	}),
	"paul/sandbox/create": z.object({
		runtime: z.enum(["node24", "node22", "python3.13"]).default("node24")
	}),
	"paul/sandbox/stop": z.object({
		sandboxId: z.string().min(1)
	}),
	"paul/debug/echo": z.object({
		source: z.string().min(1),
		payload: z.record(z.string(), z.unknown())
	})
}
```

---

### Task 5: Create Sandbox Create Function

**Files:**
- Create: `src/inngest/functions/sandbox/create.ts`

**Step 1: Create `src/inngest/functions/sandbox/create.ts`**

```typescript
import { Sandbox } from "@vercel/sandbox"
import * as errors from "@superbuilders/errors"
import { NonRetriableError } from "inngest"
import { inngest } from "@/inngest"

function describeSandbox(sbx: Sandbox): Record<string, unknown> {
	return {
		sandboxId: sbx.sandboxId,
		status: sbx.status,
		createdAt: sbx.createdAt,
		timeout: sbx.timeout,
		networkPolicy: sbx.networkPolicy,
		sourceSnapshotId: sbx.sourceSnapshotId,
		routes: sbx.routes,
		interactivePort: sbx.interactivePort
	}
}

const createFunction = inngest.createFunction(
	{ id: "paul/sandbox/create" },
	{ event: "paul/sandbox/create" },
	async ({ event, logger, step }) => {
		logger.info("creating sandbox", { runtime: event.data.runtime })

		const sandboxData = await step.run("create-sandbox", async () => {
			const result = await errors.try(Sandbox.create({ runtime: event.data.runtime }))
			if (result.error) {
				logger.error("sandbox creation failed", { error: result.error })
				throw new NonRetriableError(String(result.error))
			}

			const description = describeSandbox(result.data)
			logger.info("sandbox created", description)
			return description
		})

		await step.sendEvent("echo-sandbox", [
			{
				name: "paul/debug/echo" as const,
				data: {
					source: "paul/sandbox/create",
					payload: sandboxData
				}
			}
		])

		logger.info("sandbox create complete", { sandboxId: sandboxData.sandboxId })

		return { sandboxId: sandboxData.sandboxId }
	}
)

export { createFunction }
```

---

### Task 6: Create Sandbox Stop Function

**Files:**
- Create: `src/inngest/functions/sandbox/stop.ts`

**Step 1: Create `src/inngest/functions/sandbox/stop.ts`**

```typescript
import { Sandbox } from "@vercel/sandbox"
import * as errors from "@superbuilders/errors"
import { NonRetriableError } from "inngest"
import { inngest } from "@/inngest"

function describeSandbox(sbx: Sandbox): Record<string, unknown> {
	return {
		sandboxId: sbx.sandboxId,
		status: sbx.status,
		createdAt: sbx.createdAt,
		timeout: sbx.timeout,
		networkPolicy: sbx.networkPolicy,
		sourceSnapshotId: sbx.sourceSnapshotId,
		routes: sbx.routes,
		interactivePort: sbx.interactivePort
	}
}

const stopFunction = inngest.createFunction(
	{ id: "paul/sandbox/stop" },
	{ event: "paul/sandbox/stop" },
	async ({ event, logger, step }) => {
		logger.info("stopping sandbox", { sandboxId: event.data.sandboxId })

		const sandboxData = await step.run("stop-sandbox", async () => {
			const connectResult = await errors.try(
				Sandbox.get({ sandboxId: event.data.sandboxId })
			)
			if (connectResult.error) {
				logger.error("sandbox connection failed", {
					error: connectResult.error,
					sandboxId: event.data.sandboxId
				})
				throw new NonRetriableError(String(connectResult.error))
			}

			const sbx = connectResult.data
			const description = describeSandbox(sbx)
			logger.info("sandbox connected", description)

			const stopResult = await errors.try(sbx.stop())
			if (stopResult.error) {
				logger.error("sandbox stop failed", {
					error: stopResult.error,
					sandboxId: event.data.sandboxId
				})
				throw errors.wrap(stopResult.error, "sandbox stop")
			}

			return description
		})

		await step.sendEvent("echo-sandbox", [
			{
				name: "paul/debug/echo" as const,
				data: {
					source: "paul/sandbox/stop",
					payload: sandboxData
				}
			}
		])

		logger.info("sandbox stop complete", { sandboxId: event.data.sandboxId })

		return { sandboxId: event.data.sandboxId }
	}
)

export { stopFunction }
```

---

### Task 7: Update Function Registry

**Files:**
- Modify: `src/inngest/functions/index.ts`

**Step 1: Add sandbox function imports and register them**

Replace entire file:

```typescript
import { codeFunction } from "@/inngest/functions/agents/code"
import { exploreFunction } from "@/inngest/functions/agents/explore"
import { editFunction } from "@/inngest/functions/agents/fs/edit"
import { globFunction } from "@/inngest/functions/agents/fs/glob"
import { grepFunction } from "@/inngest/functions/agents/fs/grep"
import { readFunction } from "@/inngest/functions/agents/fs/read"
import { writeFunction } from "@/inngest/functions/agents/fs/write"
import { echoFunction } from "@/inngest/functions/debug/echo"
import { createFunction } from "@/inngest/functions/sandbox/create"
import { stopFunction } from "@/inngest/functions/sandbox/stop"

const functions = [
	codeFunction,
	exploreFunction,
	readFunction,
	globFunction,
	grepFunction,
	writeFunction,
	editFunction,
	echoFunction,
	createFunction,
	stopFunction
]

export { functions }
```

**Step 2: Typecheck**

Run: `bun typecheck`
Expected: PASS

**Step 3: Lint**

Run: `bun lint:all`
Expected: PASS

**Step 4: Commit**

```bash
git add src/inngest/index.ts src/inngest/functions/sandbox/create.ts src/inngest/functions/sandbox/stop.ts src/inngest/functions/index.ts
git commit -m "feat: sandbox lifecycle inngest functions

Add dedicated Inngest functions for sandbox create/stop.
Agents now require sandboxId in event data.

- sandbox/create.ts: creates sandbox, echoes metadata via debug/echo
- sandbox/stop.ts: connects by id, stops, echoes state
- describeSandbox inlined in both (Sandbox getters aren't spreadable)
- Event schemas updated with sandboxId on agent events"
```

---

## Commit 3: `feat: connect agents to sandbox via experimental_context`

### Task 8: Update Explorer Agent Function

**Files:**
- Modify: `src/inngest/functions/agents/explore.ts`

**Step 1: Add sandbox connection and pass via experimental_context**

Replace entire file:

```typescript
import { Sandbox } from "@vercel/sandbox"
import * as errors from "@superbuilders/errors"
import * as logger from "@superbuilders/slog"
import type { ModelMessage, StepResult } from "ai"
import { generateText, modelMessageSchema } from "ai"
import { NonRetriableError } from "inngest"
import { z } from "zod"
import { inngest } from "@/inngest"
import { ErrSandboxContext } from "@/lib/agent/fs/context"
import type { ExplorerStepResult, ExplorerTools } from "@/lib/agent/explorer"
import { instructions, MAX_STEPS, model, tools } from "@/lib/agent/explorer"

const messagesSchema = z.array(modelMessageSchema)

function parseMessages(raw: unknown): ModelMessage[] {
	const parsed = messagesSchema.safeParse(raw)
	if (!parsed.success) {
		logger.error("response messages failed validation", { error: parsed.error })
		throw errors.new("response messages failed validation")
	}
	return parsed.data
}

function materializeStep(step: StepResult<ExplorerTools>): ExplorerStepResult {
	const own = { ...step }
	return {
		...own,
		text: step.text,
		reasoning: step.reasoning,
		reasoningText: step.reasoningText,
		files: step.files,
		sources: step.sources,
		toolCalls: step.toolCalls,
		staticToolCalls: step.staticToolCalls,
		dynamicToolCalls: step.dynamicToolCalls,
		toolResults: step.toolResults,
		staticToolResults: step.staticToolResults,
		dynamicToolResults: step.dynamicToolResults,
		warnings: step.warnings ? step.warnings : []
	}
}

const exploreFunction = inngest.createFunction(
	{ id: "paul/agents/explore" },
	{ event: "paul/agents/explore" },
	async ({ event, logger, step }) => {
		logger.info("starting explore", {
			prompt: event.data.prompt,
			sandboxId: event.data.sandboxId
		})

		// Sandbox.get() is outside step.run intentionally. It re-executes on every
		// Inngest checkpoint resume, but that's fine — it's just an HTTP metadata
		// lookup, not sandbox creation. The Sandbox instance isn't serializable so
		// it can't be returned from step.run anyway.
		const sbxResult = await errors.try(
			Sandbox.get({ sandboxId: event.data.sandboxId })
		)
		if (sbxResult.error) {
			logger.error("sandbox connection failed", {
				error: sbxResult.error,
				sandboxId: event.data.sandboxId
			})
			throw new NonRetriableError(
				`sandbox connection failed: ${String(sbxResult.error)}`
			)
		}
		const sbx = sbxResult.data
		logger.info("sandbox connected", { sandboxId: sbx.sandboxId })

		let responseMessages: ModelMessage[] = []
		let lastStepText = ""
		let stepCount = 0
		let totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }

		for (let i = 0; i < MAX_STEPS; i++) {
			const stepResult = await step.run(`llm-${i}`, async () => {
				const result = await errors.try(
					generateText({
						model,
						system: instructions,
						messages: [{ role: "user" as const, content: event.data.prompt }, ...responseMessages],
						tools,
						experimental_context: { sandbox: sbx }
					})
				)
				if (result.error) {
					if (errors.is(result.error, ErrSandboxContext)) {
						logger.error("sandbox context error", { error: result.error, step: i })
						throw new NonRetriableError("sandbox missing from tool context")
					}
					logger.error("llm call failed", { error: result.error, step: i })
					throw errors.wrap(result.error, `llm step ${i}`)
				}

				const firstStep = result.data.steps[0]
				if (!firstStep) {
					logger.error("no step in result", { step: i })
					throw errors.new("generateText returned no steps")
				}

				return {
					step: materializeStep(firstStep),
					responseMessages: result.data.response.messages
				}
			})

			responseMessages = [...responseMessages, ...parseMessages(stepResult.responseMessages)]

			const inputTokens = stepResult.step.usage.inputTokens
			const outputTokens = stepResult.step.usage.outputTokens
			const stepTotalTokens = stepResult.step.usage.totalTokens
			totalUsage = {
				inputTokens: totalUsage.inputTokens + (inputTokens ? inputTokens : 0),
				outputTokens: totalUsage.outputTokens + (outputTokens ? outputTokens : 0),
				totalTokens: totalUsage.totalTokens + (stepTotalTokens ? stepTotalTokens : 0)
			}

			lastStepText = stepResult.step.text
			stepCount++

			await step.sendEvent(`echo-${i}`, [
				{
					name: "paul/debug/echo" as const,
					data: {
						source: "paul/agents/explore",
						payload: stepResult.step
					}
				}
			])

			logger.info("step complete", {
				step: i,
				finishReason: stepResult.step.finishReason,
				usage: stepResult.step.usage
			})

			if (stepResult.step.finishReason === "stop") {
				break
			}
		}

		logger.info("explore complete", {
			stepCount,
			totalUsage
		})

		return {
			text: lastStepText,
			stepCount,
			totalUsage
		}
	}
)

export { exploreFunction }
```

---

### Task 9: Update Coder Agent Function

**Files:**
- Modify: `src/inngest/functions/agents/code.ts`

**Step 1: Add sandbox connection and pass via experimental_context**

Replace entire file:

```typescript
import { Sandbox } from "@vercel/sandbox"
import * as errors from "@superbuilders/errors"
import * as logger from "@superbuilders/slog"
import type { ModelMessage, StepResult } from "ai"
import { generateText, modelMessageSchema } from "ai"
import { NonRetriableError } from "inngest"
import { z } from "zod"
import { inngest } from "@/inngest"
import { ErrSandboxContext } from "@/lib/agent/fs/context"
import type { CoderStepResult, CoderTools } from "@/lib/agent/coder"
import { instructions, MAX_STEPS, model, tools } from "@/lib/agent/coder"

const messagesSchema = z.array(modelMessageSchema)

function parseMessages(raw: unknown): ModelMessage[] {
	const parsed = messagesSchema.safeParse(raw)
	if (!parsed.success) {
		logger.error("response messages failed validation", { error: parsed.error })
		throw errors.new("response messages failed validation")
	}
	return parsed.data
}

function materializeStep(step: StepResult<CoderTools>): CoderStepResult {
	const own = { ...step }
	return {
		...own,
		text: step.text,
		reasoning: step.reasoning,
		reasoningText: step.reasoningText,
		files: step.files,
		sources: step.sources,
		toolCalls: step.toolCalls,
		staticToolCalls: step.staticToolCalls,
		dynamicToolCalls: step.dynamicToolCalls,
		toolResults: step.toolResults,
		staticToolResults: step.staticToolResults,
		dynamicToolResults: step.dynamicToolResults,
		warnings: step.warnings ? step.warnings : []
	}
}

const codeFunction = inngest.createFunction(
	{ id: "paul/agents/code" },
	{ event: "paul/agents/code" },
	async ({ event, logger, step }) => {
		logger.info("starting code", {
			prompt: event.data.prompt,
			sandboxId: event.data.sandboxId
		})

		// Sandbox.get() is outside step.run intentionally. It re-executes on every
		// Inngest checkpoint resume, but that's fine — it's just an HTTP metadata
		// lookup, not sandbox creation. The Sandbox instance isn't serializable so
		// it can't be returned from step.run anyway.
		const sbxResult = await errors.try(
			Sandbox.get({ sandboxId: event.data.sandboxId })
		)
		if (sbxResult.error) {
			logger.error("sandbox connection failed", {
				error: sbxResult.error,
				sandboxId: event.data.sandboxId
			})
			throw new NonRetriableError(
				`sandbox connection failed: ${String(sbxResult.error)}`
			)
		}
		const sbx = sbxResult.data
		logger.info("sandbox connected", { sandboxId: sbx.sandboxId })

		let responseMessages: ModelMessage[] = []
		let lastStepText = ""
		let stepCount = 0
		let totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }

		for (let i = 0; i < MAX_STEPS; i++) {
			const stepResult = await step.run(`llm-${i}`, async () => {
				const result = await errors.try(
					generateText({
						model,
						system: instructions,
						messages: [{ role: "user" as const, content: event.data.prompt }, ...responseMessages],
						tools,
						experimental_context: { sandbox: sbx }
					})
				)
				if (result.error) {
					if (errors.is(result.error, ErrSandboxContext)) {
						logger.error("sandbox context error", { error: result.error, step: i })
						throw new NonRetriableError("sandbox missing from tool context")
					}
					logger.error("llm call failed", { error: result.error, step: i })
					throw errors.wrap(result.error, `llm step ${i}`)
				}

				const firstStep = result.data.steps[0]
				if (!firstStep) {
					logger.error("no step in result", { step: i })
					throw errors.new("generateText returned no steps")
				}

				return {
					step: materializeStep(firstStep),
					responseMessages: result.data.response.messages
				}
			})

			responseMessages = [...responseMessages, ...parseMessages(stepResult.responseMessages)]

			const inputTokens = stepResult.step.usage.inputTokens
			const outputTokens = stepResult.step.usage.outputTokens
			const stepTotalTokens = stepResult.step.usage.totalTokens
			totalUsage = {
				inputTokens: totalUsage.inputTokens + (inputTokens ? inputTokens : 0),
				outputTokens: totalUsage.outputTokens + (outputTokens ? outputTokens : 0),
				totalTokens: totalUsage.totalTokens + (stepTotalTokens ? stepTotalTokens : 0)
			}

			lastStepText = stepResult.step.text
			stepCount++

			await step.sendEvent(`echo-${i}`, [
				{
					name: "paul/debug/echo" as const,
					data: {
						source: "paul/agents/code",
						payload: stepResult.step
					}
				}
			])

			logger.info("step complete", {
				step: i,
				finishReason: stepResult.step.finishReason,
				usage: stepResult.step.usage
			})

			if (stepResult.step.finishReason === "stop") {
				break
			}
		}

		logger.info("code complete", {
			stepCount,
			totalUsage
		})

		return {
			text: lastStepText,
			stepCount,
			totalUsage
		}
	}
)

export { codeFunction }
```

**Step 2: Typecheck**

Run: `bun typecheck`
Expected: PASS

**Step 3: Lint**

Run: `bun lint:all`
Expected: PASS

**Step 4: Commit**

```bash
git add src/inngest/functions/agents/explore.ts src/inngest/functions/agents/code.ts
git commit -m "feat: connect agents to sandbox via experimental_context

Agents now receive sandboxId in event data, connect via Sandbox.get(),
and pass the instance through experimental_context to generateText.
ErrSandboxContext triggers NonRetriableError — retrying won't help."
```

---

## Manual Verification

After all commits, verify the full integration:

1. Start the Inngest dev server: `bun dev:inngest`
2. Start the app: `bun dev`
3. Send a `paul/sandbox/create` event via Inngest dashboard:
   ```json
   { "name": "paul/sandbox/create", "data": { "runtime": "node24" } }
   ```
4. Check the debug echo output for sandbox metadata
5. Copy the `sandboxId` from the return value
6. Send a `paul/agents/explore` event with the sandboxId:
   ```json
   { "name": "paul/agents/explore", "data": { "prompt": "List the files in /vercel/sandbox", "sandboxId": "<id>" } }
   ```
7. Check that the agent connects to the sandbox and runs tools against it
8. Send a `paul/sandbox/stop` event to clean up:
   ```json
   { "name": "paul/sandbox/stop", "data": { "sandboxId": "<id>" } }
   ```

---

## Summary of Changes

| File | Action | Lines (approx) |
|------|--------|-----------------|
| `src/lib/agent/fs/context.ts` | Create | 20 |
| `src/lib/agent/fs/operations.ts` | Rewrite | 280 |
| `src/lib/agent/fs/tools.ts` | Modify | 155 |
| `src/inngest/index.ts` | Modify | 55 |
| `src/inngest/functions/sandbox/create.ts` | Create | 52 |
| `src/inngest/functions/sandbox/stop.ts` | Create | 60 |
| `src/inngest/functions/agents/explore.ts` | Modify | 130 |
| `src/inngest/functions/agents/code.ts` | Modify | 130 |
| `src/inngest/functions/index.ts` | Modify | 22 |

**Deleted code:** ~150 lines of helper functions (`walkDirectoryFromBase`, `globToRegex`, `convertGlobChar`, `searchFileLines`, `resolveGrepOptions`) replaced by sandbox `runCommand` calls.

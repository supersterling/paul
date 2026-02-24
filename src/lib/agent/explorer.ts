import { openai } from "@ai-sdk/openai"
import { globTool, grepTool, readTool } from "@/lib/agent/fs/tools"
import type { AgentStepResult } from "@/lib/agent/step"

const MAX_STEPS = 20 as const

const model = openai("gpt-5-nano")

const tools = {
	read: readTool,
	glob: globTool,
	grep: grepTool
} as const

const instructions = [
	"You are a codebase explorer.",
	"The repository is already cloned in your working directory. Do NOT try to clone, fetch, or download anything.",
	"Use your tools to explore the local filesystem:",
	"- glob: list files matching a pattern (e.g., glob('.', '**/*.go') to find all Go files)",
	"- grep: search file contents for patterns (e.g., grep('.', 'func main'))",
	"- read: read the full contents of a specific file (e.g., read('main.go'))",
	"Be thorough but efficient:",
	"- Start with glob to understand directory structure",
	"- Use grep to find relevant code by pattern",
	"- Read specific files to understand implementation details",
	"Provide a clear, structured answer with file paths and relevant code excerpts."
].join("\n")

type ExplorerTools = typeof tools

type ExplorerStepResult = AgentStepResult

export { MAX_STEPS, instructions, model, tools }
export type { ExplorerStepResult, ExplorerTools }

# Vercel Sandbox Research Notes

## What It Is

Vercel Sandbox is an ephemeral compute primitive built on **Firecracker microVMs** — not containers. Each sandbox gets its own Linux kernel, filesystem, network namespace, and process space. Amazon Linux 2023 base. Starts in milliseconds.

Designed for running untrusted code safely — AI agent output, user uploads, code generation. The security model is VM-level isolation, not container namespaces. Container escapes are irrelevant because there's no shared kernel.

---

## Core Capabilities

### Compute Specs

| Spec | Value |
|------|-------|
| Max vCPUs | 8 per sandbox |
| Memory | 2 GB per vCPU (max 16 GB) |
| Runtimes | `node24` (default), `node22`, `python3.13` |
| Default timeout | 5 minutes |
| Max timeout | 45 min (Hobby), 5 hours (Pro/Enterprise) |
| Concurrency | 10 (Hobby), 2,000 (Pro/Enterprise) |
| Region | `iad1` only |
| Working directory | `/vercel/sandbox` |
| User | `vercel-sandbox` with `sudo` access |
| OS | Amazon Linux 2023 |

### Pre-installed Packages

`git`, `find`, `grep`, `tar`, `gzip`, `openssl`, `bzip2`, `unzip`, `zstd`, `procps`, `iputils`, `whois`, `which`, `ncurses-libs`, `libicu`, `libjpeg`, `libpng`, `bind-utils`

Node runtimes include `npm` and `pnpm`. Python includes `pip` and `uv`. Additional packages installable via `dnf`.

---

## SDK API Surface (`@vercel/sandbox`)

### Sandbox Lifecycle

```typescript
import { Sandbox } from "@vercel/sandbox"

// Create
const sandbox = await Sandbox.create({ runtime: "node24" })

// Reconnect to existing
const sandbox = await Sandbox.get({ sandboxId: "sbx_abc123" })

// List all sandboxes
const { json: { sandboxes } } = await Sandbox.list()

// Stop
await sandbox.stop()

// Extend timeout
await sandbox.extendTimeout(60000) // +60 seconds
```

### Accessors

| Accessor | Returns | Notes |
|----------|---------|-------|
| `sandbox.sandboxId` | `string` | Unique ID for reconnection |
| `sandbox.status` | `"pending" \| "running" \| "stopping" \| "stopped" \| "failed"` | VM lifecycle state |
| `sandbox.timeout` | `number` | Milliseconds remaining before auto-stop |
| `sandbox.createdAt` | `Date` | When the sandbox was created |

### Filesystem Methods

#### `sandbox.readFile({ path, cwd? })`

Returns `Promise<ReadableStream | null>`. Returns `null` if file doesn't exist.

#### `sandbox.readFileToBuffer({ path, cwd? })`

Returns `Promise<Buffer | null>`. Returns `null` if file doesn't exist. Use `.toString("utf-8")` for string content.

#### `sandbox.writeFiles(files)`

```typescript
await sandbox.writeFiles([
    { path: "hello.txt", content: Buffer.from("hi") },
    { path: "src/index.ts", content: Buffer.from(code) }
])
```

Paths default to `/vercel/sandbox`. Use absolute paths for custom locations. Bundle related files into a single call to reduce round trips.

#### `sandbox.mkDir(path)`

Creates a directory. Paths relative to `/vercel/sandbox` unless absolute.

#### `sandbox.downloadFile(src, dst)`

Pull a file from the sandbox to the local filesystem. Returns `null` if source doesn't exist.

```typescript
const dstPath = await sandbox.downloadFile(
    { path: "output.json", cwd: "/vercel/sandbox" },
    { path: "local-output.json", cwd: "/tmp" }
)
```

### Missing Filesystem Operations

The SDK does **NOT** have native methods for:

- `stat` (check existence, size, file/directory)
- `readdir` (list directory contents)
- `glob` (pattern matching)
- `grep` (content search)

All of these go through `runCommand()`, which is actually better — native Linux `find`, `grep`, `stat` are faster than JS reimplementations.

### Running Commands

```typescript
// Blocking — waits for completion
const result = await sandbox.runCommand("node", ["--version"])
result.exitCode   // 0
await result.stdout()  // "v24.x.x"
await result.stderr()  // ""

// With options object
const result = await sandbox.runCommand({
    cmd: "grep",
    args: ["-rn", "TODO", "/vercel/sandbox/src"],
    cwd: "/vercel/sandbox",
    env: { NODE_ENV: "development" },
    sudo: true
})

// Detached — returns immediately (for dev servers, watchers)
const cmd = await sandbox.runCommand({
    cmd: "npm",
    args: ["run", "dev"],
    detached: true,
    stdout: process.stdout,
    stderr: process.stderr
})

// Stream logs from detached command
for await (const log of cmd.logs()) {
    if (log.stream === "stdout") process.stdout.write(log.data)
    else process.stderr.write(log.data)
}

// Kill a detached command
await cmd.kill("SIGTERM")  // or "SIGKILL"

// Wait for a detached command to finish
const finished = await cmd.wait()
console.log(finished.exitCode)
```

### Exposed Ports

Declare ports at creation, get public URLs:

```typescript
const sandbox = await Sandbox.create({ ports: [3000, 5432] })
const url = sandbox.domain(3000)  // "https://abc123.sandbox.vercel.app"
```

Max 4 open ports per sandbox.

---

## Source Loading

Five ways to seed a sandbox:

| Source | What you get | Startup time |
|--------|-------------|-------------|
| None | Empty `/vercel/sandbox` | Milliseconds |
| `writeFiles()` after create | Only the files you push | Milliseconds + upload time |
| `tarball` | Pre-packaged file bundle | Milliseconds + download |
| `git` | Full repo clone | ~10-30s (depends on repo size) |
| `snapshot` | Exact prior VM state (fs + packages) | Milliseconds |

```typescript
// Empty sandbox
const sandbox = await Sandbox.create({ runtime: "node24" })

// From git repo
const sandbox = await Sandbox.create({
    source: {
        type: "git",
        url: "https://github.com/user/repo.git",
        depth: 1,        // shallow clone
        revision: "main"  // branch/tag/commit
    }
})

// From private repo (GitHub PAT)
const sandbox = await Sandbox.create({
    source: {
        type: "git",
        url: "https://github.com/user/private-repo.git",
        username: "x-access-token",
        password: process.env.GITHUB_PAT
    }
})

// From tarball
const sandbox = await Sandbox.create({
    source: { type: "tarball", url: "https://example.com/code.tar.gz" }
})

// From snapshot (fastest)
const sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: "snap_abc123" }
})
```

---

## Snapshots

Capture the **entire VM state** — filesystem, installed packages, environment. Stored as opaque blobs managed by Vercel (cannot be downloaded or self-hosted).

### Key Properties

- **Independent of VM lifetime**: Snapshots persist in storage. The 5-hour limit is VM runtime only.
- **Taking a snapshot stops the VM**: The sandbox becomes unreachable after `snapshot()`. No need to call `stop()`.
- **Default expiration**: 30 days. Configurable to any duration or `0` for never.
- **Storage cost**: $0.20/GB-month.

### API

```typescript
// Create a snapshot (stops the sandbox)
const snapshot = await sandbox.snapshot({ expiration: ms("14d") })
console.log(snapshot.snapshotId)  // "snap_abc123"

// Create from snapshot
const newSandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: snapshot.snapshotId }
})

// List snapshots
const { json: { snapshots } } = await Snapshot.list()

// Get a specific snapshot
const snap = await Snapshot.get({ snapshotId: "snap_abc123" })
snap.status      // "created" | "deleted" | "failed"
snap.sizeBytes   // size in bytes
snap.createdAt   // Date
snap.expiresAt   // Date | null

// Delete a snapshot
await snapshot.delete()
```

### Use Cases for Agents

1. **Skip setup**: Clone repo + install deps once → snapshot → future sandboxes start instantly
2. **Checkpoint work**: Save agent's progress mid-task, resume later
3. **Branch-based caching**: One snapshot per branch, refresh on git push via webhook
4. **Fallback pattern**: Try snapshot first, fall back to git clone if expired/deleted

---

## Network / Firewall

Three modes, **switchable at runtime without restart**:

| Mode | Behavior |
|------|----------|
| `allow-all` (default) | Full internet access |
| `deny-all` | Zero egress, including DNS |
| User-defined | Allowlist specific domains + subnet rules |

```typescript
// Create with restricted network
const sandbox = await Sandbox.create({ networkPolicy: "deny-all" })

// Update at runtime
await sandbox.updateNetworkPolicy("allow-all")
await sandbox.updateNetworkPolicy("deny-all")
await sandbox.updateNetworkPolicy({
    allow: ["github.com", "registry.npmjs.org"],
    subnets: { deny: ["10.0.0.0/8"] }
})
```

### Agent Security Pattern

Start with `allow-all` to install deps and clone, then switch to `deny-all` before running untrusted/agent code. Prevents data exfiltration.

---

## Authentication

| Environment | Method | Setup |
|------------|--------|-------|
| Local dev | OIDC token | `vercel link` + `vercel env pull` → `VERCEL_OIDC_TOKEN` in `.env.local` (expires 12h) |
| Deployed on Vercel | OIDC (automatic) | Zero config — Vercel manages token lifecycle |
| External CI/CD | Access token | `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID` + `VERCEL_TOKEN` |

**On Vercel production, sandbox auth is completely automatic.** Inngest functions running on Vercel can create sandboxes with zero auth configuration.

```typescript
// Access token auth (non-Vercel environments)
const sandbox = await Sandbox.create({
    teamId: process.env.VERCEL_TEAM_ID,
    projectId: process.env.VERCEL_PROJECT_ID,
    token: process.env.VERCEL_TOKEN
})
```

---

## Pricing (Pro Plan)

| Metric | Cost |
|--------|------|
| Active CPU | $0.13/hr per vCPU |
| Provisioned Memory | $0.04/hr per GB |
| Sandbox Creations | $0.60 per million (~$0.0000006 each) |
| Network Transfer | $0.10/GB |
| Snapshot Storage | $0.20/GB-month |

### Cost Examples

| Scenario | Duration | vCPUs | Memory | Estimated Cost |
|----------|----------|-------|--------|---------------|
| Quick test | 2 min | 1 | 2 GB | ~$0.01 |
| AI code validation | 5 min | 2 | 4 GB | ~$0.03 |
| Build and test | 30 min | 4 | 8 GB | ~$0.34 |
| Long-running task | 2 hr | 8 | 16 GB | ~$2.73 |

These assume 100% CPU utilization. I/O wait time (LLM API calls, DB queries) is **not billed** as Active CPU. Real agent costs are lower since most time is spent waiting for LLM responses.

All Pro usage counts against the $20/month credit.

---

## Mapping to Current operations.ts

How each current `node:fs` operation would translate to the sandbox SDK:

| Current (`node:fs`) | Sandbox SDK Equivalent |
|---------------------|----------------------|
| `stat(path)` | `runCommand("stat", ["--format=%s", path])` or `runCommand("test", ["-f", path])` |
| `readFile(path, "utf-8")` | `sandbox.readFileToBuffer({ path })` then `.toString("utf-8")` |
| `readdir(path, { withFileTypes: true })` | `runCommand("find", [path, "-maxdepth", "1", "-printf", "%y %s %p\n"])` |
| `mkdir(dir, { recursive: true })` | `sandbox.mkDir(path)` |
| `writeFile(path, content)` | `sandbox.writeFiles([{ path, content: Buffer.from(content) }])` |
| Custom `walkDirectoryFromBase` + `globToRegex` | `runCommand("find", [dir, "-name", pattern])` or `runCommand("find", [dir, "-path", pattern])` |
| Custom line-by-line grep | `runCommand("grep", ["-rn", "--include=pattern", regex, dir])` |

### What Improves

- **glob**: Native `find` replaces 75 lines of custom JS (walkDirectoryFromBase + globToRegex + convertGlobChar)
- **grep**: Native `grep -rn` replaces 80 lines of custom JS (file walking + line scanning + binary detection)
- **stat**: Single command replaces multiple async calls
- **Binary detection**: `grep` natively skips binary files with `--binary-files=without-match`

### What Changes Architecturally

- Operations need a `Sandbox` instance instead of importing `node:fs`
- All operations become network calls (sandbox API) instead of local syscalls
- Error handling shifts: `runCommand` returns exit codes instead of throwing ENOENT/EACCES

---

## Key Design Decisions for Agent Integration

### Sandbox Lifecycle Ownership

The Inngest function that runs the agent should own the sandbox lifecycle:

1. Create sandbox (from snapshot or git clone)
2. Pass sandbox instance to operations
3. Agent runs its loop, tools call operations against the sandbox
4. Extract results (git push, read files out, or snapshot)
5. Stop sandbox

### Git Worktrees vs Sandboxes

Worktrees are redundant inside a sandbox. The sandbox **is** the isolated workspace. One agent = one sandbox = one working copy. The agent commits and pushes when done, or changes are extracted via the SDK.

### Snapshot Strategy

Optimal pattern for minimizing startup time:

1. First run: `git clone` → install deps → snapshot
2. Subsequent runs: create from snapshot (milliseconds)
3. On git push webhook: create fresh sandbox → clone → install → snapshot (replaces old one)
4. Fallback: if snapshot expired/deleted, fall back to git clone

### Blank Sandbox Option

For agents generating code from scratch (not modifying existing repos), create with no source:

```typescript
const sandbox = await Sandbox.create({ runtime: "node24" })
```

Empty `/vercel/sandbox` directory. Agent writes files via `writeFiles()` or `runCommand`. Useful for code generation tasks where there's no existing codebase.

---

## Sources

- [Vercel Sandbox Overview](https://vercel.com/docs/vercel-sandbox)
- [SDK Reference](https://vercel.com/docs/vercel-sandbox/sdk-reference)
- [Concepts](https://vercel.com/docs/vercel-sandbox/concepts)
- [Snapshots](https://vercel.com/docs/vercel-sandbox/concepts/snapshots)
- [Firewall](https://vercel.com/docs/vercel-sandbox/concepts/firewall)
- [Authentication](https://vercel.com/docs/vercel-sandbox/concepts/authentication)
- [Pricing](https://vercel.com/docs/vercel-sandbox/pricing)
- [System Specifications](https://vercel.com/docs/vercel-sandbox/system-specifications)
- [Working with Sandbox](https://vercel.com/docs/vercel-sandbox/working-with-sandbox)
- [GitHub Repository](https://github.com/vercel/sandbox)
- [npm: @vercel/sandbox](https://www.npmjs.com/package/@vercel/sandbox)
- Local docs: `docs/vercel/vercel-sandbox/`

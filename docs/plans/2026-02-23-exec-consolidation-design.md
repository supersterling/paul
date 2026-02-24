# Exec Tool Consolidation Design

**Date:** 2026-02-23
**Status:** Approved
**Goal:** Replace 5 custom agent tools with bash-tool (Vercel Labs) + 1 custom edit tool, giving agents full shell power while simplifying the codebase.

## Context

The current agent tooling wraps individual sandbox operations (read, glob, grep, write, edit) as separate AI SDK tools. Each tool has its own Zod schema, execute function, and backing operation — ~530 lines across `fs/tools.ts` and `fs/operations.ts`. Two of these (`glob`, `grep`) are thin wrappers around `sandbox.runCommand("find", ...)` and `sandbox.runCommand("grep", ...)`.

The `bash-tool` package from Vercel Labs provides a single `bash` command tool plus `readFile`/`writeFile`, designed specifically for AI agents using `@vercel/sandbox`. Adopting it eliminates our custom plumbing while giving agents unrestricted shell access (pipes, redirects, `&&`, any Linux command).

## Security Model

No application-level command restrictions. Security is enforced by the sandbox infrastructure:

| Layer | What it provides |
|-------|-----------------|
| **Firecracker microVM** | Kernel-level VM isolation. Code cannot escape to host. |
| **Network firewall** | `networkPolicy: "deny-all"` at sandbox creation. No DNS, no outbound HTTP, no ICMP. |
| **Ephemeral filesystem** | Destroyed on sandbox stop. No persistence. |
| **Seccomp filter** | Vercel applies a seccomp filter (mode 2, 1 filter). Blocks dangerous kernel syscalls. |
| **Unprivileged user** | uid 1000 (`vercel-sandbox`). No capabilities. Cannot write to /etc, /root, system dirs. |
| **Sudo available** | Root access exists but is sandboxed within the ephemeral VM. |

### Empirically Verified (probed 2026-02-23)

- Kernel: 5.10.174 (Firecracker microVM, not the full AL2023 kernel)
- Landlock: **Not available** (requires kernel 5.13+)
- `deny-all` networking: curl, ping, DNS all blocked
- `sudo rm -rf /`: Succeeds (deletes ephemeral files) — operational cost, not security risk
- `kill -9 1`: Crashes sandbox (PID 1 killed) — sandbox terminates, no host impact
- `sandbox.runCommand()`: Uses direct exec, not shell — args with `&&`, `;`, `|` are literal strings

### Design Decision: No Denylist

A denylist was considered and rejected. The AI can bypass any app-level denylist through `sh -c`, `node -e`, or script execution. The VM isolation is the real security boundary. If restrictions are needed later, `bash-tool`'s `onBeforeBashCall` hook provides the interception point.

## Tool Inventory

| Tool | Source | Description |
|------|--------|-------------|
| `bash` | bash-tool | Execute any shell command. Returns stdout, stderr, exitCode. |
| `readFile` | bash-tool | Read file content from sandbox. |
| `writeFile` | bash-tool | Write/create files in sandbox. |
| `edit` | Custom | Find-and-replace exact strings in files. Uses SDK readFileToBuffer + writeFiles. |

All agents (coder, explorer) receive all 4 tools. Behavioral constraints are in agent instructions, not tool restrictions.

## Architecture

### Before

```
coder.ts → { read, glob, grep, write, edit }
              ↓       ↓      ↓      ↓      ↓
           tools.ts (5 execute functions)
              ↓
           operations.ts (read, glob, grep, write, edit implementations)
              ↓
           sandbox.runCommand / readFileToBuffer / writeFiles
```

### After

```
coder.ts → { bash, readFile, writeFile, edit }
              ↓                            ↓
           bash-tool (3 tools)          edit.ts (compound SDK operation)
              ↓                            ↓
           sandbox.runCommand          sandbox.readFileToBuffer + writeFiles
```

## File Changes

### Deleted

| File | Lines | Reason |
|------|-------|--------|
| `src/lib/agent/fs/operations.ts` | ~370 | glob, grep, read, write replaced by bash-tool. Edit logic moves to edit.ts. |
| Most of `src/lib/agent/fs/tools.ts` | ~110 | readTool, writeTool, globTool, grepTool all replaced. |

### Created

| File | Lines (approx) | Purpose |
|------|----------------|---------|
| `src/lib/agent/fs/edit.ts` | ~80 | Edit operation + editTool (extracted from deleted files) |

### Modified

| File | Change |
|------|--------|
| `src/lib/agent/fs/tools.ts` | Replaced with createAgentTools() that merges bash-tool + editTool |
| `src/lib/agent/coder.ts` | tools from createAgentTools() |
| `src/lib/agent/explorer.ts` | tools from createAgentTools() (same tools, different instructions) |
| `package.json` | Add bash-tool dependency |

### Net Impact

~400 lines deleted, ~100 lines added. Agents gain full shell power (any Linux command, pipes, redirects).

## Sandbox Creation Policy

Sandboxes are created with:
- `runtime: "node24"`
- `networkPolicy: "deny-all"`
- Pre-installed tools via snapshots (ripgrep, tree, jq, etc.) for future optimization

## Future Considerations

- **Denylist**: If needed, add via `onBeforeBashCall` hook on `createBashTool()`. No code restructuring required.
- **Snapshots**: Pre-configure sandboxes with dev tools and repos for faster agent startup.
- **Network access**: If agents need to fetch from specific domains, use `updateNetworkPolicy()` with domain allowlists rather than `allow-all`.
- **Kernel upgrade**: If Vercel upgrades the microVM kernel to 5.13+, Landlock becomes available for filesystem-level restrictions.

# Event-Driven Orchestrator Design — Cancel-and-Restart Architecture

**Date:** 2026-02-24
**Status:** Design complete

---

## Problem

The current orchestrator runs a synchronous for-loop: think → dispatch one agent → **block until it returns** → think again. It uses `step.invoke()`, which suspends the entire function until the child completes. The orchestrator cannot think while agents work, cannot spawn agents in parallel, and cannot react to new information mid-thought.

## Goal

An orchestrator that can think, spawn multiple agents in parallel, keep thinking while they work, react when any agent finishes, and handle human feedback — all without race conditions or complex coordination primitives.

---

## Architecture: Cancel-and-Restart

### The Core Mechanism

One Inngest function. One event type. Two Postgres tables. One `cancelOn` config line.

The orchestrator writes **every thought, tool call, and decision** to Postgres (the "notepad") before taking action. When any new signal arrives (agent completion, human response, self-signal), the current orchestrator run is cancelled via `cancelOn` and a fresh run starts. The new run reads the full notepad and picks up with complete context.

**There is never more than one thinker per session.** The old one dies. The new one is born with the full notepad.

### The Analogy: The Manager with Amnesia

A coffee shop manager has complete amnesia and can only function by reading a notepad. The notepad contains every conversation, every decision, every barista report — written chronologically.

Every time someone taps the manager's shoulder (a "signal"):

1. The manager reads the entire notepad from top to bottom
2. Makes decisions based on everything in it
3. Writes those decisions on the notepad
4. Sends baristas out to do work
5. Goes to sleep

The manager doesn't remember anything between taps. But because the notepad is comprehensive, they make perfect decisions every time.

**The interruption rule:** If a barista taps the manager's shoulder while they're mid-decision, the manager **stops immediately**. The page they were writing gets torn out. But all PREVIOUS pages remain. A new tap happens, the manager starts fresh — reads the whole notepad (including the new barista's report that caused the interruption) and makes ONE decision that accounts for everything.

### Why cancelOn

When a `paul/session/signal` event arrives for a sessionId that already has an orchestrator running:

1. `cancelOn` kills the existing run (between steps — current step finishes, next step never starts)
2. The new signal triggers a fresh run of the same function
3. The fresh run reads the full notepad from Postgres

This eliminates race conditions by construction — not by locking, not by queuing, not by debouncing, but by never having two concurrent thinkers.

### Why Not Other Approaches

| Approach | Problem |
|----------|---------|
| `step.invoke()` (blocking) | Manager falls asleep waiting for each barista individually |
| Debounce (wait 2s for more signals) | Adds latency even when only one signal arrives |
| Session lock (BUSY sign on door) | If manager crashes mid-decision, BUSY sign stays up forever |
| Separate collector function | Unnecessary complexity — every signal should wake the thinker |

---

## Signal Atom

Following the principle that interfaces should be as atomic as possible (like Go's `io.Reader`), the signal is:

```
(destination, payload)
```

This maps directly to Inngest's event model:

```
name  = destination    (which function wakes up)
data  = payload        (opaque — the receiver defines the schema)
```

One universal event:

```typescript
"paul/session/signal": {
    sessionId: string       // which notepad
    // ... everything else is sender-defined, receiver-interpreted
}
```

The orchestrator triggers on `paul/session/signal`. All signal sources (agents, humans, self-signals) emit this same event with `sessionId` for correlation. The `cancelOn` matches on `data.sessionId`.

---

## Data Model

### Design Principles

- **Append-only notepad.** Frames are never updated or deleted during an active session. Every new fact is a new row.
- **Derive, don't store.** Session status is derived from frames (are there recent frames? pending tool calls?). `updated_at` is `MAX(session_frame.created_at)`. Don't store what you can derive.
- **Promote columns that Postgres filters on.** Following Prior's pattern: fields that appear in WHERE/ORDER BY clauses get their own columns. Everything else lives in the opaque `data` jsonb.
- **Structural kinds, not semantic kinds.** The `kind` column distinguishes data shape (message vs tool-call vs tool-result), not author or purpose. Author info lives inside `data`.

### Schema

```sql
-- The project folder
CREATE TABLE core.session (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sandbox_id  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    config      JSONB
);

-- The pages inside the folder
CREATE TABLE core.session_frame (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES core.session(id),
    kind        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    data        JSONB NOT NULL
);

CREATE INDEX idx_session_frame_lookup
    ON core.session_frame(session_id, kind, created_at);
```

### Session Table

Four columns:

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid | Session identity |
| `sandbox_id` | text | Primary sandbox for this session (can evolve to multi-sandbox) |
| `created_at` | timestamptz | When the session started |
| `config` | jsonb | Model preferences, token budget, etc. — session-level properties that don't change per-frame |

No `status` column — status is derived from the frames. No `updated_at` — derived from `MAX(session_frame.created_at)`. No `github` — that's a property of the sandbox, not the session.

### Session Frame Table

Five columns:

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid | Frame identity |
| `session_id` | uuid | Which notepad this belongs to (FK → session) |
| `kind` | text | Structural discriminator for efficient Postgres filtering |
| `created_at` | timestamptz | Ordering — which came first |
| `data` | jsonb | The payload (opaque to the table, interpreted by the orchestrator) |

### Kind Vocabulary

Three kinds, distinguished by data structure — not by who wrote the entry:

| kind | What it represents | data shape |
|------|-------------------|------------|
| `message` | Someone said something | `{ role: "user"\|"assistant"\|"system", content: string, ... }` |
| `tool-call` | The LLM requested a tool invocation | `{ toolCallId: string, toolName: string, input: unknown }` |
| `tool-result` | A tool returned a result | `{ toolCallId: string, toolName: string, output: unknown }` |

The `toolCallId` in `tool-call` and `tool-result` links them together — this is how the orchestrator reconstructs the `{ role: "tool", content: [{ toolCallId, output }] }` message shape the LLM expects.

---

## Orchestrator Function

```typescript
inngest.createFunction(
    {
        id: "paul/orchestrate",
        cancelOn: [{
            event: "paul/session/signal",
            if: "async.data.sessionId == event.data.sessionId",
        }],
    },
    { event: "paul/session/signal" },
    async ({ event, step, runId }) => {
        const sessionId = event.data.sessionId

        // 1. Persist the incoming signal to the notepad
        await step.run("persist-signal", () => { /* INSERT INTO session_frame */ })

        // 2. Read the full notepad
        const frames = await step.run("read-notepad", () => {
            /* SELECT * FROM session_frame
               WHERE session_id = ? ORDER BY created_at */
        })

        // 3. Read session config (model, token budget)
        const session = await step.run("read-session", () => {
            /* SELECT * FROM session WHERE id = ? */
        })

        // 4. Reconstruct LLM messages and call LLM
        const thought = await step.run("think", () => {
            const messages = buildMessages(frames)
            return generateText({ model: session.config.model, system, messages, tools })
        })

        // 5. Persist the thought (decisions written BEFORE dispatch)
        await step.run("persist-thought", () => {
            /* INSERT 'message' frame for assistant response
               INSERT 'tool-call' frames for each tool call */
        })

        // 6. Dispatch agents (non-blocking)
        if (thought.staticToolCalls.length > 0) {
            const events = thought.staticToolCalls.map(tc => ({
                name: "paul/agents/run",
                data: {
                    sessionId,
                    toolCallId: tc.toolCallId,
                    prompt: tc.input.prompt,
                    tools: tc.input.tools,
                    model: tc.input.model,
                    sandboxId: session.sandboxId,
                }
            }))
            await step.sendEvent("dispatch", events)
        }

        // 7. Self-signal if more thinking needed
        if (thought.finishReason !== "stop") {
            await step.sendEvent("continue", {
                name: "paul/session/signal",
                data: { sessionId }
            })
        }
    }
)
```

### Step Ordering and Crash Safety

| If cancelled after... | What's in the notepad | What happens on restart |
|-----------------------|----------------------|----------------------|
| Step 1 (persist signal) | Signal recorded | Re-reads notepad, re-thinks with signal included |
| Step 4 (think) | Signal recorded, no thought | LLM call wasted (~$0.01-0.05). Re-thinks with new info |
| Step 5 (persist thought) | Signal + thought + tool calls | Re-reads, sees prior decisions, can re-dispatch |
| Step 6 (dispatch) | Everything persisted, agents fired | Agents running independently. Next signal wakes orchestrator |
| Step 7 (self-signal) | Everything done | Self-signal triggers cancel → new run reads full state |

The pattern ensures: **decisions are in the notepad before actions are taken.** If cancelled between persist and dispatch, the next run sees the decision and can re-dispatch. If cancelled before persist, the thought is lost but re-done with new information (better).

---

## Message Reconstruction (buildMessages)

The orchestrator reads all frames for a session ordered by `created_at` and reconstructs the `ModelMessage[]` array the LLM expects.

### The Algorithm

Walk frames in order:

- `kind: "message"` → emit as `ModelMessage` directly: `{ role: data.role, content: data.content }`
- `kind: "tool-call"` → attach to the preceding assistant message as a `ToolCallPart` in its content array
- `kind: "tool-result"` → group consecutive tool-results, emit as `{ role: "tool", content: [ToolResultPart, ...] }`

### Example

Notepad frames (ordered):

```
1. kind: "message"      data: { role: "user", content: "Migrate the API" }
2. kind: "message"      data: { role: "assistant", content: "I'll explore first." }
3. kind: "tool-call"    data: { toolCallId: "tc_1", toolName: "spawn_agent", input: { ... } }
4. kind: "tool-call"    data: { toolCallId: "tc_2", toolName: "spawn_agent", input: { ... } }
5. kind: "tool-result"  data: { toolCallId: "tc_1", toolName: "spawn_agent", output: { text: "47 endpoints..." } }
6. kind: "message"      data: { role: "assistant", content: "Agent 1 found 47 endpoints..." }
7. kind: "tool-result"  data: { toolCallId: "tc_2", toolName: "spawn_agent", output: { text: "GraphQL advantages..." } }
```

Reconstructed `ModelMessage[]`:

```
{ role: "user", content: "Migrate the API" }
{ role: "assistant", content: [
    { type: "text", text: "I'll explore first." },
    { type: "tool-call", toolCallId: "tc_1", toolName: "spawn_agent", input: { ... } },
    { type: "tool-call", toolCallId: "tc_2", toolName: "spawn_agent", input: { ... } },
]}
{ role: "tool", content: [
    { type: "tool-result", toolCallId: "tc_1", toolName: "spawn_agent", output: { ... } },
]}
{ role: "assistant", content: "Agent 1 found 47 endpoints..." }
{ role: "tool", content: [
    { type: "tool-result", toolCallId: "tc_2", toolName: "spawn_agent", output: { ... } },
]}
```

Frames 2, 3, 4 merge into one assistant message. The `tool-call` frames attach backward to the preceding assistant message's content array.

### Context Window Management

When the notepad exceeds the LLM's context window:

**Phase 1 (build first):** Sliding window — keep system prompt + first user message + last N frames.

**Phase 2 (build when needed):** Summarize-and-compact — when frame count exceeds threshold, the orchestrator generates a summary of old frames, inserts it as a `message` frame with `role: "system"`, and reconstruction uses only frames after the summary. Old frames remain in DB for audit.

---

## Generic Agent Function

Agents are **not typed by name** (no "explore agent" or "code agent"). Following Prior's pattern where actors are configured, not categorized, there is one generic agent function that receives its configuration at dispatch time.

### Dispatch Event

```typescript
"paul/agents/run": {
    sessionId: string,       // which notepad to write results to
    toolCallId: string,      // links back to the orchestrator's tool-call frame
    prompt: string,          // what to do
    tools: string[],         // which tools to enable: ["read", "glob", "grep", "write", "edit", "bash"]
    model: string,           // which model: "gpt-5-nano", "gpt-5.1-codex", etc.
    sandboxId: string,       // which sandbox to work in
}
```

The orchestrator LLM decides the tools and model each task needs. The agent function is a generic runtime that looks up tool definitions by name, constructs `generateText()` with the specified configuration, and runs.

### Orchestrator Tool Schema

```typescript
spawnAgentTool = tool({
    description: "Spawn an agent to perform work in the sandbox.",
    inputSchema: z.object({
        prompt: z.string().min(1).describe("Detailed instructions for the agent"),
        tools: z.array(z.string()).min(1).describe("Tool names to enable"),
        model: z.string().min(1).describe("Model to use"),
    })
})
```

The `sessionId`, `sandboxId`, and `toolCallId` are injected by the orchestrator's dispatch logic — the LLM doesn't decide these.

### Agent Completion

When an agent finishes, it does two things:

1. **Writes to the notepad** — inserts a `tool-result` frame:
```typescript
INSERT INTO session_frame (session_id, kind, data) VALUES (
    sessionId,
    'tool-result',
    { toolCallId, toolName: "spawn_agent", output: { type: "json", value: { text, stepCount, totalUsage } } }
)
```

2. **Signals the orchestrator** — emits the wake event:
```typescript
step.sendEvent("signal-parent", {
    name: "paul/session/signal",
    data: { sessionId }
})
```

Agents are separate Inngest functions, unaffected by orchestrator cancellation. They run independently and signal when done.

### Agent Results Are Summaries

Agent results in the `tool-result` frame should be summaries, not raw data. The agent's internal tool calls and file contents live in its own Inngest step history. If an agent needs to pass large artifacts, it stores them in the sandbox filesystem and puts a reference in the result: `{ summary: "...", artifactPath: "/vercel/sandbox/output.ts" }`.

---

## CTA Integration

Human feedback (CTA) fits naturally — it's just a slow tool call:

1. The LLM calls `request_human_feedback` tool → orchestrator writes `tool-call` frame and emits `paul/cta/request` event
2. The orchestrator self-signals to keep thinking (or goes dormant if nothing else to do)
3. Human responds → system writes `tool-result` frame to the notepad and emits `paul/session/signal`
4. Orchestrator wakes, reads notepad (sees CTA question + answer as a tool-call/tool-result pair), continues

CTA doesn't block anything. While waiting for a human, agents can complete, the orchestrator can keep thinking about other aspects, and everything accumulates on the notepad.

---

## Token Cost Tracking

**Per-frame:** Every `message` frame from the orchestrator includes `usage` in its data. Every `tool-result` frame from agents includes their `totalUsage`.

**Per-session:** The orchestrator sums usage across all frames at read time. No separate counter — derive from the notepad. If the cumulative usage exceeds `session.config.tokenBudget`, the LLM gets a system message: "Token budget exhausted. Summarize findings and stop."

No extra table, no extra column. The frames ARE the token ledger.

---

## Cancellation Propagation

**Not built now.** Agents are short-lived (seconds to minutes). The cost of letting them finish unnecessarily is small.

When needed, agents would get their own `cancelOn`:

```typescript
cancelOn: [{
    event: "paul/session/cancel",
    if: "async.data.sessionId == event.data.sessionId",
}]
```

The orchestrator (or user action) emits `paul/session/cancel { sessionId }` to stop all agents in a session.

---

## Session Creation Flow

```
User submits task via UI
  → API route creates sandbox: paul/sandbox/create → sandboxId
  → API route creates session: INSERT INTO session (sandbox_id, config)
  → API route creates first frame: INSERT INTO session_frame (session_id, kind: "message", data: { role: "user", content: "..." })
  → API route emits: paul/session/signal { sessionId }
  → Orchestrator wakes, reads notepad (one user message), starts thinking
```

---

## Provenance

This design emerged from evaluating multiple architectures:

- **CTA orchestrator** (2026-02-23): Correct direction (Inngest, typed CTAs, durable human gates) but blocking `step.invoke()` prevents parallelism
- **Cord Protocol** (2026-02-21): Elegant tree decomposition, but zero production systems use it — every Anthropic system is flat orchestrator-worker
- **Prior kernel** (studied 2026-02-24): Frame-based message routing with shared history bulletin board — the patterns (bulletin board, mind wake, universal envelope, parent_id correlation, generic actors) directly shaped this design
- **Anthropic production systems**: C compiler (peer-to-peer git), research system (flat orchestrator-worker), Agent SDK (one-level subagents), TeammateTool (hub-and-spoke, no nesting) — all validate flat coordination, not trees
- **"Building Effective Agents"** (Anthropic, Dec 2024): "Start with the simplest architecture that works" — orchestrator-workers pattern #4

The cancel-and-restart mechanism was proposed during brainstorming as an alternative to debouncing, locking, or two-function collector/thinker splits. It uses Inngest's native `cancelOn` to guarantee single-thinker semantics without custom state management.

The generic agent function (one runtime, configured per-dispatch) follows Prior's pattern where actors are defined by configuration, not category. The orchestrator LLM decides what tools and model each task needs at dispatch time.

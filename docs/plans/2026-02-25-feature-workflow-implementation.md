# Feature Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a phased prompt workflow (research, propose, build, review, pr) to the Cursor Slack bot, driven by DB-stored prompt sections with per-repo overrides and user-controlled transitions.

**Architecture:** Two new DB tables store ordered prompt sections. A compose function merges base + override sections at runtime. The bot launches agents with composed prompts, tracks the current phase, and posts a "Continue" button after each phase completion. Follow-ups within a phase reuse the existing follow-up infrastructure.

**Tech Stack:** Drizzle ORM (PostgreSQL), Inngest, Chat SDK (Slack), Cursor Cloud Agent API

---

### Task 1: Create prompt schema

**Files:**
- Create: `src/db/schemas/prompt.ts`

**Step 1: Create the schema file**

```typescript
import { integer, pgSchema, text, uuid } from "drizzle-orm/pg-core"

const agentSchema = pgSchema("agent")

const promptPhases = agentSchema.table("prompt_phases", {
	id: uuid("id").defaultRandom().primaryKey(),
	phase: text("phase").notNull(),
	header: text("header").notNull(),
	content: text("content").notNull(),
	position: integer("position").notNull()
})

const promptPhaseOverrides = agentSchema.table("prompt_phase_overrides", {
	id: uuid("id").defaultRandom().primaryKey(),
	repository: text("repository").notNull(),
	phase: text("phase").notNull(),
	header: text("header").notNull(),
	content: text("content").notNull(),
	position: integer("position").notNull()
})

export { promptPhaseOverrides, promptPhases }
```

**Step 2: Register schema in db/index.ts**

In `src/db/index.ts`, add:

```typescript
import * as prompt from "@/db/schemas/prompt"
```

Add `...prompt` to the schema spread.

**Step 3: Register schema in drizzle.config.ts**

Add `"./src/db/schemas/prompt.ts"` to the schema array.

**Step 4: Push schema to database**

Run: `bun db:push`

**Step 5: Verify**

Run: `bun typecheck`
Expected: clean

**Step 6: Commit**

```bash
git add src/db/schemas/prompt.ts src/db/index.ts drizzle.config.ts
git commit -m "feat: add prompt_phases and prompt_phase_overrides tables"
```

---

### Task 2: Add workflow columns to cursor_agent_threads

**Files:**
- Modify: `src/db/schemas/cursor.ts`

**Step 1: Add columns**

Add `currentPhase` and `workflowActive` to `cursor_agent_threads`:

```typescript
import { boolean, pgSchema, text, timestamp } from "drizzle-orm/pg-core"

const agentSchema = pgSchema("agent")

const cursorAgentThreads = agentSchema.table("cursor_agent_threads", {
	threadId: text("thread_id").primaryKey(),
	agentId: text("agent_id").notNull(),
	status: text("status").notNull(),
	repository: text("repository").notNull(),
	ref: text("ref").notNull(),
	branchName: text("branch_name"),
	agentUrl: text("agent_url").notNull(),
	pendingFollowup: text("pending_followup"),
	currentPhase: text("current_phase"),
	workflowActive: boolean("workflow_active").notNull().default(false),
	createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull()
})

export { cursorAgentThreads }
```

**Step 2: Push schema**

Run: `bun db:push`

**Step 3: Verify**

Run: `bun typecheck`

**Step 4: Commit**

```bash
git add src/db/schemas/cursor.ts
git commit -m "feat: add currentPhase and workflowActive to cursor_agent_threads"
```

---

### Task 3: Build prompt composition function

**Files:**
- Create: `src/lib/prompt-compose.ts`

**Step 1: Create the compose function**

```typescript
import * as logger from "@superbuilders/slog"
import { and, asc, eq } from "drizzle-orm"
import { db } from "@/db"
import { promptPhaseOverrides, promptPhases } from "@/db/schemas/prompt"

type PromptSection = {
	header: string
	content: string
	position: number
}

const PHASE_ORDER = ["research", "propose", "build", "review", "pr"]

async function composePhasePrompt(
	phase: string,
	repository: string,
	featureRequest?: string
): Promise<string> {
	logger.debug("composing phase prompt", { phase, repository })

	const baseSections = await db
		.select({
			header: promptPhases.header,
			content: promptPhases.content,
			position: promptPhases.position
		})
		.from(promptPhases)
		.where(eq(promptPhases.phase, phase))
		.orderBy(asc(promptPhases.position))

	const overrideSections = await db
		.select({
			header: promptPhaseOverrides.header,
			content: promptPhaseOverrides.content,
			position: promptPhaseOverrides.position
		})
		.from(promptPhaseOverrides)
		.where(
			and(
				eq(promptPhaseOverrides.phase, phase),
				eq(promptPhaseOverrides.repository, repository)
			)
		)
		.orderBy(asc(promptPhaseOverrides.position))

	const merged = mergeSections(baseSections, overrideSections)

	if (featureRequest) {
		merged.push({ header: "Feature Request", content: featureRequest, position: 9999 })
	}

	const blocks = merged.map((s) => `## ${s.header}\n\n${s.content}`)

	logger.debug("prompt composed", { phase, sectionCount: blocks.length })

	return blocks.join("\n\n")
}

function mergeSections(base: PromptSection[], overrides: PromptSection[]): PromptSection[] {
	const overrideMap = new Map<string, PromptSection>()
	const newSections: PromptSection[] = []

	for (const override of overrides) {
		const matchesBase = base.some((b) => b.header === override.header)
		if (matchesBase) {
			overrideMap.set(override.header, override)
		} else {
			newSections.push(override)
		}
	}

	const merged = base.map((section) => {
		const override = overrideMap.get(section.header)
		if (override) {
			return { ...section, content: override.content }
		}
		return section
	})

	for (const section of newSections) {
		merged.push(section)
	}

	merged.sort((a, b) => a.position - b.position)

	return merged
}

function nextPhase(current: string): string | undefined {
	const idx = PHASE_ORDER.indexOf(current)
	if (idx === -1) {
		return undefined
	}
	const next = PHASE_ORDER[idx + 1]
	return next
}

function phaseLabel(phase: string): string {
	const labels: Record<string, string> = {
		research: "Research",
		propose: "Propose",
		build: "Build",
		review: "Review",
		pr: "PR"
	}
	const label = labels[phase]
	if (!label) {
		return phase
	}
	return label
}

export { composePhasePrompt, nextPhase, PHASE_ORDER, phaseLabel }
```

**Step 2: Verify**

Run: `bun typecheck`

**Step 3: Lint**

Run: `bun scripts/dev/lint.ts src/lib/prompt-compose.ts`

**Step 4: Commit**

```bash
git add src/lib/prompt-compose.ts
git commit -m "feat: add prompt composition with base + override merging"
```

---

### Task 4: Update format.ts with phase-aware result message

**Files:**
- Modify: `src/inngest/functions/cursor/format.ts`

**Step 1: Add buildPhaseResultMessage**

Add this function alongside the existing `buildResultMessage`. It produces the phase-completion card with a "Continue" button (as a Slack mrkdwn string — the card itself is built in the lifecycle function).

```typescript
function buildPhaseResultMessage(
	phase: string,
	nextPhaseLabel: string | undefined,
	agentUrl: string,
	lastAssistantMessage: string
): string {
	const label = phase.charAt(0).toUpperCase() + phase.slice(1)
	const lines: string[] = []

	lines.push(`*${label} complete*`)

	if (lastAssistantMessage) {
		lines.push("")
		const quoted = lastAssistantMessage
			.split("\n")
			.map((line) => `> ${line}`)
			.join("\n")
		lines.push(quoted)
	}

	lines.push("")
	lines.push(`<${agentUrl}|View in Cursor>`)

	if (nextPhaseLabel) {
		lines.push("")
		lines.push(`Reply with feedback, or continue to the next phase.`)
	}

	return lines.join("\n")
}
```

Export it alongside `buildResultMessage`.

**Step 2: Verify**

Run: `bun typecheck && bun scripts/dev/lint.ts src/inngest/functions/cursor/format.ts`

**Step 3: Commit**

```bash
git add src/inngest/functions/cursor/format.ts
git commit -m "feat: add buildPhaseResultMessage for workflow phase completions"
```

---

### Task 5: Update agent-lifecycle to support workflow mode

**Files:**
- Modify: `src/inngest/functions/cursor/agent-lifecycle.ts`

**Step 1: Pass workflowActive and currentPhase in the launch event**

The `cursor/agent.launch` event data needs two new optional fields. Update the event schema in `src/inngest/index.ts`:

```typescript
"cursor/agent.launch": z.object({
	prompt: z.string().min(1),
	repository: z.string().min(1),
	ref: z.string().min(1),
	threadId: z.string().min(1),
	workflowActive: z.boolean().default(false),
	currentPhase: z.string().optional()
}),
```

**Step 2: Update post-confirmation to set workflow columns**

In agent-lifecycle.ts `post-confirmation` step, update the `db.insert` to include the new fields:

```typescript
await db.insert(cursorAgentThreads).values({
	threadId,
	agentId: agent.agentId,
	status: "CREATING",
	repository,
	ref,
	branchName: agent.branchName,
	agentUrl: agent.url,
	currentPhase: event.data.currentPhase,
	workflowActive: event.data.workflowActive,
	createdAt: new Date()
})
```

**Step 3: Update post-result to post phase card when workflowActive**

In the `post-result` step, after the existing result posting logic, add workflow-aware behavior. When `workflowActive` is true and the agent finished successfully, post a phase-completion message with a "Continue" button card instead of the standard result message.

Import `buildPhaseResultMessage` from format.ts and `nextPhase`, `phaseLabel` from prompt-compose.

Read the `workflowActive` and `currentPhase` from the event data (not the DB — it's available from the trigger event). If `workflowActive` is true:
- Use `buildPhaseResultMessage` instead of `buildResultMessage`
- Post a `Card` with a "Continue to {NextPhase}" `Button` (actionId: `cursor-phase-continue`) if there's a next phase
- If current phase is `pr` (final), post the standard result message and set `workflowActive = false` in DB

The `Card` and `Button` imports need to come from `chat`. Since this file runs in Inngest (serverless), and Chat SDK's `Card`/`Button` are function-call builders (not JSX), they work fine here.

Add the card posting using `t.post(card)` where `card` is built with `Card({ children: [...] })`.

**Step 4: Verify**

Run: `bun typecheck && bun scripts/dev/lint.ts src/inngest/functions/cursor/agent-lifecycle.ts src/inngest/index.ts`

**Step 5: Commit**

```bash
git add src/inngest/functions/cursor/agent-lifecycle.ts src/inngest/index.ts
git commit -m "feat: agent-lifecycle posts phase card when workflowActive"
```

---

### Task 6: Update followup-lifecycle for workflow mode

**Files:**
- Modify: `src/inngest/functions/cursor/followup-lifecycle.ts`

**Step 1: Read workflowActive from DB in post-followup-result**

In the `post-followup-result` step, after claiming the row, query the current `workflowActive` and `currentPhase` from the DB row (they're already on the row from the claim update — add them to the returning clause, or do a separate read).

If `workflowActive` is true, use `buildPhaseResultMessage` and post a "Continue" button card, same as agent-lifecycle.

If `workflowActive` is false, use `buildResultMessage` as before.

**Step 2: Add cursor/followup.sent event data**

The `cursor/followup.sent` event needs `workflowActive` so followup-lifecycle knows whether to post phase cards. But actually, the followup-lifecycle can just read from the DB since the `cursor_agent_threads` row already has `workflowActive`. No event schema change needed.

**Step 3: Verify**

Run: `bun typecheck && bun scripts/dev/lint.ts src/inngest/functions/cursor/followup-lifecycle.ts`

**Step 4: Commit**

```bash
git add src/inngest/functions/cursor/followup-lifecycle.ts
git commit -m "feat: followup-lifecycle posts phase card when workflowActive"
```

---

### Task 7: Update bot.ts with workflow launch and phase-continue handler

**Files:**
- Modify: `src/lib/bot.ts`

**Step 1: Update handleNewMention to compose and launch with workflow**

In `handleNewMention`, after getting the channel config:
1. Call `composePhasePrompt("research", config.repository, prompt)` to build the composed prompt
2. Send the `cursor/agent.launch` event with `workflowActive: true` and `currentPhase: "research"`
3. Use the composed prompt instead of the raw user prompt

Import `composePhasePrompt` from `@/lib/prompt-compose`.

**Step 2: Add cursor-phase-continue action handler**

Register `bot.onAction("cursor-phase-continue", ...)` with error wrapping (same pattern as existing action handlers).

The handler function `handlePhaseContinue(thread, threadId)`:
1. Read `currentPhase`, `agentId`, `agentUrl`, `repository` from `cursor_agent_threads`
2. If no row or no currentPhase, throw error
3. Call `nextPhase(currentPhase)` to get the next phase
4. If no next phase, post "Workflow complete." and return
5. Call `composePhasePrompt(nextPhaseStr, repository)` — no featureRequest for non-research phases
6. Call `sendFollowup(apiKey, agentId, composedPrompt)`
7. Update `currentPhase` to the next phase in DB
8. Fire `cursor/followup.sent` event
9. Post confirmation: `*{NextPhaseLabel}*\n\nPhase prompt sent to the agent. Waiting for a response...`

Import `composePhasePrompt`, `nextPhase`, `phaseLabel` from `@/lib/prompt-compose`.

**Step 3: Verify**

Run: `bun typecheck && bun scripts/dev/lint.ts src/lib/bot.ts`

**Step 4: Commit**

```bash
git add src/lib/bot.ts
git commit -m "feat: bot launches with composed prompt, adds phase-continue handler"
```

---

### Task 8: Seed initial prompt data

**Files:**
- Create: `src/db/scripts/seed-prompts.ts`

**Step 1: Write seed script**

Create a script that inserts placeholder prompt sections for all 5 phases. Each phase gets 2-4 sections with headers like "Role", "Methodology", "Subagent Strategy", "Output Format".

The content should be substantive placeholder text capturing the intent from the design doc:
- **research**: role as senior engineer, use subagents to explore in parallel, map dependencies, identify risks, ask user when confused
- **propose**: generate 2-3 approaches, steelman each, use subagents for deep-dives, present trade-offs clearly
- **build**: implement the selected approach, use subagents for parallel file work, run tests, iterate
- **review**: spawn review subagents for security/performance/rules, report findings with severity
- **pr**: create PR with structured description, link findings

Use `db.insert(promptPhases).values([...])` with `onConflictDoNothing()`.

**Step 2: Run the seed**

Run: `bun src/db/scripts/seed-prompts.ts`

**Step 3: Verify data**

Run: `bun db:studio` and check the `agent.prompt_phases` table has rows.

**Step 4: Commit**

```bash
git add src/db/scripts/seed-prompts.ts
git commit -m "feat: add seed script for initial prompt phase data"
```

---

### Task 9: End-to-end verification

**Step 1: Typecheck everything**

Run: `bun typecheck`
Expected: clean

**Step 2: Lint everything**

Run: `bun scripts/dev/lint.ts src/db/schemas/prompt.ts src/db/schemas/cursor.ts src/lib/prompt-compose.ts src/lib/bot.ts src/inngest/functions/cursor/format.ts src/inngest/functions/cursor/agent-lifecycle.ts src/inngest/functions/cursor/followup-lifecycle.ts src/inngest/index.ts`
Expected: no violations

**Step 3: Push and deploy**

Run: `git push`

**Step 4: Test in Slack**

1. @mention bot with a feature request → agent launches with composed research prompt
2. Agent finishes → phase card with "Continue to Propose" button appears
3. Type feedback → sent as follow-up to research phase → phase card reappears
4. Click "Continue to Propose" → propose prompt sent → agent works
5. Continue through build → review → pr
6. After pr completes → "Workflow complete", no continue button

# Thread Message Queue Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a per-thread FIFO message queue so users can stack multiple tasks while an agent is running, auto-processed sequentially.

**Architecture:** New `cursor_thread_queue` DB table stores ordered queue items per thread. The existing `handleSubscribedMessage` flow adds a "Queue This" button alongside "Stop & Send Now". Inngest `agent-lifecycle` gains a `check-queue` step that auto-launches the next item after each agent completes.

**Tech Stack:** Drizzle ORM (PostgreSQL), Chat SDK (cards, actions, ephemeral messages), Inngest (step orchestration)

**Design doc:** `docs/plans/2026-02-25-thread-message-queue-design.md`

---

## Task 1: Add queue table schema

**Files:**
- Modify: `src/db/schemas/cursor.ts`

**Step 1: Add the `cursorThreadQueue` table definition**

Add after the existing `cursorAgentThreads` table:

```typescript
const cursorThreadQueue = agentSchema.table("cursor_thread_queue", {
	id: serial("id").primaryKey(),
	threadId: text("thread_id").notNull(),
	prompt: text("prompt").notNull(),
	rawMessage: text("raw_message").notNull(),
	slackUserId: text("slack_user_id").notNull(),
	messageId: text("message_id").notNull(),
	position: integer("position").notNull(),
	status: text("status").notNull(),
	createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull()
})
```

Add `serial` and `integer` to the `drizzle-orm/pg-core` import.

Export `cursorThreadQueue` alongside `cursorAgentThreads`.

**Step 2: Push schema to dev database**

Run: `bun db:push`
Expected: Table `agent.cursor_thread_queue` created successfully.

**Step 3: Verify with typecheck**

Run: `bun typecheck`
Expected: PASS

**Step 4: Commit**

```
feat(db): add cursor_thread_queue table for message queue
```

---

## Task 2: Add queue helper functions

**Files:**
- Create: `src/lib/queue.ts`

These are pure DB operations extracted into a module so both `bot.ts` and `agent-lifecycle.ts` can use them without duplicating queries.

**Step 1: Create `src/lib/queue.ts`**

```typescript
import * as errors from "@superbuilders/errors"
import * as logger from "@superbuilders/slog"
import { and, asc, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { cursorThreadQueue } from "@/db/schemas/cursor"

const MAX_QUEUE_SIZE = 5

type QueueItem = {
	id: number
	threadId: string
	prompt: string
	rawMessage: string
	slackUserId: string
	messageId: string
	position: number
	status: string
	createdAt: Date
}

async function enqueue(item: {
	threadId: string
	prompt: string
	rawMessage: string
	slackUserId: string
	messageId: string
}): Promise<{ position: number; id: number }> {
	const pendingCount = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(cursorThreadQueue)
		.where(
			and(
				eq(cursorThreadQueue.threadId, item.threadId),
				eq(cursorThreadQueue.status, "pending")
			)
		)

	const count = pendingCount[0]?.count
	if (count === undefined) {
		logger.error("failed to count pending queue items", { threadId: item.threadId })
		throw errors.new("queue count query returned no rows")
	}

	if (count >= MAX_QUEUE_SIZE) {
		logger.warn("queue full", { threadId: item.threadId, count })
		throw errors.new("queue full")
	}

	const position = count + 1

	const inserted = await db
		.insert(cursorThreadQueue)
		.values({
			threadId: item.threadId,
			prompt: item.prompt,
			rawMessage: item.rawMessage,
			slackUserId: item.slackUserId,
			messageId: item.messageId,
			position,
			status: "pending",
			createdAt: new Date()
		})
		.returning({ id: cursorThreadQueue.id })

	const row = inserted[0]
	if (!row) {
		logger.error("queue insert returned no rows", { threadId: item.threadId })
		throw errors.new("queue insert failed")
	}

	logger.info("enqueued", { threadId: item.threadId, position, id: row.id })

	return { position, id: row.id }
}

async function dequeue(id: number): Promise<QueueItem | undefined> {
	const rows = await db
		.update(cursorThreadQueue)
		.set({ status: "cancelled" })
		.where(and(eq(cursorThreadQueue.id, id), eq(cursorThreadQueue.status, "pending")))
		.returning({
			id: cursorThreadQueue.id,
			threadId: cursorThreadQueue.threadId,
			prompt: cursorThreadQueue.prompt,
			rawMessage: cursorThreadQueue.rawMessage,
			slackUserId: cursorThreadQueue.slackUserId,
			messageId: cursorThreadQueue.messageId,
			position: cursorThreadQueue.position,
			status: cursorThreadQueue.status,
			createdAt: cursorThreadQueue.createdAt
		})

	const row = rows[0]
	if (!row) {
		logger.warn("dequeue failed, item not found or not pending", { id })
		return undefined
	}

	await compactPositions(row.threadId)

	logger.info("dequeued", { id, threadId: row.threadId })

	return row
}

async function popNext(threadId: string): Promise<QueueItem | undefined> {
	const rows = await db
		.select({
			id: cursorThreadQueue.id,
			threadId: cursorThreadQueue.threadId,
			prompt: cursorThreadQueue.prompt,
			rawMessage: cursorThreadQueue.rawMessage,
			slackUserId: cursorThreadQueue.slackUserId,
			messageId: cursorThreadQueue.messageId,
			position: cursorThreadQueue.position,
			status: cursorThreadQueue.status,
			createdAt: cursorThreadQueue.createdAt
		})
		.from(cursorThreadQueue)
		.where(
			and(
				eq(cursorThreadQueue.threadId, threadId),
				eq(cursorThreadQueue.status, "pending")
			)
		)
		.orderBy(asc(cursorThreadQueue.position))
		.limit(1)

	const row = rows[0]
	if (!row) {
		return undefined
	}

	await db
		.update(cursorThreadQueue)
		.set({ status: "processing" })
		.where(eq(cursorThreadQueue.id, row.id))

	await compactPositions(threadId)

	logger.info("popped next queue item", { id: row.id, threadId })

	return { ...row, status: "processing" }
}

async function pendingCount(threadId: string): Promise<number> {
	const rows = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(cursorThreadQueue)
		.where(
			and(
				eq(cursorThreadQueue.threadId, threadId),
				eq(cursorThreadQueue.status, "pending")
			)
		)

	return rows[0]?.count ?? 0
}

async function compactPositions(threadId: string): Promise<void> {
	const pending = await db
		.select({ id: cursorThreadQueue.id })
		.from(cursorThreadQueue)
		.where(
			and(
				eq(cursorThreadQueue.threadId, threadId),
				eq(cursorThreadQueue.status, "pending")
			)
		)
		.orderBy(asc(cursorThreadQueue.position))

	for (let i = 0; i < pending.length; i++) {
		const item = pending[i]
		if (!item) continue
		await db
			.update(cursorThreadQueue)
			.set({ position: i + 1 })
			.where(eq(cursorThreadQueue.id, item.id))
	}
}

export { MAX_QUEUE_SIZE, dequeue, enqueue, pendingCount, popNext }
export type { QueueItem }
```

**Step 2: Verify with typecheck**

Run: `bun typecheck`
Expected: PASS

**Step 3: Run lint**

Run: `bun lint`
Expected: PASS

**Step 4: Commit**

```
feat(queue): add queue helper functions for enqueue/dequeue/popNext
```

---

## Task 3: Refactor handleSubscribedMessage to show queue button

**Files:**
- Modify: `src/lib/bot.ts:150-214` (the `handleSubscribedMessage` function, specifically the "agent is running" branch)

**Context:** Currently when the agent is RUNNING/CREATING and a user posts, the bot stores `pendingFollowup` (single slot) and shows an ephemeral with "Stop & Send Follow-up" and "Cancel" buttons. We need to replace this with three buttons: "Queue This", "Stop & Send Now", and "Cancel".

**Step 1: Add imports**

Add to the top of `bot.ts`:

```typescript
import { enqueue, pendingCount, MAX_QUEUE_SIZE } from "@/lib/queue"
```

**Step 2: Replace the RUNNING/CREATING branch**

Replace lines 188-214 (the `if (row.status === "RUNNING" || row.status === "CREATING")` block) with:

```typescript
	if (row.status === "RUNNING" || row.status === "CREATING") {
		const queueCount = await pendingCount(thread.id)
		const queueFull = queueCount >= MAX_QUEUE_SIZE

		await db
			.update(cursorAgentThreads)
			.set({ pendingFollowup: followupText })
			.where(eq(cursorAgentThreads.threadId, thread.id))

		const buttons = []

		if (!queueFull) {
			const position = queueCount + 1
			buttons.push(
				Button({
					id: "cursor-queue",
					label: `Queue This (#${position} in line)`,
					style: "primary"
				})
			)
		}

		buttons.push(
			Button({
				id: "cursor-stop-and-followup",
				label: "Stop & Send Now",
				style: "danger"
			})
		)

		buttons.push(
			Button({
				id: "cursor-cancel-followup",
				label: "Cancel"
			})
		)

		const statusText = queueFull
			? `The agent is still running. Queue is full (${MAX_QUEUE_SIZE}/${MAX_QUEUE_SIZE}).`
			: "The agent is still running. What would you like to do?"

		const card = Card({
			children: [
				CardText(statusText),
				Actions(buttons)
			]
		})

		await thread.postEphemeral(message.author, card, { fallbackToDM: false })
		await reactToMessage(thread, message.id, "see_no_evil", "remove")
		return
	}
```

Note: We still write `pendingFollowup` for the "Stop & Send Now" path which reads it. The queue button path reads the message text from the action event context instead.

**Step 3: Verify with typecheck**

Run: `bun typecheck`
Expected: PASS

**Step 4: Commit**

```
refactor(bot): show queue button in agent-running ephemeral
```

---

## Task 4: Add cursor-queue action handler

**Files:**
- Modify: `src/lib/bot.ts` (add new `onAction` handler after existing ones, around line 62)

**Step 1: Add the queue action handler**

Add after the `cursor-cancel-followup` handler:

```typescript
bot.onAction("cursor-queue", async (event) => {
	const result = await errors.try(handleQueue(event.thread, event.threadId, event.user))
	if (result.error) {
		logger.error("queue action failed", { error: result.error, threadId: event.threadId })
		await postError(event.thread, result.error)
	}
})
```

**Step 2: Add the `handleQueue` function**

Add this function in the handler functions section of `bot.ts`:

```typescript
async function handleQueue(
	thread: Thread<unknown>,
	threadId: string,
	user: IncomingMessage["author"]
): Promise<void> {
	logger.info("queue action", { threadId, userId: user.userId })

	const rows = await db
		.select({
			pendingFollowup: cursorAgentThreads.pendingFollowup,
			repository: cursorAgentThreads.repository
		})
		.from(cursorAgentThreads)
		.where(eq(cursorAgentThreads.threadId, threadId))

	const row = rows[0]
	if (!row) {
		logger.error("no agent found for queue action", { threadId })
		throw errors.new("no agent found for this thread")
	}

	if (!row.pendingFollowup) {
		logger.error("no pending message for queue action", { threadId })
		throw errors.new("no pending message to queue")
	}

	const config = CHANNEL_REPOS[thread.channelId]
	if (!config) {
		logger.error("no repo config for channel", { channelId: thread.channelId })
		throw errors.new("no repo configured for this channel")
	}

	const composedPrompt = await composeWorkflowPrompt(
		config.repository,
		row.pendingFollowup,
		user.userId
	)

	const ErrQueueFull = errors.new("queue full")
	const enqueueResult = await errors.try(
		enqueue({
			threadId,
			prompt: composedPrompt,
			rawMessage: row.pendingFollowup,
			slackUserId: user.userId,
			messageId: ""
		})
	)
	if (enqueueResult.error) {
		if (errors.is(enqueueResult.error, ErrQueueFull)) {
			await thread.postEphemeral(user, "Queue is full. Wait for an agent to finish or remove a queued item.", { fallbackToDM: false })
			return
		}
		logger.error("enqueue failed", { error: enqueueResult.error, threadId })
		throw errors.wrap(enqueueResult.error, "enqueue")
	}

	await db
		.update(cursorAgentThreads)
		.set({ pendingFollowup: null })
		.where(eq(cursorAgentThreads.threadId, threadId))

	await thread.postEphemeral(
		user,
		`Queued at position #${enqueueResult.data.position}`,
		{ fallbackToDM: false }
	)

	logger.info("message queued", {
		threadId,
		position: enqueueResult.data.position,
		queueItemId: enqueueResult.data.id
	})
}
```

Note: The `messageId` is empty string for now since the action event doesn't carry the original message ID. The hourglass reaction would need the message ID from the original `onSubscribedMessage` — we should store it in `pendingFollowup` metadata or a separate field. For MVP, skip the hourglass reaction on queue and add it in a follow-up.

**Step 3: Verify with typecheck**

Run: `bun typecheck`
Expected: PASS

**Step 4: Run lint**

Run: `bun lint`
Expected: PASS

**Step 5: Commit**

```
feat(bot): add cursor-queue action handler for enqueuing messages
```

---

## Task 5: Add cursor-dequeue action handler

**Files:**
- Modify: `src/lib/bot.ts` (add new `onAction` handler)

**Step 1: Add the dequeue action handler**

```typescript
bot.onAction("cursor-dequeue", async (event) => {
	const result = await errors.try(handleDequeue(event.thread, event.value))
	if (result.error) {
		logger.error("dequeue action failed", { error: result.error, threadId: event.threadId })
		await postError(event.thread, result.error)
	}
})
```

**Step 2: Add the `handleDequeue` function**

Add import at top of file:

```typescript
import { dequeue, enqueue, pendingCount, MAX_QUEUE_SIZE } from "@/lib/queue"
```

(Update the existing import to include `dequeue`.)

Then add the function:

```typescript
async function handleDequeue(thread: Thread<unknown>, value?: string): Promise<void> {
	if (!value) {
		logger.error("dequeue action missing queue item id")
		throw errors.new("missing queue item id")
	}

	const id = Number.parseInt(value, 10)
	if (Number.isNaN(id)) {
		logger.error("dequeue action invalid queue item id", { value })
		throw errors.new("invalid queue item id")
	}

	logger.info("dequeue action", { queueItemId: id })

	const item = await dequeue(id)
	if (!item) {
		await thread.postEphemeral(
			{ userId: "", userName: "", fullName: "", isBot: false, isMe: false },
			"Item was already removed or processed.",
			{ fallbackToDM: false }
		)
		return
	}

	if (item.messageId) {
		await reactToMessage(thread, item.messageId, "hourglass_flowing_sand", "remove")
	}

	logger.info("dequeued", { queueItemId: id, threadId: item.threadId })
}
```

Note: The dequeue button `value` carries the queue item ID as a string. The button is rendered in the queue confirmation ephemeral. We need to update the queue confirmation to include the dequeue button — this is done in Task 6.

**Step 3: Verify with typecheck**

Run: `bun typecheck`
Expected: PASS

**Step 4: Commit**

```
feat(bot): add cursor-dequeue action handler
```

---

## Task 6: Update queue confirmation to include dequeue button

**Files:**
- Modify: `src/lib/bot.ts` — the `handleQueue` function from Task 4

**Step 1: Update the queue confirmation ephemeral**

Replace the simple `"Queued at position #N"` ephemeral with a card that includes a dequeue button:

```typescript
	const confirmCard = Card({
		children: [
			CardText(`Queued at position #${enqueueResult.data.position}.`),
			Actions([
				Button({
					id: "cursor-dequeue",
					label: "Remove from Queue",
					style: "danger",
					value: String(enqueueResult.data.id)
				})
			])
		]
	})

	await thread.postEphemeral(user, confirmCard, { fallbackToDM: false })
```

**Step 2: Verify with typecheck**

Run: `bun typecheck`
Expected: PASS

**Step 3: Commit**

```
feat(bot): add dequeue button to queue confirmation ephemeral
```

---

## Task 7: Add check-queue step to agent-lifecycle

**Files:**
- Modify: `src/inngest/functions/cursor/agent-lifecycle.ts:159-199` (after the `post-result` step, before the return)

**Step 1: Add import**

Add to the top of the file:

```typescript
import { popNext } from "@/lib/queue"
```

**Step 2: Add the check-queue step**

Insert after the `"post-result"` step (after line 197, before the final `return`):

```typescript
		await step.run("check-queue", async () => {
			const next = await popNext(threadId)
			if (!next) {
				logger.info("no queued items", { threadId })
				return
			}

			logger.info("launching next queued item", {
				threadId,
				queueItemId: next.id,
				position: next.position
			})

			if (next.messageId) {
				const t = thread(threadId)
				await reactToMessage(t, next.messageId, "hourglass_flowing_sand", "remove")
			}

			const t = thread(threadId)
			await postToThread(
				t,
				`*Launching next queued task*\n\n_"${truncate(next.rawMessage, 100)}"_`,
				logger,
				"post queue launch to slack"
			)

			await inngest.send({
				name: "cursor/agent.launch",
				data: {
					prompt: next.prompt,
					repository: CHANNEL_REPOS_BY_THREAD[threadId]?.repository ?? "",
					ref: CHANNEL_REPOS_BY_THREAD[threadId]?.ref ?? "main",
					threadId
				}
			})
		})
```

**Step 3: Add the `truncate` helper**

Add a simple helper at the top of the file (or in a shared util):

```typescript
function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text
	return text.slice(0, maxLength - 3) + "..."
}
```

**Step 4: Handle the repository lookup**

The `check-queue` step needs the repository info. The current lifecycle gets `repository` and `ref` from `event.data`. For queued items, we need to look this up. Two approaches:

**Option A (simpler):** Store `repository` and `ref` on the queue item itself (add columns to `cursorThreadQueue`).

**Option B:** Read from `cursor_agent_threads` which already has `repository` and `ref`.

Go with Option B — read from the existing `cursorAgentThreads` row:

```typescript
		await step.run("check-queue", async () => {
			const next = await popNext(threadId)
			if (!next) {
				logger.info("no queued items", { threadId })
				return
			}

			const threadRows = await db
				.select({
					repository: cursorAgentThreads.repository,
					ref: cursorAgentThreads.ref
				})
				.from(cursorAgentThreads)
				.where(eq(cursorAgentThreads.threadId, threadId))

			const threadRow = threadRows[0]
			if (!threadRow) {
				logger.error("no thread row for queue launch", { threadId })
				return
			}

			logger.info("launching next queued item", {
				threadId,
				queueItemId: next.id,
				repository: threadRow.repository
			})

			const t = thread(threadId)
			await postToThread(
				t,
				`*Launching next queued task*\n\n_"${truncate(next.rawMessage, 100)}"_`,
				logger,
				"post queue launch to slack"
			)

			await inngest.send({
				name: "cursor/agent.launch",
				data: {
					prompt: next.prompt,
					repository: threadRow.repository,
					ref: threadRow.ref,
					threadId
				}
			})
		})
```

**Step 5: Import `inngest` in agent-lifecycle**

Add to the top of `agent-lifecycle.ts`:

```typescript
import { inngest } from "@/inngest"
```

Wait — `inngest` is already used to create the function via `inngest.createFunction`. Verify it's already imported. If not, add it.

**Step 6: Verify with typecheck**

Run: `bun typecheck`
Expected: PASS

**Step 7: Run lint**

Run: `bun lint`
Expected: PASS

**Step 8: Commit**

```
feat(lifecycle): add check-queue step to auto-launch next queued item
```

---

## Task 8: Handle timeout and error paths for queue processing

**Files:**
- Modify: `src/inngest/functions/cursor/agent-lifecycle.ts`

**Context:** The `check-queue` step currently only runs after `post-result`. But `post-result` also handles the EXPIRED (timeout) case. We need `check-queue` to run in both success AND timeout paths.

**Step 1: Verify the current flow**

The `post-result` step already handles both completion and timeout:
- If `completionEvent` is null → timeout, posts timeout message
- If `completionEvent` exists → posts result

The `check-queue` step is added AFTER `post-result`, so it runs regardless of which path `post-result` took. This is already correct — no changes needed for timeout handling.

**Step 2: Handle the cancelOn path**

The lifecycle has `cancelOn` for `cursor/followup.sent`. When cancelled, the function stops entirely — `check-queue` never runs. This is correct behavior: if a user sends a followup that cancels the lifecycle, the queue should not auto-advance (the followup replaces the current work).

**Step 3: Verify understanding, no code changes**

This task is a verification that the existing flow handles edge cases correctly. No code changes needed.

**Step 4: Commit**

No commit needed — this was a verification task.

---

## Task 9: End-to-end manual test

**Step 1: Start dev servers**

Run: `bun dev` and `bun dev:inngest` in separate terminals.

**Step 2: Test enqueue flow**

1. @mention the bot in a configured channel with a task
2. While agent is RUNNING, post another message in the thread
3. Verify ephemeral shows "Queue This (#1 in line)", "Stop & Send Now", "Cancel"
4. Click "Queue This"
5. Verify confirmation ephemeral shows "Queued at position #1" with "Remove from Queue" button

**Step 3: Test dequeue flow**

1. Click "Remove from Queue" on the confirmation
2. Verify item is removed (no further processing)

**Step 4: Test auto-process flow**

1. Queue an item while agent is running
2. Wait for agent to finish (or mock completion via Inngest dashboard)
3. Verify bot posts "Launching next queued task" and sends a new `cursor/agent.launch` event

**Step 5: Test queue full**

1. Queue 5 items
2. Try to queue a 6th
3. Verify ephemeral shows "Queue is full (5/5)"

**Step 6: Commit any fixes discovered during testing**

```
fix(queue): [describe fix]
```

---

## Task 10: Clean up pendingFollowup usage

**Files:**
- Modify: `src/lib/bot.ts`

**Context:** The `pendingFollowup` column is still written to in `handleSubscribedMessage` (for the "Stop & Send Now" path to read). This is fine for now — it serves as temporary storage for the message text between the ephemeral being shown and the action being clicked. We do NOT drop the column yet since "Stop & Send Now" still reads it.

**Step 1: Verify no cleanup needed**

The `pendingFollowup` field is still actively used by the "Stop & Send Now" flow. Leave it in place. It will be removed in a future migration when we refactor "Stop & Send Now" to also use the queue table.

**Step 2: Final lint and typecheck**

Run: `bun lint && bun typecheck`
Expected: PASS

**Step 3: Final commit**

```
chore: verify queue implementation complete
```

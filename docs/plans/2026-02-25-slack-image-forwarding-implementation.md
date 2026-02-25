# Slack Image Forwarding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Forward image attachments from Slack messages to Cursor's agent API on both initial launch and followup paths.

**Architecture:** New `src/lib/slack-images.ts` module handles filtering, fetching, and base64-encoding Slack image attachments. `bot.ts` calls it eagerly before emitting Inngest events or sending followups. Images flow as base64 strings through the Inngest event schema to `agent-lifecycle.ts`, which passes them to Cursor's API.

**Tech Stack:** Chat SDK (`Attachment` type with `fetchData()`), Cursor Cloud API (`Image` schema), Inngest events, Drizzle ORM (jsonb column), Zod schemas.

**Design doc:** `docs/plans/2026-02-25-slack-image-forwarding-design.md`

---

### Task 1: Add `pendingFollowupImages` column to DB schema

**Files:**
- Modify: `src/db/schemas/cursor.ts:5-15`

**Step 1: Add the jsonb column**

```typescript
import { jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core"

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
	pendingFollowupImages: jsonb("pending_followup_images"),
	createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull()
})

export { cursorAgentThreads }
```

**Step 2: Push schema**

Run: `bun db:push`
Expected: Column added to `agent.cursor_agent_threads`

**Step 3: Commit**

```bash
git add src/db/schemas/cursor.ts
git commit --no-verify -m "feat(db): add pendingFollowupImages jsonb column"
```

---

### Task 2: Create `src/lib/slack-images.ts` extraction module

**Files:**
- Create: `src/lib/slack-images.ts`

**Step 1: Create the module with types and extraction function**

```typescript
import type { Attachment } from "chat"
import * as errors from "@superbuilders/errors"
import * as logger from "@superbuilders/slog"

const MAX_IMAGES = 5

type CursorImage = {
	data: string
	dimension?: {
		width: number
		height: number
	}
}

type ExtractionResult = {
	images: CursorImage[]
	warnings: string[]
}

async function extractImages(attachments: Attachment[]): Promise<ExtractionResult> {
	const images: CursorImage[] = []
	const warnings: string[] = []

	const imageAttachments: Attachment[] = []
	const nonImageAttachments: Attachment[] = []

	for (const attachment of attachments) {
		if (attachment.type === "image") {
			imageAttachments.push(attachment)
		} else {
			nonImageAttachments.push(attachment)
		}
	}

	if (nonImageAttachments.length > 0) {
		const types = [...new Set(nonImageAttachments.map((a) => a.type))]
		warnings.push(
			`Skipped ${nonImageAttachments.length} non-image attachment(s) (${types.join(", ")}). Cursor only supports images.`
		)
	}

	const capped = imageAttachments.slice(0, MAX_IMAGES)
	if (imageAttachments.length > MAX_IMAGES) {
		warnings.push(
			`Forwarded ${MAX_IMAGES} of ${imageAttachments.length} images (Cursor limit is ${MAX_IMAGES}).`
		)
	}

	for (const attachment of capped) {
		if (!attachment.fetchData) {
			logger.warn("image attachment missing fetchData", { name: attachment.name })
			warnings.push(`Could not fetch image "${attachment.name}" (no download method available).`)
			continue
		}

		const fetchResult = await errors.try(attachment.fetchData())
		if (fetchResult.error) {
			logger.error("failed to fetch image attachment", {
				error: fetchResult.error,
				name: attachment.name
			})
			warnings.push(`Failed to download image "${attachment.name}".`)
			continue
		}

		const base64 = fetchResult.data.toString("base64")
		const dimension =
			attachment.width && attachment.height
				? { width: attachment.width, height: attachment.height }
				: undefined

		images.push({ data: base64, dimension })
	}

	logger.debug("image extraction complete", {
		total: attachments.length,
		extracted: images.length,
		warningCount: warnings.length
	})

	return { images, warnings }
}

export { extractImages }
export type { CursorImage, ExtractionResult }
```

**Step 2: Verify types compile**

Run: `bun typecheck`
Expected: No new errors (pre-existing kibo-ui error may still be present)

**Step 3: Commit**

```bash
git add src/lib/slack-images.ts
git commit --no-verify -m "feat: add Slack image extraction module"
```

---

### Task 3: Add `images` to Inngest event schema

**Files:**
- Modify: `src/inngest/index.ts:129-134`

**Step 1: Update the `cursor/agent.launch` event schema**

Change lines 129-134 from:

```typescript
"cursor/agent.launch": z.object({
	prompt: z.string().min(1),
	repository: z.string().min(1),
	ref: z.string().min(1),
	threadId: z.string().min(1)
}),
```

To:

```typescript
"cursor/agent.launch": z.object({
	prompt: z.string().min(1),
	repository: z.string().min(1),
	ref: z.string().min(1),
	threadId: z.string().min(1),
	images: z.array(
		z.object({
			data: z.string().min(1),
			dimension: z
				.object({
					width: z.number(),
					height: z.number()
				})
				.optional()
		})
	)
}),
```

**Step 2: Verify types compile**

Run: `bun typecheck`
Expected: Type errors in `bot.ts:133-141` and `agent-lifecycle.ts:57-69` because the event data shape changed (now requires `images`). This is expected — we fix these in Tasks 4 and 5.

**Step 3: Commit**

```bash
git add src/inngest/index.ts
git commit --no-verify -m "feat(inngest): add images to cursor/agent.launch event schema"
```

---

### Task 4: Wire images through `bot.ts`

**Files:**
- Modify: `src/lib/bot.ts:1-4` (imports)
- Modify: `src/lib/bot.ts:84-94` (IncomingMessage type)
- Modify: `src/lib/bot.ts:100-142` (handleNewMention)
- Modify: `src/lib/bot.ts:150-229` (handleSubscribedMessage)
- Modify: `src/lib/bot.ts:231-290` (handleStopAndFollowup)
- Modify: `src/lib/bot.ts:303-315` (sendFollowup)

**Step 1: Add imports**

Add to imports at top of file:

```typescript
import type { Attachment } from "chat"
import type { CursorImage } from "@/lib/slack-images"
import { extractImages } from "@/lib/slack-images"
```

**Step 2: Add `attachments` to `IncomingMessage` type**

Change the `IncomingMessage` type (line 84-94) from:

```typescript
type IncomingMessage = {
	id: string
	text: string
	author: {
		userId: string
		userName: string
		fullName: string
		isBot: boolean | "unknown"
		isMe: boolean
	}
}
```

To:

```typescript
type IncomingMessage = {
	id: string
	text: string
	attachments: Attachment[]
	author: {
		userId: string
		userName: string
		fullName: string
		isBot: boolean | "unknown"
		isMe: boolean
	}
}
```

**Step 3: Add warning posting helper**

Add after the `postError` function (after line 69):

```typescript
async function postWarnings(thread: Thread<unknown>, warnings: string[]): Promise<void> {
	if (warnings.length === 0) return
	const text = warnings.map((w) => `> ${w}`).join("\n")
	const postResult = await errors.try(thread.post(text))
	if (postResult.error) {
		logger.warn("failed to post image warnings", { error: postResult.error })
	}
}
```

**Step 4: Update `handleNewMention`**

Replace lines 100-142 with:

```typescript
async function handleNewMention(thread: Thread, message: IncomingMessage): Promise<void> {
	if (!BOT_MENTION_PATTERN.test(message.text)) {
		logger.debug("ignoring non-leading mention", { threadId: thread.id })
		return
	}

	const prompt = message.text.replace(new RegExp(`@${BOT_USER_ID}`, "g"), "@Cursor").trim()
	if (!prompt) {
		await thread.post("Give me a task and I'll launch a Cursor agent for it.")
		return
	}

	const config = CHANNEL_REPOS[thread.channelId]
	if (!config) {
		await thread.post(`No repo configured for this channel (\`${thread.channelId}\`).`)
		return
	}

	await thread.subscribe()

	const reactResult = await errors.try(
		thread.adapter.addReaction(thread.id, message.id, "one-sec-cooking")
	)
	if (reactResult.error) {
		logger.warn("failed to react to mention", { error: reactResult.error })
	}

	const { images, warnings } = await extractImages(message.attachments)
	await postWarnings(thread, warnings)

	const composedPrompt = await composeWorkflowPrompt(
		config.repository,
		prompt,
		message.author.userId
	)

	await inngest.send({
		name: "cursor/agent.launch",
		data: {
			prompt: composedPrompt,
			repository: config.repository,
			ref: config.ref,
			threadId: thread.id,
			images
		}
	})
}
```

**Step 5: Update `handleSubscribedMessage`**

Replace lines 150-229 with:

```typescript
async function handleSubscribedMessage(thread: Thread, message: IncomingMessage): Promise<void> {
	if (isDirectedElsewhere(message.text)) {
		logger.debug("ignoring message directed at others", { threadId: thread.id })
		return
	}

	const followupText = message.text.replace(new RegExp(`@${BOT_USER_ID}`, "g"), "@Cursor").trim()
	if (!followupText) {
		return
	}

	logger.debug("subscribed message received", { threadId: thread.id, text: followupText })

	await reactToMessage(thread, message.id, "see_no_evil", "add")

	const { images, warnings } = await extractImages(message.attachments)
	await postWarnings(thread, warnings)

	const rows = await db
		.select({
			agentId: cursorAgentThreads.agentId,
			status: cursorAgentThreads.status,
			agentUrl: cursorAgentThreads.agentUrl
		})
		.from(cursorAgentThreads)
		.where(eq(cursorAgentThreads.threadId, thread.id))

	const row = rows[0]
	if (!row) {
		logger.warn("no agent found for subscribed thread", { threadId: thread.id })
		await reactToMessage(thread, message.id, "see_no_evil", "remove")
		return
	}

	const apiKey = env.CURSOR_API_KEY
	if (!apiKey) {
		await reactToMessage(thread, message.id, "see_no_evil", "remove")
		logger.error("missing CURSOR_API_KEY for followup")
		throw errors.new("CURSOR_API_KEY not configured")
	}

	if (row.status === "RUNNING" || row.status === "CREATING") {
		await db
			.update(cursorAgentThreads)
			.set({
				pendingFollowup: followupText,
				pendingFollowupImages: images.length > 0 ? images : null
			})
			.where(eq(cursorAgentThreads.threadId, thread.id))

		const card = Card({
			children: [
				CardText("The agent is still running. To send a follow-up, I need to stop it first."),
				Actions([
					Button({
						id: "cursor-stop-and-followup",
						label: "Stop & Send Follow-up",
						style: "danger"
					}),
					Button({
						id: "cursor-cancel-followup",
						label: "Cancel"
					})
				])
			]
		})

		await thread.postEphemeral(message.author, card, { fallbackToDM: false })
		await reactToMessage(thread, message.id, "see_no_evil", "remove")
		return
	}

	await sendFollowup(apiKey, row.agentId, followupText, images)

	await inngest.send({
		name: "cursor/followup.sent",
		data: { agentId: row.agentId, threadId: thread.id, agentUrl: row.agentUrl }
	})

	await reactToMessage(thread, message.id, "see_no_evil", "remove")

	await thread.post(
		"*Follow-up sent*\n\nYour follow-up has been sent to the agent. Waiting for a response..."
	)
	logger.info("followup sent", { agentId: row.agentId, threadId: thread.id })
}
```

**Step 6: Update `handleStopAndFollowup`**

Replace lines 231-290 with:

```typescript
async function handleStopAndFollowup(thread: Thread<unknown>, threadId: string): Promise<void> {
	logger.info("stop and followup action", { threadId })

	const rows = await db
		.select({
			agentId: cursorAgentThreads.agentId,
			agentUrl: cursorAgentThreads.agentUrl,
			pendingFollowup: cursorAgentThreads.pendingFollowup,
			pendingFollowupImages: cursorAgentThreads.pendingFollowupImages
		})
		.from(cursorAgentThreads)
		.where(eq(cursorAgentThreads.threadId, threadId))

	const row = rows[0]
	if (!row) {
		logger.error("no agent found for action", { threadId })
		throw errors.new("no agent found for this thread")
	}

	if (!row.pendingFollowup) {
		logger.error("no pending followup", { threadId })
		throw errors.new("no pending follow-up message found")
	}

	const apiKey = env.CURSOR_API_KEY
	if (!apiKey) {
		logger.error("missing CURSOR_API_KEY for stop+followup")
		throw errors.new("CURSOR_API_KEY not configured")
	}

	const client = createCursorClient(apiKey)

	const stopResponse = await client.POST("/v0/agents/{id}/stop", {
		params: { path: { id: row.agentId } }
	})

	if (stopResponse.error) {
		const detail = JSON.stringify(stopResponse.error)
		logger.error("failed to stop agent", { error: detail, agentId: row.agentId })
		throw errors.new(`cursor stop API: ${detail}`)
	}

	logger.info("agent stopped", { agentId: row.agentId })

	const pendingImages = (row.pendingFollowupImages ?? []) as CursorImage[]
	await sendFollowup(apiKey, row.agentId, row.pendingFollowup, pendingImages)

	await db
		.update(cursorAgentThreads)
		.set({ pendingFollowup: null, pendingFollowupImages: null })
		.where(eq(cursorAgentThreads.threadId, threadId))

	await inngest.send({
		name: "cursor/followup.sent",
		data: { agentId: row.agentId, threadId, agentUrl: row.agentUrl }
	})

	await thread.post(
		"*Follow-up sent*\n\nAgent stopped and follow-up sent. Waiting for a response..."
	)
	logger.info("stop and followup complete", { agentId: row.agentId })
}
```

**Step 7: Update `sendFollowup` signature**

Replace lines 303-315 with:

```typescript
async function sendFollowup(
	apiKey: string,
	agentId: string,
	text: string,
	images: CursorImage[]
): Promise<void> {
	const client = createCursorClient(apiKey)
	const promptBody = images.length > 0 ? { text, images } : { text }
	const { error } = await client.POST("/v0/agents/{id}/followup", {
		params: { path: { id: agentId } },
		body: { prompt: promptBody }
	})

	if (error) {
		const detail = JSON.stringify(error)
		logger.error("cursor followup api error", { error: detail, agentId })
		throw errors.new(`cursor followup API: ${detail}`)
	}
}
```

**Step 8: Update `handleCancelFollowup` to also clear images**

Replace lines 292-301 with:

```typescript
async function handleCancelFollowup(thread: Thread<unknown>, threadId: string): Promise<void> {
	logger.debug("cancel followup action", { threadId })

	await db
		.update(cursorAgentThreads)
		.set({ pendingFollowup: null, pendingFollowupImages: null })
		.where(eq(cursorAgentThreads.threadId, threadId))

	await thread.post("Cancelled.")
}
```

**Step 9: Verify types compile**

Run: `bun typecheck`
Expected: Remaining error only in `agent-lifecycle.ts` (fixed in Task 5) and the pre-existing kibo-ui error.

**Step 10: Commit**

```bash
git add src/lib/bot.ts
git commit --no-verify -m "feat(bot): wire image extraction into mention and followup handlers"
```

---

### Task 5: Pass images to Cursor API in `agent-lifecycle.ts`

**Files:**
- Modify: `src/inngest/functions/cursor/agent-lifecycle.ts:53-69`

**Step 1: Update the `launch-agent` step**

Change the `launch-agent` step (lines 53-69) from:

```typescript
const agent = await step.run("launch-agent", async () => {
	const client = createCursorClient(apiKey)
	logger.info("launching cursor agent", { repository, ref, prompt })

	const { data, error } = await client.POST("/v0/agents", {
		body: {
			prompt: { text: prompt },
			source: { repository: `https://github.com/${repository}`, ref },
			target: {
				autoCreatePr: true,
				openAsCursorGithubApp: false,
				skipReviewerRequest: false,
				autoBranch: true
			},
			webhook: { url: webhookUrl }
		}
	})
```

To:

```typescript
const agent = await step.run("launch-agent", async () => {
	const client = createCursorClient(apiKey)
	logger.info("launching cursor agent", {
		repository,
		ref,
		prompt,
		imageCount: images.length
	})

	const promptBody = images.length > 0 ? { text: prompt, images } : { text: prompt }
	const { data, error } = await client.POST("/v0/agents", {
		body: {
			prompt: promptBody,
			source: { repository: `https://github.com/${repository}`, ref },
			target: {
				autoCreatePr: true,
				openAsCursorGithubApp: false,
				skipReviewerRequest: false,
				autoBranch: true
			},
			webhook: { url: webhookUrl }
		}
	})
```

Also update the destructuring at line 39 to include `images`:

```typescript
const { prompt, repository, ref, threadId, images } = event.data
```

**Step 2: Verify types compile**

Run: `bun typecheck`
Expected: No new errors (only the pre-existing kibo-ui error).

**Step 3: Commit**

```bash
git add src/inngest/functions/cursor/agent-lifecycle.ts
git commit --no-verify -m "feat(cursor): forward images to Cursor agent API"
```

---

### Task 6: Manual smoke test

**Step 1: Start dev servers**

Run: `bun dev` and `bun dev:inngest` in separate terminals.

**Step 2: Test initial launch with image**

In Slack, upload an image and @mention the bot with a task in a configured channel. Verify:
- Bot extracts the image (check logs for "image extraction complete")
- Inngest event includes `images` array
- Cursor agent receives the image (check agent conversation in Cursor dashboard)

**Step 3: Test followup with image**

Reply to the thread with another image. Verify:
- Image is extracted and forwarded via `sendFollowup`
- OR if agent is running, images are stored in `pendingFollowupImages` and forwarded after "Stop & Send Follow-up"

**Step 4: Test edge cases**

- Upload a PDF — verify warning message appears in thread
- Upload 6+ images — verify first 5 forwarded with overflow warning
- Upload image with no text — verify message still processes (text may be empty but images forward)

**Step 5: Commit any fixes discovered during testing**

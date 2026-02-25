# Cursor Slack Bot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Slack bot that receives @mentions, launches Cursor Cloud Agents, and posts results back via Inngest webhook transforms.

**Architecture:** Chat SDK handles Slack webhooks/threading. Inngest manages the agent lifecycle (launch → wait for webhook → notify). Inngest dashboard webhook transform converts Cursor's `statusChange` POST into an Inngest event.

**Tech Stack:** Vercel Chat SDK (`chat`, `@chat-adapter/slack`, `@chat-adapter/state-memory`), Inngest (`step.waitForEvent`), Cursor Cloud Agent API (via `openapi-fetch` generated client), Next.js API routes.

**Design doc:** `docs/plans/2026-02-25-cursor-slack-bot-design.md`

**Local docs (use these before web searches):**
- Chat SDK: `docs/chatsdk/` — full SDK docs including guides, adapters, API reference
- Inngest: `docs/inngest/` — Inngest SDK and platform docs
- Cursor API: `docs/cursor-cloud-agent-api.md` — endpoint reference with tested examples
- Cursor OpenAPI spec + generated types: `src/lib/clients/cursor/`
- Vercel: `docs/vercel/` — deployment and platform docs
- AI SDK: `docs/ai-sdk/` and `docs/ai-sdk-elements/`
- React: `docs/react/`
- Bun: `docs/bun/`

---

### Task 1: Install Chat SDK Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install packages**

Run: `bun add chat @chat-adapter/slack @chat-adapter/state-memory`

**Step 2: Verify install**

Run: `bun typecheck`
Expected: Clean pass

**Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add chat sdk dependencies"
```

---

### Task 2: Add Environment Variables

**Files:**
- Modify: `src/env.ts`
- Modify: `.env.local`

**Step 1: Add new env vars to T3 Env schema**

In `src/env.ts`, add to the `server` object:

```typescript
SLACK_BOT_TOKEN: z.string().optional(),
SLACK_SIGNING_SECRET: z.string().optional(),
INNGEST_WEBHOOK_URL: z.string().url().optional(),
CURSOR_API_KEY: z.string().optional(),
```

And add to the `runtimeEnv` object:

```typescript
SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
INNGEST_WEBHOOK_URL: process.env.INNGEST_WEBHOOK_URL,
CURSOR_API_KEY: process.env.CURSOR_API_KEY,
```

**Step 2: Add placeholder values to .env.local**

Append to `.env.local`:

```
SLACK_BOT_TOKEN=xoxb-placeholder
SLACK_SIGNING_SECRET=placeholder
INNGEST_WEBHOOK_URL=https://inn.gs/e/placeholder
```

`CURSOR_API_KEY` is already in `.env.local`.

**Step 3: Verify**

Run: `bun typecheck`
Expected: Clean pass

**Step 4: Commit**

```bash
git add src/env.ts
git commit -m "feat: add slack and cursor env vars to T3 Env schema"
```

Do NOT commit `.env.local`.

---

### Task 3: Create the Chat SDK Bot

**Files:**
- Create: `src/lib/bot.ts`

**Step 1: Create the bot module**

```typescript
import { Chat } from "chat"
import { createSlackAdapter } from "@chat-adapter/slack"
import { createMemoryState } from "@chat-adapter/state-memory"
import { inngest } from "@/inngest"
import { env } from "@/env"

const CHANNEL_REPOS: Record<string, { repository: string, ref: string }> = {
	"C0AHSQHA5A4": { repository: "incept-team/incept", ref: "main" },
}

const bot = new Chat({
	userName: "cursor-bot",
	adapters: {
		slack: createSlackAdapter(),
	},
	state: createMemoryState(),
})

bot.onNewMention(async (thread, message) => {
	const prompt = message.text.trim()
	if (!prompt) {
		await thread.post("Give me a task and I'll launch a Cursor agent for it.")
		return
	}

	const channelId = thread.threadId.split(":")[1]
	if (!channelId) {
		await thread.post("Could not determine channel.")
		return
	}

	const config = CHANNEL_REPOS[channelId]
	if (!config) {
		await thread.post(`No repo configured for this channel (\`${channelId}\`).`)
		return
	}

	await inngest.send({
		name: "cursor/agent.launch",
		data: {
			prompt,
			repository: config.repository,
			ref: config.ref,
			threadId: thread.threadId,
		},
	})

	await thread.post(`Launching Cursor agent on \`${config.repository}\` (branch: \`${config.ref}\`)...`)
})

export { bot, CHANNEL_REPOS }
```

**Step 2: Verify**

Run: `bun typecheck`
Expected: Will fail because `cursor/agent.launch` event schema doesn't exist yet. That's OK — Task 4 fixes it.

**Step 3: Commit**

```bash
git add src/lib/bot.ts
git commit -m "feat: create chat sdk bot with slack adapter and channel-repo mapping"
```

---

### Task 4: Add Inngest Event Schemas

**Files:**
- Modify: `src/inngest/index.ts`

**Step 1: Add cursor event schemas**

Add these entries to the `schema` object in `src/inngest/index.ts`:

```typescript
"cursor/agent.launch": z.object({
	prompt: z.string().min(1),
	repository: z.string().min(1),
	ref: z.string().min(1),
	threadId: z.string().min(1),
}),
"cursor/agent.finished": z.object({
	agentId: z.string().min(1),
	status: z.enum(["FINISHED", "ERROR"]),
	summary: z.string().optional(),
	repository: z.string().optional(),
	branchName: z.string().optional(),
	prUrl: z.string().optional(),
	agentUrl: z.string().optional(),
}),
"cursor/agent.errored": z.object({
	agentId: z.string().min(1),
	status: z.enum(["FINISHED", "ERROR"]),
	summary: z.string().optional(),
	repository: z.string().optional(),
	branchName: z.string().optional(),
	prUrl: z.string().optional(),
	agentUrl: z.string().optional(),
}),
```

**Step 2: Verify**

Run: `bun typecheck`
Expected: Clean pass (bot.ts `inngest.send` should now resolve)

**Step 3: Commit**

```bash
git add src/inngest/index.ts
git commit -m "feat: add cursor agent launch and completion event schemas"
```

---

### Task 5: Create the Agent Lifecycle Inngest Function

**Files:**
- Create: `src/inngest/functions/cursor/agent-lifecycle.ts`

**Step 1: Create the function**

```typescript
import * as errors from "@superbuilders/errors"
import { NonRetriableError } from "inngest"
import { createCursorClient } from "@/lib/clients/cursor"
import { env } from "@/env"
import { inngest } from "@/inngest"
import { bot } from "@/lib/bot"

const agentLifecycleFunction = inngest.createFunction(
	{ id: "cursor/agent-lifecycle" },
	{ event: "cursor/agent.launch" },
	async ({ event, logger, step }) => {
		const { prompt, repository, ref, threadId } = event.data

		logger.info("launching cursor agent", { repository, ref })

		const agentData = await step.run("launch-agent", async () => {
			const apiKey = env.CURSOR_API_KEY
			if (!apiKey) {
				throw new NonRetriableError("CURSOR_API_KEY not configured")
			}

			const webhookUrl = env.INNGEST_WEBHOOK_URL
			if (!webhookUrl) {
				throw new NonRetriableError("INNGEST_WEBHOOK_URL not configured")
			}

			const client = createCursorClient(apiKey)
			const { data, error, response } = await client.POST("/v0/agents", {
				body: {
					prompt: { text: prompt },
					source: { repository, ref },
					target: { autoBranch: true },
					webhook: { url: webhookUrl },
				},
			})

			if (error) {
				logger.error("cursor agent launch failed", { status: response.status })
				throw new NonRetriableError(`cursor api returned ${response.status}`)
			}

			if (!data) {
				throw new NonRetriableError("cursor api returned empty response")
			}

			return {
				agentId: data.id,
				branchName: data.target.branchName,
				agentUrl: data.target.url,
			}
		})

		logger.info("cursor agent launched", { agentId: agentData.agentId })

		await step.run("post-confirmation", async () => {
			const thread = bot.thread(threadId)
			const parts = [
				`Agent launched on branch \`${agentData.branchName}\``,
				agentData.agentUrl ? `<${agentData.agentUrl}|View in Cursor>` : "",
			]
			await thread.post(parts.filter(Boolean).join(" — "))
		})

		const completionEvent = await step.waitForEvent("wait-for-completion", {
			event: "cursor/agent.finished",
			match: "data.agentId",
			timeout: "30d",
		})

		if (!completionEvent) {
			const timedOutEvent = await step.waitForEvent("wait-for-error", {
				event: "cursor/agent.errored",
				match: "data.agentId",
				timeout: "1s",
			})

			await step.run("post-timeout", async () => {
				const thread = bot.thread(threadId)
				const msg = timedOutEvent
					? `Agent errored: ${timedOutEvent.data.summary}`
					: `Agent timed out. <${agentData.agentUrl}|Check manually>`
				await thread.post(msg)
			})
			return { status: "timeout", agentId: agentData.agentId }
		}

		logger.info("cursor agent completed", {
			agentId: agentData.agentId,
			status: completionEvent.data.status,
		})

		await step.run("post-result", async () => {
			const thread = bot.thread(threadId)
			const d = completionEvent.data

			const lines = [`*Agent finished* (${d.status})`]
			if (d.summary) {
				lines.push(d.summary)
			}
			if (d.prUrl) {
				lines.push(`<${d.prUrl}|View PR>`)
			}
			if (d.branchName) {
				lines.push(`Branch: \`${d.branchName}\``)
			}

			await thread.post(lines.join("\n"))
		})

		return { status: "completed", agentId: agentData.agentId }
	}
)

export { agentLifecycleFunction }
```

**Note on `waitForEvent`:** The first `waitForEvent` listens for `cursor/agent.finished` for 30 days. If it times out (returns `null`), we do a quick 1s check for `cursor/agent.errored` in case the error event was the one that came in. This handles both completion paths.

Actually — simpler approach. Use two triggers instead. Revise: listen for BOTH events from a single `waitForEvent` is not directly supported with `match`. Instead, the Inngest webhook transform should emit the SAME event name for both statuses (just with different `status` field). Revise the transform to always emit `cursor/agent.finished` regardless of status:

```javascript
// Inngest dashboard webhook transform
function transform(evt, headers, queryParams) {
    return {
        name: "cursor/agent.finished",
        data: {
            agentId: evt.id,
            status: evt.status,
            summary: evt.summary,
            repository: evt.source?.repository,
            branchName: evt.target?.branchName,
            prUrl: evt.target?.prUrl,
            agentUrl: evt.target?.url,
        },
    }
}
```

This simplifies the function — one `waitForEvent` catches both FINISHED and ERROR. The function then checks `completionEvent.data.status` to decide messaging.

With this simplification, remove the `cursor/agent.errored` schema from Task 4 and simplify the function:

Replace the two `waitForEvent` calls + timeout handling with:

```typescript
const completionEvent = await step.waitForEvent("wait-for-completion", {
	event: "cursor/agent.finished",
	match: "data.agentId",
	timeout: "30d",
})

await step.run("post-result", async () => {
	const thread = bot.thread(threadId)

	if (!completionEvent) {
		await thread.post(`Agent timed out. <${agentData.agentUrl}|Check manually>`)
		return
	}

	const d = completionEvent.data
	const isError = d.status === "ERROR"
	const statusText = isError ? "errored" : "finished"

	const lines = [`*Agent ${statusText}*`]
	if (d.summary) {
		lines.push(d.summary)
	}
	if (d.prUrl) {
		lines.push(`<${d.prUrl}|View PR>`)
	}
	if (d.branchName) {
		lines.push(`Branch: \`${d.branchName}\``)
	}
	if (isError && agentData.agentUrl) {
		lines.push(`<${agentData.agentUrl}|View in Cursor>`)
	}

	await thread.post(lines.join("\n"))
})

return {
	status: completionEvent ? completionEvent.data.status : "timeout",
	agentId: agentData.agentId,
}
```

**Step 2: Verify**

Run: `bun typecheck`
Expected: Clean pass

**Step 3: Commit**

```bash
git add src/inngest/functions/cursor/agent-lifecycle.ts
git commit -m "feat: add cursor agent lifecycle inngest function"
```

---

### Task 6: Register the Function

**Files:**
- Modify: `src/inngest/functions/index.ts`

**Step 1: Add import and register**

Add to imports:

```typescript
import { agentLifecycleFunction } from "@/inngest/functions/cursor/agent-lifecycle"
```

Add `agentLifecycleFunction` to the `coreFunctions` array.

**Step 2: Verify**

Run: `bun typecheck`
Expected: Clean pass

**Step 3: Commit**

```bash
git add src/inngest/functions/index.ts
git commit -m "feat: register cursor agent lifecycle function"
```

---

### Task 7: Create the Slack Webhook Route

**Files:**
- Create: `src/app/api/slack/route.ts`

**Step 1: Create the route**

Reference: Chat SDK Next.js guide uses `bot.webhooks.slack` with `waitUntil` via `after()`.

```typescript
import { after } from "next/server"
import { bot } from "@/lib/bot"

async function POST(request: Request) {
	return bot.webhooks.slack(request, {
		waitUntil: (task) => after(() => task),
	})
}

export { POST }
```

**Step 2: Verify**

Run: `bun typecheck`
Expected: Clean pass

**Step 3: Commit**

```bash
git add src/app/api/slack/route.ts
git commit -m "feat: add slack webhook api route"
```

---

### Task 8: Update Inngest Event Schema (Simplify)

**Files:**
- Modify: `src/inngest/index.ts`

**Step 1: Remove `cursor/agent.errored` schema**

Since the webhook transform emits `cursor/agent.finished` for both FINISHED and ERROR statuses, remove the `cursor/agent.errored` entry from the schema. Only `cursor/agent.launch` and `cursor/agent.finished` should remain.

**Step 2: Verify**

Run: `bun typecheck`
Expected: Clean pass

**Step 3: Commit**

```bash
git add src/inngest/index.ts
git commit -m "fix: simplify to single cursor agent completion event"
```

---

### Task 9: Lint and Final Typecheck

**Step 1: Run linter**

Run: `bun lint`

Fix any violations. Common issues to watch for:
- Arrow functions in bot.ts handlers (Chat SDK callbacks are inline — tolerated per project rules)
- Inline exports (move to end-of-file `export {}` pattern)
- Missing structured logging (add `logger.info` where needed)

**Step 2: Run typecheck**

Run: `bun typecheck`
Expected: Clean pass

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: lint fixes for cursor slack bot"
```

---

### Task 10: Manual Setup Steps (Not Code)

These are done by the human, not automated:

**Slack App:**
1. Go to https://api.slack.com/apps → Create New App → From manifest
2. Use the manifest from `docs/plans/2026-02-25-cursor-slack-bot-design.md` (update the request URL to your deployed URL: `https://<your-app>.vercel.app/api/slack`)
3. Install to workspace
4. Copy `SLACK_BOT_TOKEN` (xoxb-...) and `SLACK_SIGNING_SECRET` to `.env.local` and Vercel env vars
5. Invite the bot to channel `C0AHSQHA5A4`

**Inngest Webhook:**
1. Inngest Dashboard → Manage → Webhooks → Create Webhook
2. Copy the generated URL → set as `INNGEST_WEBHOOK_URL` in `.env.local` and Vercel env vars
3. Add this transform function:

```javascript
function transform(evt, headers, queryParams) {
    return {
        name: "cursor/agent.finished",
        data: {
            agentId: evt.id,
            status: evt.status,
            summary: evt.summary,
            repository: evt.source?.repository,
            branchName: evt.target?.branchName,
            prUrl: evt.target?.prUrl,
            agentUrl: evt.target?.url,
        },
    }
}
```

**Deploy:**
1. `vercel deploy` (or push to main for auto-deploy)
2. Set all env vars in Vercel dashboard
3. Update Slack Event Subscriptions Request URL to production URL

---

### Summary

| Task | What | Files |
|------|------|-------|
| 1 | Install Chat SDK deps | `package.json` |
| 2 | Add env vars | `src/env.ts` |
| 3 | Create bot with onNewMention | `src/lib/bot.ts` |
| 4 | Add Inngest event schemas | `src/inngest/index.ts` |
| 5 | Create agent lifecycle function | `src/inngest/functions/cursor/agent-lifecycle.ts` |
| 6 | Register function | `src/inngest/functions/index.ts` |
| 7 | Create Slack webhook route | `src/app/api/slack/route.ts` |
| 8 | Simplify event schema | `src/inngest/index.ts` |
| 9 | Lint + final typecheck | Various |
| 10 | Manual Slack + Inngest setup | Dashboard configs |

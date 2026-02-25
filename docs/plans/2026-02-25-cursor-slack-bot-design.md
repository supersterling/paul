# Cursor Slack Bot Design

Slack bot that lets users @mention it with a coding task, launches a Cursor Cloud Agent, and posts results back to the thread when the agent finishes.

## Architecture

```
@cursor-bot add error handling to the auth module
    ↓
Chat SDK onNewMention → inngest.send("cursor/agent.launch")
    ↓
Inngest function:
  step.run("launch")    → POST /v0/agents (Cursor API, with Inngest webhook URL)
  step.run("confirm")   → Post to Slack: "Agent running on branch cursor/..."
  step.waitForEvent()   → Wait up to 30 days for webhook callback
  step.run("notify")    → Post summary + PR link to Slack thread
    ↓
Cursor agent finishes → POSTs to Inngest webhook URL
    ↓
Inngest webhook transform → "cursor/agent.finished" or "cursor/agent.errored"
    ↓
waitForEvent resolves → Inngest function resumes → posts to Slack
```

## Components

### 1. Chat SDK Bot (`src/lib/bot.ts`)

- Vercel Chat SDK with Slack adapter, in-memory state
- `onNewMention` handler: parse prompt, look up repo, send Inngest event, post confirmation
- Channel-repo mapping as a constant

Config:
- `C0AHSQHA5A4` → `incept-team/incept` (branch: `main`)

Env vars: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`

### 2. Slack Webhook Route (`src/app/api/slack/route.ts`)

- Passes requests to `bot.webhooks.slack`

### 3. Inngest Event Schemas (added to `src/inngest/index.ts`)

```
"cursor/agent.launch": {
    prompt: string
    repository: string
    ref: string (default "main")
    threadId: string (Chat SDK thread ID for posting back)
}

"cursor/agent.finished": {
    agentId: string
    status: "FINISHED" | "ERROR"
    summary?: string
    repository?: string
    branchName?: string
    prUrl?: string
    agentUrl?: string
}
```

### 4. Inngest Function (`src/inngest/functions/cursor/agent-lifecycle.ts`)

Single function managing the full lifecycle:

1. **step.run("launch")** — Call `POST /v0/agents` with the prompt, repo, ref, and Inngest webhook URL. Return the agent ID.
2. **step.run("confirm")** — Post to Slack thread: "Agent launched — working on branch `cursor/...`" with agent URL link.
3. **step.waitForEvent()** — Wait for `cursor/agent.finished` matching on `data.agentId`, timeout `30d`.
4. **step.run("notify")** — Post to Slack thread: status, summary, PR link, files changed.

On timeout (agent never called back): post "Agent timed out — check manually" with agent URL.

### 5. Inngest Webhook Transform (Inngest Dashboard)

Configured in the Inngest dashboard, NOT in code. Receives Cursor's `statusChange` POST and converts it:

```javascript
function transform(evt, headers, queryParams) {
    const status = evt.status === "FINISHED" ? "finished" : "errored"
    return {
        name: `cursor/agent.${status}`,
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

### 6. Channel-Repo Mapping

```typescript
const CHANNEL_REPOS: Record<string, { repository: string, ref: string }> = {
    "C0AHSQHA5A4": { repository: "incept-team/incept", ref: "main" },
}
```

Unknown channel → bot replies "I don't have a repo configured for this channel."

## Dependencies

New packages:
- `chat` — Chat SDK core
- `@chat-adapter/slack` — Slack adapter
- `@chat-adapter/state-memory` — In-memory state (dev/v1)

Already have:
- `openapi-fetch` + generated Cursor API types
- Inngest client and serve route
- Next.js API routes

## Env Vars (New)

| Var | Purpose |
|-----|---------|
| `SLACK_BOT_TOKEN` | Slack bot OAuth token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | Slack webhook signature verification |
| `CURSOR_API_KEY` | Already in `.env.local` |
| `INNGEST_WEBHOOK_URL` | The Inngest webhook URL from the dashboard (for Cursor callback) |

## Slack App Setup (Manual)

1. Create app at api.slack.com/apps
2. Enable Event Subscriptions → point to `https://<deployment>/api/slack`
3. Subscribe to: `app_mention`, `message.channels`
4. Bot Token Scopes: `app_mentions:read`, `chat:write`, `channels:history`
5. Install to workspace → copy `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`

## Inngest Webhook Setup (Manual)

1. Inngest Dashboard → Manage → Webhooks → Create Webhook
2. Copy the generated URL → set as `INNGEST_WEBHOOK_URL` env var
3. Paste the transform function from above
4. This URL gets passed to Cursor API as `webhook.url` when launching agents

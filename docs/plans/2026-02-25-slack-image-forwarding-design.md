# Slack Image Forwarding to Cursor

Forward image attachments from Slack messages through the bot pipeline to Cursor's agent API.

## Problem

The Chat SDK parses Slack file uploads into `Attachment` objects with authenticated `fetchData()`. Cursor's API accepts base64 images on both `/v0/agents` (create) and `/v0/agents/{id}/followup`. The middle layer (`bot.ts` → Inngest → `agent-lifecycle.ts`) drops attachments entirely — only `message.text` flows through.

## Scope

- **In scope:** Image attachments on both initial launch and followup messages
- **Out of scope:** Non-image file types (PDFs, zips, code files) — Cursor API only supports images

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Attachment types | Images only (`image/*` mimeType) | Cursor API limitation |
| Non-image handling | Warn user via Slack reply | Explicit > silent |
| Fetch timing | Eager (in bot.ts before Inngest event) | Slack URLs are authenticated + time-limited |
| Image cap | First 5, warn about overflow | Cursor max is 5 |
| Per-image fetch failure | Skip + warn, don't fail the message | Partial success > total failure |
| Pending followup images | Store base64 in jsonb column | Full fidelity for stop-and-followup flow |
| DB schema change | `bun db:push` (no migration) | Dev velocity |

## Architecture

### New Module: `src/lib/slack-images.ts`

Single public function:

```
extractImages(attachments: Attachment[]) → Promise<ExtractionResult>
```

Where `ExtractionResult = { images: CursorImage[], warnings: string[] }`.

Pipeline: filter image/* → cap at 5 → fetchData() → base64 encode → return with warnings.

`CursorImage` matches Cursor's `Image` schema: `{ data: string, dimension?: { width: number, height: number } }`.

### bot.ts Changes

1. Add `attachments: Attachment[]` to `IncomingMessage` type
2. `handleNewMention`: call `extractImages()`, post warnings, pass images in Inngest event
3. `handleSubscribedMessage`: call `extractImages()`, pass images to `sendFollowup()` or store in `pendingFollowupImages` jsonb column
4. `sendFollowup()`: accept `images` param, pass to Cursor API `body.prompt.images`
5. `handleStopAndFollowup`: read `pendingFollowupImages` from DB, pass to `sendFollowup()`

### Inngest Event Schema

`cursor/agent.launch` gets `images` array field (always present, `[]` if no images).

### agent-lifecycle.ts

`launch-agent` step passes `event.data.images` to Cursor `/v0/agents` body as `prompt.images`.

### DB Schema

Add `pendingFollowupImages: jsonb` column to `cursorAgentThreads` table. Push with `bun db:push`.

## Data Flow

```
Slack message
  → bot.onNewMention / bot.onSubscribedMessage
  → extractImages(message.attachments)
    → filter image/* mimeTypes
    → cap at 5
    → attachment.fetchData() → Buffer → base64
    → return { images: CursorImage[], warnings: string[] }
  → post warnings to Slack thread
  → Inngest event / sendFollowup() with images
  → Cursor API: prompt.images
```

## Files Changed

| File | Change |
|------|--------|
| `src/lib/slack-images.ts` | New — image extraction module |
| `src/lib/bot.ts` | Add attachments to type, wire extraction into both handlers + sendFollowup |
| `src/inngest/index.ts` | Add `images` to `cursor/agent.launch` event schema |
| `src/inngest/functions/cursor/agent-lifecycle.ts` | Pass images to Cursor API |
| `src/db/schemas/cursor.ts` | Add `pendingFollowupImages` jsonb column |

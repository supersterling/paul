# Thread Message Queue Design

Adds a per-thread message queue so users can stack multiple tasks for the bot while an agent is running, processed FIFO when each agent finishes.

## Requirements

| Requirement | Decision |
|---|---|
| Queue model | Thread-based FIFO |
| Queue scope | Shared per-thread (all users contribute to same queue) |
| Enqueue trigger | Ephemeral with "Queue This" button when agent is active |
| Dequeue trigger | "Remove from queue" button on ephemeral |
| Processing | Auto-launch next queued item when current agent finishes |
| Queue limit | 5 items per thread |
| Visual indicator | Hourglass reaction on queued messages |

## Data Model

New table `cursor_thread_queue` in `agent` schema:

| Column | Type | Description |
|---|---|---|
| `id` | `serial` PK | Auto-increment queue item ID |
| `threadId` | `text` NOT NULL | Thread the item belongs to |
| `prompt` | `text` NOT NULL | Composed prompt for the agent |
| `rawMessage` | `text` NOT NULL | Original user message text (for display) |
| `slackUserId` | `text` NOT NULL | Who queued it |
| `messageId` | `text` NOT NULL | Slack message ID (for reaction tracking) |
| `position` | `integer` NOT NULL | Order in queue (1-based) |
| `status` | `text` NOT NULL | `pending` / `processing` / `cancelled` |
| `createdAt` | `timestamp` NOT NULL | When queued |

The existing `pendingFollowup` column on `cursor_agent_threads` becomes obsolete and will be dropped in a follow-up migration.

Queue limit enforced at insert time: reject if `COUNT(*) WHERE threadId = X AND status = 'pending' >= 5`.

## Reaction Semantics

| Emoji | Meaning | When applied |
|---|---|---|
| `one-sec-cooking` | Processing new mention | On initial @mention (existing) |
| `see_no_evil` | Processing subscribed message | During message handling (existing) |
| `hourglass_flowing_sand` | Queued, waiting | When item is added to queue |
| Remove `hourglass_flowing_sand` | Dequeued or processing | When item is cancelled or starts processing |

## UX Flows

### Enqueue

1. User posts message in subscribed thread while agent is RUNNING/CREATING
2. `bot.onSubscribedMessage()` detects agent is active
3. Bot reacts with `hourglass_flowing_sand` on the user's message
4. Bot posts ephemeral: "The agent is still running. What would you like to do?"
   - Buttons: [Queue This (#N in line)] [Stop & Send Now] [Cancel]
5. User clicks "Queue This"
6. `bot.onAction("cursor-queue")` fires
7. Compose prompt via `composeWorkflowPrompt`
8. INSERT into `cursor_thread_queue` (position = next available)
9. Post ephemeral: "Queued at position #N"

### Dequeue

1. User clicks "Remove from queue" (shown alongside queue confirmation or via a "View Queue" interaction)
2. `bot.onAction("cursor-dequeue")` fires
3. UPDATE `status = 'cancelled'` WHERE `id = queue_item_id`
4. Re-compact positions for remaining pending items
5. Remove `hourglass_flowing_sand` reaction from original message
6. Post ephemeral: "Removed from queue"

### Auto-Process (agent finishes, next in queue)

1. `agent-lifecycle` "post-result" step completes
2. New step "check-queue" runs
3. SELECT first pending item: `WHERE threadId = X AND status = 'pending' ORDER BY position ASC LIMIT 1`
4. If found:
   - UPDATE `status = 'processing'`
   - Remove `hourglass_flowing_sand` reaction from that message
   - Send `cursor/agent.launch` event with the queued prompt
   - Post to thread: "Launching next queued task (#N of M)..."
5. If empty: no-op, lifecycle ends normally

### Queue Full

1. User tries to queue when 5 items already pending
2. Ephemeral: "Queue is full (5/5). Wait for an agent to finish or remove a queued item."
   - Buttons: [Stop & Send Now] [Cancel]

## Code Changes

### `src/db/schemas/cursor.ts`

- Add `cursorThreadQueue` table definition
- `pendingFollowup` column on `cursorAgentThreads` becomes dead code (drop in follow-up migration)

### `src/lib/bot.ts`

- Refactor `handleSubscribedMessage` "agent is running" branch: replace single-slot `pendingFollowup` with ephemeral showing Queue / Stop & Send / Cancel buttons
- New action handler: `bot.onAction("cursor-queue")` — inserts into queue, adds hourglass reaction
- New action handler: `bot.onAction("cursor-dequeue")` — cancels queue item, removes hourglass reaction
- Existing `cursor-stop-and-followup` stays as-is
- Existing `cursor-cancel-followup` repurposed as the Cancel button on the new ephemeral (no DB write, ephemeral dismisses)

### `src/inngest/functions/cursor/agent-lifecycle.ts`

- Add `"check-queue"` step after `"post-result"`: query next pending item, send `cursor/agent.launch` event if found

### `src/inngest/index.ts`

- No new events needed — queue processing reuses existing `cursor/agent.launch` event

## Design Decisions

**Database table over JSON column:** Relational model is queryable, auditable, and avoids race conditions on concurrent JSON array mutations.

**Reuse `cursor/agent.launch` event:** Queue items launch through the same Inngest lifecycle as direct mentions. No new functions or event types needed.

**Button-based dequeue over message deletion:** Chat SDK doesn't expose `message_deleted` events. Buttons stay within the SDK's API surface.

**Shared queue per thread:** Simpler than per-user queues. One agent runs at a time per thread regardless of who queued the task.

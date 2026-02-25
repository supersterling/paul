# Feature Workflow Design

A prompt-driven workflow that guides a Cursor agent through structured phases of feature development, with user-driven transitions via Slack.

## Context

The bot currently launches a Cursor agent with raw prompts and posts results. This design adds a structured workflow where the agent is guided through phases (research, propose, build, review, PR) using composed prompts stored in the database. The user controls transitions between phases via a "Continue" button or by sending feedback.

## Phases

Five phases, strictly ordered:

| Phase | Purpose | Agent behavior |
|-------|---------|----------------|
| `research` | Deep-dive into the feature request. Map dependencies, affected systems, feasibility. | Use subagents to explore codebase in parallel. Document findings. Ask user if confused. |
| `propose` | Generate 2-3 steelmanned approaches with trade-offs. | Leverage subagents across multiple rounds. Present approaches clearly with pros/cons. |
| `build` | Implement the selected approach. | Write code, run tests, iterate. Use subagents for parallel file work. |
| `review` | Post-implementation review: security, performance, adherence to project rules/skills. | Spawn subagent rounds for each review dimension. Report findings. |
| `pr` | Create the pull request. | Push branch, open PR with structured description. |

Phase advances only when the user clicks "Continue". If the user types a message instead, it's sent as feedback to the current phase (no advancement).

## DB Schema

### `prompt_phases` — base prompt sections

Global prompt sections that apply to all repositories.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `phase` | text NOT NULL | `research`, `propose`, `build`, `review`, `pr` |
| `header` | text NOT NULL | Section label (e.g. "Role", "Subagent Strategy") |
| `content` | text NOT NULL | Prompt text for this section |
| `position` | integer NOT NULL | Sort order within the phase |

### `prompt_phase_overrides` — per-repo replacements

Per-repository overrides that replace or extend base sections.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `repository` | text NOT NULL | e.g. `incept-team/incept` |
| `phase` | text NOT NULL | Same phase values |
| `header` | text NOT NULL | Matches base header to replace, or new header to append |
| `content` | text NOT NULL | Override content |
| `position` | integer NOT NULL | Sort order |

### `cursor_agent_threads` additions

| Column | Type | Description |
|--------|------|-------------|
| `currentPhase` | text | Current phase |
| `workflowActive` | boolean NOT NULL DEFAULT false | Whether thread is in managed workflow |

## Prompt Composition

`composePhasePrompt(phase, repository, featureRequest?)` composes a single prompt string:

1. Load all base sections for the phase, ordered by position
2. Load all overrides for (phase, repository)
3. For each override: if header matches a base section, replace it; if not, insert at the override's position
4. Concatenate as `## {header}\n\n{content}` blocks
5. For the `research` phase only, append `## Feature Request\n\n{featureRequest}` at the end

Subsequent phases don't re-include the feature request — the agent already has it in conversation context.

## Bot Flow

### Launch

1. User @mentions bot with feature request
2. Bot reacts with `:one-sec-cooking:`
3. Bot composes `research` phase prompt from DB + feature request
4. Launches Cursor agent with composed prompt
5. Sets `currentPhase = 'research'`, `workflowActive = true`
6. Posts "Running" confirmation

### Phase Completion

Agent finishes. Lifecycle function posts result to Slack with a card:

```
*Research complete*

> [quoted agent response]

View in Cursor

Reply with feedback, or continue to the next phase.
[Continue to Propose]
```

### User Clicks "Continue"

`cursor-phase-continue` action handler:

1. Read `currentPhase` from DB
2. Determine next phase
3. Compose next phase's prompt from DB sections
4. Send as follow-up to Cursor agent
5. Update `currentPhase`
6. Fire `cursor/followup.sent`
7. Post confirmation

### User Types Feedback

Existing `onSubscribedMessage` handler sends the message as a plain follow-up. Same phase stays current. When agent finishes, phase-completion card appears again.

### Final Phase

After `review`, user clicks "Continue to PR". When the `pr` phase finishes, bot posts result without a "Continue" button. Sets `workflowActive = false`.

## Prompt Scoping

Global base templates with per-repository overrides.

- Base sections define the standard workflow behavior across all repos
- Override sections replace (by matching header) or extend (new header) base sections for specific repos
- No per-user or per-workflow-type scoping (future)

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `src/db/schemas/prompt.ts` | `prompt_phases` and `prompt_phase_overrides` tables |
| `src/lib/prompt-compose.ts` | `composePhasePrompt()` function |

### Modified Files

| File | Change |
|------|--------|
| `src/db/schemas/cursor.ts` | Add `currentPhase`, `workflowActive` columns |
| `src/db/index.ts` | Add prompt schema import |
| `drizzle.config.ts` | Add prompt schema path |
| `src/lib/bot.ts` | Launch with composed prompt, add `cursor-phase-continue` handler |
| `src/inngest/functions/cursor/agent-lifecycle.ts` | Post phase card when `workflowActive` |
| `src/inngest/functions/cursor/followup-lifecycle.ts` | Post phase card when `workflowActive` |
| `src/inngest/functions/cursor/format.ts` | Add `buildPhaseResultMessage` |

### Unchanged

- `sendFollowup`, stop-and-followup flow, cancel-followup
- `cursor/followup.sent` event + followup lifecycle
- `cancelOn` + atomic claim guard
- Thread subscription, postgres state adapter

## Out of Scope

- UI for editing prompts (direct DB access for now)
- Workflow type detection (feature vs bugfix)
- Per-user prompt overrides
- Phase skip/reorder
- Auto-advance through phases

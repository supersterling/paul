# Repo Overrides UI Design

## Problem

The prompt system has three override layers that compose in `prompt-compose.ts`: base → repo → user. The backend already merges all three, but the `/prompts` UI only exposes base and user overrides. The `promptPhaseOverrides` table (repo-scoped) has no UI management surface.

## Design Decisions

- **Approach B (separate tabs)**: "Me" tab for user overrides, "Repo" tab for repo overrides
- **No permissions**: anyone can see and edit repo overrides
- **Combobox** for repo selection with suggestions from DB + free-text entry for new repos
- **Full CRUD**: repo overrides can create new phases, reorder phases, add/edit/delete sections
- **URL-driven state** via Next.js server-side searchParams
- **Preview dialog** gets tabs: "My Prompt" (base + user) and "Repo Prompt" (base + repo)

## Data Model

### New table: `prompt_repo_phases`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK, default random |
| `repository` | text | not null |
| `phase` | text | not null |
| `position` | integer | not null |

Unique constraint: `(repository, phase)`

### Existing table: `prompt_phase_overrides`

No changes. Already has `repository`, `phase`, `header`, `content`, `position`.

### Repo combobox data

```sql
SELECT DISTINCT repository FROM prompt_phase_overrides
UNION
SELECT DISTINCT repository FROM prompt_repo_phases
```

## URL Shape

| Param | Values | Default |
|-------|--------|---------|
| `tab` | `me` \| `repo` | `me` |
| `repo` | `owner/repo` string | absent |

- `/prompts` — Me tab (today's behavior)
- `/prompts?tab=repo` — Repo tab, no repo selected
- `/prompts?tab=repo&repo=incept-team/incept` — Repo tab with data

## Server Component Data Flow

```
tab === "me" (or absent):
  → baseSections + userContext (existing queries)

tab === "repo":
  → baseSections + availableRepos (combobox suggestions)
  → if repo param present:
      repoOverrides + repoPhases for that repository
```

Base sections always fetched. Tab-specific data fetched conditionally.

## UI Layout

### Sidebar

```
┌─────────────────────────────┐
│ [Me] [Repo]                 │  tab switcher
├─────────────────────────────┤
│                             │
│  (Repo tab)                 │
│  ┌─────────────────────┐   │
│  │ incept-team/incept ▼│   │  combobox
│  └─────────────────────┘   │
│                             │
│  ▼ Research                 │  phase/section tree
│    ├── Goals                │
│    ├── Constraints          │
│    └── Repo Setup (added)   │
│  ▶ Propose                  │
│                             │
│  + Add phase                │
│  Preview full prompt        │
│                             │
│  ── Reorder sections ──     │
└─────────────────────────────┘
```

- Tab switch is a link navigation (searchParam change), triggers server re-fetch
- Repo tab with no repo selected shows empty state
- Phase tree + editor work identically to Me tab, targeting repo tables

### Preview Dialog

```
┌──────────────────────────────────┐
│ Prompt Preview                   │
│ [My Prompt] [Repo Prompt]        │  tabs
│                                  │
│  (Repo Prompt tab shows          │
│   combobox to pick repo)         │
│                                  │
│  ## Response Style               │
│  ...rendered prompt...           │
│                                  │
│                       [Copy]     │
└──────────────────────────────────┘
```

## Server Actions

New actions for repo overrides (mirror user override actions, keyed by `repository`):

| Action | Input |
|--------|-------|
| `createRepoPhase` | `{ repository, phase }` |
| `deleteRepoPhase` | `{ repository, phase }` |
| `reorderRepoPhases` | `{ repository, phases[] }` |
| `createRepoOverride` | `{ repository, phase, header, content, position }` |
| `updateRepoOverride` | `{ id, content }` |
| `deleteRepoOverride` | `{ id }` |
| `reorderRepoSections` | `{ items[] }` |

All in `actions.ts`. Existing user override actions untouched.

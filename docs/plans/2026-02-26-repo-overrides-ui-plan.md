# Repo Overrides UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Repo" tab to the prompts page that lets users manage per-repository prompt overrides via a combobox + phase tree + editor, with a tabbed preview dialog.

**Architecture:** Separate tab-based UI driven by URL searchParams (`?tab=me|repo&repo=owner/name`). Server component conditionally fetches repo data. New `prompt_repo_phases` table for repo-level phase ordering. Repo override CRUD mirrors user override actions but keyed by `repository`.

**Tech Stack:** Next.js 16 (App Router, searchParams as Promise), Drizzle ORM, shadcn/ui Tabs + Combobox, Zod validation.

**Design doc:** `docs/plans/2026-02-26-repo-overrides-ui-design.md`

---

### Task 1: Add `promptRepoPhases` table to schema

**Files:**
- Modify: `src/db/schemas/prompt.ts`

**Step 1: Add the table definition**

In `src/db/schemas/prompt.ts`, add the `promptRepoPhases` table after `promptPhaseOverrides` (line 20), following the exact pattern of `promptUserPhases` but keyed by `repository` instead of `slackUserId`:

```typescript
const promptRepoPhases = agentSchema.table(
	"prompt_repo_phases",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		repository: text("repository").notNull(),
		phase: text("phase").notNull(),
		position: integer("position").notNull()
	},
	(t) => [unique("prompt_repo_phases_repo_phase").on(t.repository, t.phase)]
)
```

Add `unique` to the import from `drizzle-orm/pg-core` if not already present (it is — line 1).

**Step 2: Export the new table**

Update the export statement at the bottom of the file:

```typescript
export { promptPhaseOverrides, promptPhases, promptRepoPhases, promptUserOverrides, promptUserPhases }
```

**Step 3: Verify**

Run: `bun typecheck`
Expected: PASS — no type errors.

Run: `bun lint`
Expected: PASS.

**Step 4: Push schema to database**

Run: `bun db:push`

This creates the table. Do NOT run `bun db:generate` (migrations are human-reviewed).

**Step 5: Commit**

```bash
git add src/db/schemas/prompt.ts
git commit -m "feat: add prompt_repo_phases table for repo-level phase ordering"
```

---

### Task 2: Add repo override server actions

**Files:**
- Modify: `src/app/prompts/actions.ts`

All new actions follow the exact same patterns as the existing user override actions. Key difference: keyed by `repository` (string) instead of `slackUserId`, and targeting `promptPhaseOverrides` / `promptRepoPhases` tables.

**Step 1: Add imports**

At the top of `actions.ts`, add `promptPhaseOverrides` and `promptRepoPhases` to the import from `@/db/schemas/prompt`:

```typescript
import { promptPhaseOverrides, promptPhases, promptRepoPhases, promptUserOverrides, promptUserPhases } from "@/db/schemas/prompt"
```

Also add `sql` to the drizzle-orm import for the UNION query:

```typescript
import { and, eq, sql } from "drizzle-orm"
```

**Step 2: Add `ensureRepoPhasesMaterialized`**

Add after `ensureUserPhasesMaterialized` (around line 34). Same pattern — check if repo has materialized phases, if not insert defaults:

```typescript
async function ensureRepoPhasesMaterialized(repository: string): Promise<void> {
	const existing = await db
		.select({ id: promptRepoPhases.id })
		.from(promptRepoPhases)
		.where(eq(promptRepoPhases.repository, repository))
		.limit(1)

	if (existing.length > 0) return

	logger.info("materializing default repo phases", { repository })

	const values = PHASE_ORDER.map((phase, idx) => ({
		repository,
		phase,
		position: idx * 10
	}))

	const result = await errors.try(db.insert(promptRepoPhases).values(values))
	if (result.error) {
		logger.error("failed to materialize repo phases", { error: result.error })
		throw errors.wrap(result.error, "materialize default repo phases")
	}
}
```

**Step 3: Add `getAvailableRepos`**

This is a server action that returns distinct repository values from both repo tables. Add after `ensureRepoPhasesMaterialized`:

```typescript
async function getAvailableRepos(): Promise<string[]> {
	const result = await errors.try(
		db.execute<{ repository: string }>(
			sql`SELECT DISTINCT repository FROM agent.prompt_phase_overrides UNION SELECT DISTINCT repository FROM agent.prompt_repo_phases ORDER BY repository`
		)
	)
	if (result.error) {
		logger.error("failed to fetch available repos", { error: result.error })
		throw errors.wrap(result.error, "fetch available repos")
	}

	return result.data.rows.map((r) => r.repository)
}
```

**Step 4: Add `createRepoPhase`**

```typescript
const CreateRepoPhaseInput = z.object({
	repository: z.string().min(1),
	phase: z.string().min(1)
})

async function createRepoPhase(input: unknown): Promise<{ id: string }> {
	const parsed = CreateRepoPhaseInput.safeParse(input)
	if (!parsed.success) {
		logger.error("invalid input for createRepoPhase", { error: parsed.error })
		throw errors.new("invalid input")
	}

	const { repository, phase } = parsed.data
	logger.info("creating repo phase", { repository, phase })

	await ensureRepoPhasesMaterialized(repository)

	const maxResult = await errors.try(
		db
			.select({ position: promptRepoPhases.position })
			.from(promptRepoPhases)
			.where(eq(promptRepoPhases.repository, repository))
			.orderBy(promptRepoPhases.position)
	)
	if (maxResult.error) {
		logger.error("failed to read repo phase positions", { error: maxResult.error })
		throw errors.wrap(maxResult.error, "read repo phase positions")
	}

	const lastRow = maxResult.data[maxResult.data.length - 1]
	const nextPosition = lastRow ? lastRow.position + 10 : 0

	const result = await errors.try(
		db
			.insert(promptRepoPhases)
			.values({ repository, phase, position: nextPosition })
			.returning({ id: promptRepoPhases.id })
	)
	if (result.error) {
		logger.error("failed to create repo phase", { error: result.error })
		throw errors.wrap(result.error, "create repo phase")
	}

	const created = result.data[0]
	if (!created) {
		logger.error("insert returned no rows for repo phase", { phase })
		throw errors.new("insert returned no rows")
	}

	revalidatePath("/prompts")
	return created
}
```

**Step 5: Add `deleteRepoPhase`**

```typescript
const DeleteRepoPhaseInput = z.object({
	repository: z.string().min(1),
	phase: z.string().min(1)
})

async function deleteRepoPhase(input: unknown): Promise<void> {
	const parsed = DeleteRepoPhaseInput.safeParse(input)
	if (!parsed.success) {
		logger.error("invalid input for deleteRepoPhase", { error: parsed.error })
		throw errors.new("invalid input")
	}

	const { repository, phase } = parsed.data
	logger.info("deleting repo phase", { repository, phase })

	await ensureRepoPhasesMaterialized(repository)

	const phaseResult = await errors.try(
		db
			.delete(promptRepoPhases)
			.where(and(eq(promptRepoPhases.repository, repository), eq(promptRepoPhases.phase, phase)))
	)
	if (phaseResult.error) {
		logger.error("failed to delete repo phase", { error: phaseResult.error })
		throw errors.wrap(phaseResult.error, "delete repo phase")
	}

	const sectionsResult = await errors.try(
		db
			.delete(promptPhaseOverrides)
			.where(
				and(eq(promptPhaseOverrides.repository, repository), eq(promptPhaseOverrides.phase, phase))
			)
	)
	if (sectionsResult.error) {
		logger.error("failed to delete repo phase sections", { error: sectionsResult.error })
		throw errors.wrap(sectionsResult.error, "delete repo phase sections")
	}

	revalidatePath("/prompts")
}
```

**Step 6: Add `reorderRepoPhases`**

```typescript
const ReorderRepoPhasesInput = z.object({
	repository: z.string().min(1),
	phases: z.array(z.string().min(1))
})

async function reorderRepoPhases(input: unknown): Promise<void> {
	const parsed = ReorderRepoPhasesInput.safeParse(input)
	if (!parsed.success) {
		logger.error("invalid input for reorderRepoPhases", { error: parsed.error })
		throw errors.new("invalid input")
	}

	const { repository, phases } = parsed.data
	logger.info("reordering repo phases", { repository, count: phases.length })

	await ensureRepoPhasesMaterialized(repository)

	const updates = phases.map((phase, idx) =>
		db
			.update(promptRepoPhases)
			.set({ position: idx * 10 })
			.where(and(eq(promptRepoPhases.repository, repository), eq(promptRepoPhases.phase, phase)))
	)

	const result = await errors.try(Promise.all(updates))
	if (result.error) {
		logger.error("failed to reorder repo phases", { error: result.error })
		throw errors.wrap(result.error, "reorder repo phases")
	}

	revalidatePath("/prompts")
}
```

**Step 7: Add `createRepoOverride`**

```typescript
const CreateRepoOverrideInput = z.object({
	repository: z.string().min(1),
	phase: z.string().min(1),
	header: z.string().min(1),
	content: z.string(),
	position: z.number().int()
})

async function createRepoOverride(input: unknown): Promise<{ id: string }> {
	const parsed = CreateRepoOverrideInput.safeParse(input)
	if (!parsed.success) {
		logger.error("invalid input for createRepoOverride", { error: parsed.error })
		throw errors.new("invalid input")
	}

	const { repository, phase, header, content, position } = parsed.data
	logger.info("creating repo override", { repository, phase, header })

	const result = await errors.try(
		db
			.insert(promptPhaseOverrides)
			.values({ repository, phase, header, content, position })
			.returning({ id: promptPhaseOverrides.id })
	)
	if (result.error) {
		logger.error("failed to create repo override", { error: result.error })
		throw errors.wrap(result.error, "create repo override")
	}

	const created = result.data[0]
	if (!created) {
		logger.error("insert returned no rows for repo override", { phase, header })
		throw errors.new("insert returned no rows")
	}

	revalidatePath("/prompts")
	return created
}
```

**Step 8: Add `updateRepoOverride` and `deleteRepoOverride`**

```typescript
const UpdateRepoOverrideInput = z.object({
	id: z.string().uuid(),
	content: z.string()
})

async function updateRepoOverride(input: unknown): Promise<void> {
	const parsed = UpdateRepoOverrideInput.safeParse(input)
	if (!parsed.success) {
		logger.error("invalid input for updateRepoOverride", { error: parsed.error })
		throw errors.new("invalid input")
	}

	const { id, content } = parsed.data
	logger.info("updating repo override", { id })

	const result = await errors.try(
		db.update(promptPhaseOverrides).set({ content }).where(eq(promptPhaseOverrides.id, id))
	)
	if (result.error) {
		logger.error("failed to update repo override", { error: result.error, id })
		throw errors.wrap(result.error, "update repo override")
	}

	revalidatePath("/prompts")
}

const DeleteRepoOverrideInput = z.object({
	id: z.string().uuid()
})

async function deleteRepoOverride(input: unknown): Promise<void> {
	const parsed = DeleteRepoOverrideInput.safeParse(input)
	if (!parsed.success) {
		logger.error("invalid input for deleteRepoOverride", { error: parsed.error })
		throw errors.new("invalid input")
	}

	const { id } = parsed.data
	logger.info("deleting repo override", { id })

	const result = await errors.try(
		db.delete(promptPhaseOverrides).where(eq(promptPhaseOverrides.id, id))
	)
	if (result.error) {
		logger.error("failed to delete repo override", { error: result.error, id })
		throw errors.wrap(result.error, "delete repo override")
	}

	revalidatePath("/prompts")
}
```

**Step 9: Add `reorderRepoSections`**

```typescript
const ReorderRepoSectionsInput = z.object({
	items: z.array(
		z.object({
			id: z.string().uuid(),
			table: z.enum(["base", "override"])
		})
	)
})

async function reorderRepoSections(input: unknown): Promise<void> {
	const parsed = ReorderRepoSectionsInput.safeParse(input)
	if (!parsed.success) {
		logger.error("invalid input for reorderRepoSections", { error: parsed.error })
		throw errors.new("invalid input")
	}

	const { items } = parsed.data
	logger.info("reordering repo sections", { count: items.length })

	const updates = items.map((item, idx) => {
		const tbl = item.table === "base" ? promptPhases : promptPhaseOverrides
		return db
			.update(tbl)
			.set({ position: idx * 10 })
			.where(eq(tbl.id, item.id))
	})

	const result = await errors.try(Promise.all(updates))
	if (result.error) {
		logger.error("failed to reorder repo sections", { error: result.error })
		throw errors.wrap(result.error, "reorder repo sections")
	}

	revalidatePath("/prompts")
}
```

**Step 10: Update exports**

```typescript
export {
	createRepoOverride,
	createRepoPhase,
	createUserOverride,
	createUserPhase,
	deleteRepoOverride,
	deleteRepoPhase,
	deleteUserOverride,
	deleteUserPhase,
	getAvailableRepos,
	reorderPhaseSections,
	reorderRepoPhases,
	reorderRepoSections,
	reorderUserPhases,
	updateRepoOverride,
	updateUserOverride
}
```

**Step 11: Verify**

Run: `bun typecheck`
Expected: PASS.

Run: `bun lint`
Expected: PASS.

**Step 12: Commit**

```bash
git add src/app/prompts/actions.ts
git commit -m "feat: add repo override server actions"
```

---

### Task 3: Update `page.tsx` for searchParams and repo data fetching

**Files:**
- Modify: `src/app/prompts/page.tsx`

The server component reads `searchParams` (a Promise in Next.js 16), conditionally fetches repo data, and passes everything to Content.

**Step 1: Rewrite `page.tsx`**

Replace the entire file. Key changes:
- Accept `searchParams` prop (Promise)
- Add repo data fetching (available repos, repo overrides, repo phases)
- Pass searchParams + repo context to Content alongside existing user context
- Export new types for repo data

```typescript
import { currentUser } from "@clerk/nextjs/server"
import { and, asc, eq, sql } from "drizzle-orm"
import * as React from "react"
import { Content } from "@/app/prompts/content"
import { db } from "@/db"
import {
	promptPhaseOverrides,
	promptPhases,
	promptRepoPhases,
	promptUserOverrides,
	promptUserPhases
} from "@/db/schemas/prompt"

const getBaseSections = db
	.select({
		id: promptPhases.id,
		phase: promptPhases.phase,
		header: promptPhases.header,
		content: promptPhases.content,
		position: promptPhases.position
	})
	.from(promptPhases)
	.orderBy(asc(promptPhases.phase), asc(promptPhases.position))
	.prepare("app_prompts_page_get_base_sections")

type BaseSection = Awaited<ReturnType<typeof getBaseSections.execute>>[number]

type UserContext = {
	slackUserId: string | undefined
	overrides: UserOverride[]
	phases: UserPhase[]
}

type RepoContext = {
	repository: string | undefined
	overrides: RepoOverride[]
	phases: RepoPhase[]
	availableRepos: string[]
}

function Page({
	searchParams
}: {
	searchParams: Promise<{ tab?: string; repo?: string }>
}) {
	const baseSectionsPromise = getBaseSections.execute()

	const userContextPromise: Promise<UserContext> = currentUser().then(async (user) => {
		if (!user) return { slackUserId: undefined, overrides: [], phases: [] }

		const slackAccount = user.externalAccounts.find((a) => a.provider === "oauth_slack")
		const slackUserId = slackAccount?.externalId

		if (!slackUserId) return { slackUserId: undefined, overrides: [], phases: [] }

		const [overrides, phases] = await Promise.all([
			db
				.select({
					id: promptUserOverrides.id,
					phase: promptUserOverrides.phase,
					header: promptUserOverrides.header,
					content: promptUserOverrides.content,
					position: promptUserOverrides.position
				})
				.from(promptUserOverrides)
				.where(eq(promptUserOverrides.slackUserId, slackUserId))
				.orderBy(asc(promptUserOverrides.phase), asc(promptUserOverrides.position)),
			db
				.select({
					id: promptUserPhases.id,
					phase: promptUserPhases.phase,
					position: promptUserPhases.position
				})
				.from(promptUserPhases)
				.where(eq(promptUserPhases.slackUserId, slackUserId))
				.orderBy(asc(promptUserPhases.position))
		])

		return { slackUserId, overrides, phases }
	})

	const repoContextPromise: Promise<RepoContext> = searchParams.then(async (params) => {
		const availableReposResult = await db.execute<{ repository: string }>(
			sql`SELECT DISTINCT repository FROM agent.prompt_phase_overrides UNION SELECT DISTINCT repository FROM agent.prompt_repo_phases ORDER BY repository`
		)
		const availableRepos = availableReposResult.rows.map((r) => r.repository)

		const repo = params.repo
		if (params.tab !== "repo" || !repo) {
			return { repository: undefined, overrides: [], phases: [], availableRepos }
		}

		const [overrides, phases] = await Promise.all([
			db
				.select({
					id: promptPhaseOverrides.id,
					phase: promptPhaseOverrides.phase,
					header: promptPhaseOverrides.header,
					content: promptPhaseOverrides.content,
					position: promptPhaseOverrides.position
				})
				.from(promptPhaseOverrides)
				.where(eq(promptPhaseOverrides.repository, repo))
				.orderBy(asc(promptPhaseOverrides.phase), asc(promptPhaseOverrides.position)),
			db
				.select({
					id: promptRepoPhases.id,
					phase: promptRepoPhases.phase,
					position: promptRepoPhases.position
				})
				.from(promptRepoPhases)
				.where(eq(promptRepoPhases.repository, repo))
				.orderBy(asc(promptRepoPhases.position))
		])

		return { repository: repo, overrides, phases, availableRepos }
	})

	return (
		<main className="h-[calc(100vh-3.5rem)] overflow-hidden">
			<React.Suspense
				fallback={<div className="text-muted-foreground text-sm">Loading prompts...</div>}
			>
				<Content
					baseSectionsPromise={baseSectionsPromise}
					userContextPromise={userContextPromise}
					repoContextPromise={repoContextPromise}
					searchParamsPromise={searchParams}
				/>
			</React.Suspense>
		</main>
	)
}

type UserOverride = {
	id: string
	phase: string
	header: string
	content: string
	position: number
}

type UserPhase = {
	id: string
	phase: string
	position: number
}

type RepoOverride = {
	id: string
	phase: string
	header: string
	content: string
	position: number
}

type RepoPhase = {
	id: string
	phase: string
	position: number
}

export type { BaseSection, RepoContext, RepoOverride, RepoPhase, UserContext, UserOverride, UserPhase }
export default Page
```

**Step 2: Verify**

Run: `bun typecheck`
Expected: Will FAIL because `content.tsx` doesn't accept the new props yet. That's expected — Task 4 fixes this.

**Step 3: Commit**

```bash
git add src/app/prompts/page.tsx
git commit -m "feat: add searchParams and repo data fetching to prompts page"
```

---

### Task 4: Update `content.tsx` with tabs and repo editing

**Files:**
- Modify: `src/app/prompts/content.tsx`

This is the largest task. The strategy:
1. Update `Content` to accept new props, add tab switching
2. Extract current sidebar + editor body into a `MeTab` component (move, don't rewrite)
3. Create a parallel `RepoTab` component that reuses shared sub-components (PhaseFolder, SectionTreeItem, EditorPanel, etc.)
4. Add a `RepoSelector` combobox component
5. Update `PromptPreviewDialog` with tab switching

**Step 1: Add new imports**

At the top of `content.tsx`, add:

```typescript
import { useRouter } from "next/navigation"
```

Add these to the existing import from `@/app/prompts/actions`:

```typescript
import {
	createRepoOverride,
	createRepoPhase,
	createUserOverride,
	createUserPhase,
	deleteRepoOverride,
	deleteRepoPhase,
	deleteUserOverride,
	deleteUserPhase,
	reorderPhaseSections,
	reorderRepoPhases,
	reorderRepoSections,
	reorderUserPhases,
	updateRepoOverride,
	updateUserOverride
} from "@/app/prompts/actions"
```

Update the type import from page.tsx:

```typescript
import type { BaseSection, RepoContext, UserOverride, UserPhase } from "@/app/prompts/page"
```

Add combobox imports:

```typescript
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList
} from "@/components/ui/combobox"
```

Add tabs imports:

```typescript
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
```

**Step 2: Update the `Content` component signature and body**

The `Content` function needs to accept the new props, resolve all promises, determine the active tab, and render either `MeTab` or `RepoTab`:

```typescript
function Content(props: {
	baseSectionsPromise: Promise<BaseSection[]>
	userContextPromise: Promise<UserContext>
	repoContextPromise: Promise<RepoContext>
	searchParamsPromise: Promise<{ tab?: string; repo?: string }>
}) {
	const baseSections = React.use(props.baseSectionsPromise)
	const userContext = React.use(props.userContextPromise)
	const repoContext = React.use(props.repoContextPromise)
	const searchParams = React.use(props.searchParamsPromise)
	const router = useRouter()

	const activeTab = searchParams.tab === "repo" ? "repo" : "me"

	const [previewOpen, setPreviewOpen] = React.useState(false)

	function handleTabChange(tab: string) {
		if (tab === "repo") {
			const repoParam = searchParams.repo
			const url = repoParam ? `/prompts?tab=repo&repo=${encodeURIComponent(repoParam)}` : "/prompts?tab=repo"
			router.push(url)
		} else {
			router.push("/prompts")
		}
	}

	return (
		<div data-slot="prompt-editor" className="flex h-full flex-col">
			<div className="flex items-center gap-2 border-b px-3 py-1.5">
				<Tabs value={activeTab} onValueChange={handleTabChange}>
					<TabsList>
						<TabsTrigger value="me">Me</TabsTrigger>
						<TabsTrigger value="repo">Repo</TabsTrigger>
					</TabsList>
				</Tabs>
				<div className="flex-1" />
				<button
					type="button"
					onClick={() => setPreviewOpen(true)}
					className="flex items-center gap-1.5 rounded px-2 py-1 text-muted-foreground text-xs hover:bg-accent hover:text-foreground"
				>
					<EyeIcon className="size-3.5" />
					Preview
				</button>
			</div>
			<div className="flex flex-1 overflow-hidden">
				{activeTab === "me" ? (
					<MeTab baseSections={baseSections} userContext={userContext} />
				) : (
					<RepoTab
						baseSections={baseSections}
						repoContext={repoContext}
						selectedRepo={searchParams.repo}
					/>
				)}
			</div>

			<PromptPreviewDialog
				open={previewOpen}
				onOpenChange={setPreviewOpen}
				baseSections={baseSections}
				userContext={userContext}
				repoContext={repoContext}
				availableRepos={repoContext.availableRepos}
			/>
		</div>
	)
}
```

**Step 3: Rename existing content body to `MeTab`**

Take the entire current body of `Content` (state declarations, all handlers, the JSX return with sidebar + editor) and move it into a new `MeTab` component. The props are:

```typescript
function MeTab(props: {
	baseSections: BaseSection[]
	userContext: UserContext
}) {
	// ALL existing state declarations from current Content (lines 260-277)
	// ALL existing handlers (handleSave, handleDeleteSection, etc.)
	// Return the existing JSX (sidebar + editor panel)
	// REMOVE the preview button and PromptPreviewDialog from here (moved to Content wrapper)
	// REMOVE the DeleteConfirmDialog — keep it inside MeTab since it's tab-specific
}
```

Key changes to MeTab vs the original Content:
- Remove `React.use()` calls — data comes as resolved props, not promises
- Remove `previewOpen` state and the preview button from sidebar (moved to top bar)
- Remove the `PromptPreviewDialog` render (moved to Content wrapper)
- Keep `DeleteConfirmDialog` inside MeTab
- Everything else stays identical

**Step 4: Create `RepoTab` component**

This is structurally identical to `MeTab` but uses repo data and repo actions. Create it by copying MeTab's structure with these substitutions:

| MeTab | RepoTab |
|-------|---------|
| `userContext.slackUserId` for identity checks | `props.selectedRepo` |
| `userContext.overrides` | `props.repoContext.overrides` |
| `userContext.phases` | `props.repoContext.phases` |
| `hasSlack` boolean for edit gating | `hasRepo` = `!!props.selectedRepo` |
| `createUserOverride(...)` | `createRepoOverride(...)` |
| `updateUserOverride(...)` | `updateRepoOverride(...)` |
| `deleteUserOverride(...)` | `deleteRepoOverride(...)` |
| `createUserPhase(...)` | `createRepoPhase(...)` |
| `deleteUserPhase(...)` | `deleteRepoPhase(...)` |
| `reorderUserPhases(...)` | `reorderRepoPhases(...)` |
| `reorderPhaseSections(...)` | `reorderRepoSections(...)` |
| action payloads use `slackUserId` | action payloads use `repository` |

```typescript
function RepoTab(props: {
	baseSections: BaseSection[]
	repoContext: RepoContext
	selectedRepo: string | undefined
}) {
	const router = useRouter()
	const hasRepo = !!props.selectedRepo

	// If no repo selected, show the repo selector + empty state
	if (!hasRepo) {
		return (
			<div className="flex h-full">
				<div className="flex w-72 shrink-0 flex-col border-r p-3">
					<RepoSelector
						availableRepos={props.repoContext.availableRepos}
						selectedRepo={undefined}
					/>
					<p className="mt-4 text-muted-foreground text-xs">
						Select a repository to manage its overrides.
					</p>
				</div>
				<EmptyState />
			</div>
		)
	}

	// Same state + handlers as MeTab but targeting repo tables
	// ... (all state declarations)
	// ... (all handlers using repo actions with `repository` instead of `slackUserId`)

	return (
		<div className="flex h-full">
			<div className="flex w-72 shrink-0 flex-col border-r">
				<div className="flex-1 overflow-y-auto p-3">
					<RepoSelector
						availableRepos={props.repoContext.availableRepos}
						selectedRepo={props.selectedRepo}
					/>
					<div className="mt-3 space-y-1">
						{/* Phase tree — same Sortable + PhaseFolder structure as MeTab */}
					</div>
					<button type="button" onClick={/* add phase handler */} className="...">
						<PlusIcon className="size-3.5" /> Add phase
					</button>
				</div>
				<ReorderPanel phase={selectedPhase} sections={computeReorderItems()} onReorder={handleReorderSections} />
			</div>
			<div className="flex flex-1 flex-col overflow-hidden">
				{/* EditorPanel — same as MeTab */}
			</div>
			<DeleteConfirmDialog target={deleteTarget} onCancel={...} onConfirm={...} />
		</div>
	)
}
```

**Step 5: Create `RepoSelector` component**

Uses the shadcn Combobox. Selecting a repo navigates to `/prompts?tab=repo&repo=<selected>`. Typing a new repo and pressing Enter also navigates.

```typescript
function RepoSelector(props: {
	availableRepos: string[]
	selectedRepo: string | undefined
}) {
	const router = useRouter()

	function handleSelect(value: string) {
		if (!value) return
		router.push(`/prompts?tab=repo&repo=${encodeURIComponent(value)}`)
	}

	return (
		<Combobox value={props.selectedRepo} onValueChange={handleSelect}>
			<ComboboxInput placeholder="Select repository..." />
			<ComboboxContent>
				<ComboboxList>
					{props.availableRepos.map((repo) => (
						<ComboboxItem key={repo} value={repo}>
							{repo}
						</ComboboxItem>
					))}
					<ComboboxEmpty>No repositories found. Type to create.</ComboboxEmpty>
				</ComboboxList>
			</ComboboxContent>
		</Combobox>
	)
}
```

Note: The base-ui Combobox may need adjustments for free-text entry (allowing the user to type a repo name that isn't in the list and navigate to it). Check the base-ui Combobox docs for `allowCustomValue` or similar prop. If the combobox doesn't support free-text natively, add a small "Use {typed}" option that appears when the filter returns no matches.

**Step 6: Update `PromptPreviewDialog` with tabs**

The preview dialog now has two tabs: "My Prompt" and "Repo Prompt".

```typescript
function PromptPreviewDialog(props: {
	open: boolean
	onOpenChange: (open: boolean) => void
	baseSections: BaseSection[]
	userContext: UserContext
	repoContext: RepoContext
	availableRepos: string[]
}) {
	const [previewTab, setPreviewTab] = React.useState<"me" | "repo">("me")
	const [previewRepo, setPreviewRepo] = React.useState<string | undefined>(
		props.repoContext.repository
	)

	const userPhases = computeEffectivePhases(props.userContext.phases)
	const userByPhase = computeEffectiveSections(
		userPhases,
		props.baseSections,
		props.userContext.overrides
	)
	const userPreview = composePreview(userPhases, userByPhase)

	const repoPhases = computeEffectivePhases(props.repoContext.phases)
	const repoByPhase = computeEffectiveSections(
		repoPhases,
		props.baseSections,
		props.repoContext.overrides
	)
	const repoPreview = composePreview(repoPhases, repoByPhase)

	const activePreview = previewTab === "me" ? userPreview : repoPreview

	function handleCopy() {
		navigator.clipboard.writeText(activePreview)
		toast.success("Copied prompt to clipboard")
	}

	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
				<DialogHeader>
					<DialogTitle>Prompt Preview</DialogTitle>
					<DialogDescription>
						Preview the composed prompt that will be sent to Cursor.
					</DialogDescription>
				</DialogHeader>
				<Tabs value={previewTab} onValueChange={(v) => setPreviewTab(v as "me" | "repo")}>
					<TabsList>
						<TabsTrigger value="me">My Prompt</TabsTrigger>
						<TabsTrigger value="repo">Repo Prompt</TabsTrigger>
					</TabsList>
				</Tabs>
				{previewTab === "repo" && (
					<div className="px-1">
						<RepoSelector
							availableRepos={props.availableRepos}
							selectedRepo={previewRepo}
						/>
					</div>
				)}
				<div className="flex-1 overflow-y-auto rounded-md border bg-muted/30 p-4">
					<pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground/90">
						{activePreview}
					</pre>
				</div>
				<DialogFooter>
					<Button variant="outline" size="sm" onClick={handleCopy}>
						<CopyIcon className="mr-1.5 size-3.5" />
						Copy
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
```

Note: The preview dialog's repo selector for the "Repo Prompt" tab is local state — it doesn't navigate, just switches which repo's preview is shown. This requires fetching that repo's overrides client-side OR using the data already passed in. For simplicity, the preview only shows repos whose data is already loaded (the currently selected repo from the URL). If the user wants to preview a different repo, they should select it in the main tab first.

**Step 7: Verify**

Run: `bun typecheck`
Expected: PASS.

Run: `bun lint`
Expected: PASS.

Run: `bun dev` and manually test:
1. `/prompts` — Me tab works as before
2. `/prompts?tab=repo` — Repo tab shows empty state with combobox
3. `/prompts?tab=repo&repo=incept-team/incept` — Repo tab loads repo overrides
4. Tab switching preserves URL state
5. Preview dialog tabs work

**Step 8: Commit**

```bash
git add src/app/prompts/content.tsx
git commit -m "feat: add repo tab with combobox, phase tree, and tabbed preview"
```

---

### Task 5: Final verification and cleanup

**Step 1: Full lint and typecheck**

Run: `bun typecheck && bun lint`
Expected: PASS.

**Step 2: Manual smoke test**

1. Create a repo override for `incept-team/incept` — add a section to the "research" phase
2. Edit the section content and save
3. Delete the section
4. Create a new phase for the repo
5. Reorder phases
6. Preview the repo prompt
7. Switch to Me tab — verify existing behavior unchanged
8. Preview from Me tab — verify My Prompt and Repo Prompt tabs in dialog

**Step 3: Commit any cleanup**

```bash
git add -A
git commit -m "chore: cleanup after repo overrides implementation"
```

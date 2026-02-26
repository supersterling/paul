import { currentUser } from "@clerk/nextjs/server"
import { asc, eq } from "drizzle-orm"
import * as React from "react"
import { getAvailableRepos } from "@/app/prompts/actions"
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

function Page({ searchParams }: { searchParams: Promise<{ tab?: string; repo?: string }> }) {
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
		const availableRepos = await getAvailableRepos()

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

export type {
	BaseSection,
	RepoContext,
	RepoOverride,
	RepoPhase,
	UserContext,
	UserOverride,
	UserPhase
}
export default Page

import { currentUser } from "@clerk/nextjs/server"
import { asc, eq } from "drizzle-orm"
import * as React from "react"
import { Content } from "@/app/prompts/content"
import { db } from "@/db"
import { promptPhases, promptUserOverrides, promptUserPhases } from "@/db/schemas/prompt"

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

function Page() {
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

	return (
		<main className="h-[calc(100vh-3.5rem)] overflow-hidden">
			<React.Suspense
				fallback={<div className="text-muted-foreground text-sm">Loading prompts...</div>}
			>
				<Content
					baseSectionsPromise={baseSectionsPromise}
					userContextPromise={userContextPromise}
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

export type { BaseSection, UserOverride, UserPhase }
export default Page

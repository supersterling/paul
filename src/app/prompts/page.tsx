import { currentUser } from "@clerk/nextjs/server"
import { asc, eq } from "drizzle-orm"
import * as React from "react"
import { Content } from "@/app/prompts/content"
import { db } from "@/db"
import { promptPhases, promptUserOverrides } from "@/db/schemas/prompt"

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
}

function Page() {
	const baseSectionsPromise = getBaseSections.execute()

	const userContextPromise: Promise<UserContext> = currentUser().then(async (user) => {
		if (!user) return { slackUserId: undefined, overrides: [] }

		const slackAccount = user.externalAccounts.find((a) => a.provider === "oauth_slack")
		const slackUserId = slackAccount?.externalId

		if (!slackUserId) return { slackUserId: undefined, overrides: [] }

		const overrides = await db
			.select({
				id: promptUserOverrides.id,
				phase: promptUserOverrides.phase,
				header: promptUserOverrides.header,
				content: promptUserOverrides.content,
				position: promptUserOverrides.position
			})
			.from(promptUserOverrides)
			.where(eq(promptUserOverrides.slackUserId, slackUserId))
			.orderBy(asc(promptUserOverrides.phase), asc(promptUserOverrides.position))

		return { slackUserId, overrides }
	})

	return (
		<main className="mx-auto max-w-4xl px-6 py-8">
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

export type { BaseSection, UserOverride }
export default Page

import * as logger from "@superbuilders/slog"
import { and, asc, eq } from "drizzle-orm"
import { db } from "@/db"
import { promptPhaseOverrides, promptPhases, promptUserOverrides } from "@/db/schemas/prompt"

type PromptSection = {
	header: string
	content: string
	position: number
}

const PHASE_ORDER = ["research", "propose", "build", "review", "pr"]

const RESPONSE_STYLE_SECTION: PromptSection = {
	header: "Response Style",
	content:
		"Keep responses under 10 lines. Be terse. The user will ask you to expand if needed. Do not produce wall-of-text responses.",
	position: -1
}

async function composeWorkflowPrompt(
	repository: string,
	featureRequest: string,
	slackUserId?: string
): Promise<string> {
	logger.debug("composing workflow prompt", {
		repository,
		slackUserId,
		phaseCount: PHASE_ORDER.length
	})

	const allSections: PromptSection[] = [RESPONSE_STYLE_SECTION]

	for (const phase of PHASE_ORDER) {
		const baseSections = await db
			.select({
				header: promptPhases.header,
				content: promptPhases.content,
				position: promptPhases.position
			})
			.from(promptPhases)
			.where(eq(promptPhases.phase, phase))
			.orderBy(asc(promptPhases.position))

		const overrideSections = await db
			.select({
				header: promptPhaseOverrides.header,
				content: promptPhaseOverrides.content,
				position: promptPhaseOverrides.position
			})
			.from(promptPhaseOverrides)
			.where(
				and(eq(promptPhaseOverrides.phase, phase), eq(promptPhaseOverrides.repository, repository))
			)
			.orderBy(asc(promptPhaseOverrides.position))

		let merged = mergeSections(baseSections, overrideSections)

		if (slackUserId) {
			const userSections = await db
				.select({
					header: promptUserOverrides.header,
					content: promptUserOverrides.content,
					position: promptUserOverrides.position
				})
				.from(promptUserOverrides)
				.where(
					and(
						eq(promptUserOverrides.phase, phase),
						eq(promptUserOverrides.slackUserId, slackUserId)
					)
				)
				.orderBy(asc(promptUserOverrides.position))

			merged = mergeSections(merged, userSections)
		}

		for (const section of merged) {
			allSections.push(section)
		}
	}

	allSections.push({ header: "Feature Request", content: featureRequest, position: 9999 })

	allSections.sort((a, b) => a.position - b.position)

	const blocks = allSections.map((s) => `## ${s.header}\n\n${s.content}`)

	logger.debug("workflow prompt composed", { sectionCount: blocks.length })

	return blocks.join("\n\n")
}

function mergeSections(base: PromptSection[], overrides: PromptSection[]): PromptSection[] {
	const overrideMap = new Map<string, PromptSection>()
	const newSections: PromptSection[] = []

	for (const override of overrides) {
		const matchesBase = base.some((b) => b.header === override.header)
		if (matchesBase) {
			overrideMap.set(override.header, override)
		} else {
			newSections.push(override)
		}
	}

	const merged = base.map((section) => {
		const override = overrideMap.get(section.header)
		if (override) {
			return { ...section, content: override.content }
		}
		return section
	})

	for (const section of newSections) {
		merged.push(section)
	}

	merged.sort((a, b) => a.position - b.position)

	return merged
}

export { PHASE_ORDER, composeWorkflowPrompt }

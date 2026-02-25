import * as logger from "@superbuilders/slog"
import { and, asc, eq } from "drizzle-orm"
import { db } from "@/db"
import {
	promptPhaseOverrides,
	promptPhases,
	promptUserOverrides,
	promptUserPhases
} from "@/db/schemas/prompt"

type PromptSection = {
	header: string
	content: string
	position: number
}

import { PHASE_ORDER } from "@/lib/prompt-constants"

const RESPONSE_STYLE_SECTION: PromptSection = {
	header: "Response Style",
	content:
		"Keep responses under 10 lines. Be terse. The user will ask you to expand if needed. Do not produce wall-of-text responses.",
	position: -1
}

async function resolvePhaseOrder(slackUserId: string | undefined): Promise<string[]> {
	if (!slackUserId) return PHASE_ORDER

	const userPhases = await db
		.select({ phase: promptUserPhases.phase })
		.from(promptUserPhases)
		.where(eq(promptUserPhases.slackUserId, slackUserId))
		.orderBy(asc(promptUserPhases.position))

	if (userPhases.length === 0) return PHASE_ORDER

	return userPhases.map((p) => p.phase)
}

async function composeWorkflowPrompt(
	repository: string,
	featureRequest: string,
	slackUserId?: string
): Promise<string> {
	const phases = await resolvePhaseOrder(slackUserId)

	logger.debug("composing workflow prompt", {
		repository,
		slackUserId,
		phaseCount: phases.length
	})

	const allSections: PromptSection[] = [RESPONSE_STYLE_SECTION]

	for (const phase of phases) {
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
		} else if (override.content.length > 0) {
			newSections.push(override)
		}
	}

	const merged: PromptSection[] = []
	for (const section of base) {
		const override = overrideMap.get(section.header)
		if (override) {
			if (override.content.length > 0) {
				merged.push({ ...section, content: override.content })
			}
		} else {
			merged.push(section)
		}
	}

	for (const section of newSections) {
		merged.push(section)
	}

	merged.sort((a, b) => a.position - b.position)

	return merged
}

export { composeWorkflowPrompt }

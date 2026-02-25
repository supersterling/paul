import * as logger from "@superbuilders/slog"
import { and, asc, eq } from "drizzle-orm"
import { db } from "@/db"
import { promptPhaseOverrides, promptPhases } from "@/db/schemas/prompt"

type PromptSection = {
	header: string
	content: string
	position: number
}

const PHASE_ORDER = ["research", "propose", "build", "review", "pr"]

async function composePhasePrompt(
	phase: string,
	repository: string,
	featureRequest?: string
): Promise<string> {
	logger.debug("composing phase prompt", { phase, repository })

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

	const merged = mergeSections(baseSections, overrideSections)

	if (featureRequest) {
		merged.push({ header: "Feature Request", content: featureRequest, position: 9999 })
	}

	const blocks = merged.map((s) => `## ${s.header}\n\n${s.content}`)

	logger.debug("prompt composed", { phase, sectionCount: blocks.length })

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

function nextPhase(current: string): string | undefined {
	const idx = PHASE_ORDER.indexOf(current)
	if (idx === -1) {
		return undefined
	}
	const next = PHASE_ORDER[idx + 1]
	return next
}

function phaseLabel(phase: string): string {
	const labels: Record<string, string> = {
		research: "Research",
		propose: "Propose",
		build: "Build",
		review: "Review",
		pr: "PR"
	}
	const label = labels[phase]
	if (!label) {
		return phase
	}
	return label
}

export { composePhasePrompt, nextPhase, PHASE_ORDER, phaseLabel }

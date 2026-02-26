"use server"

import * as errors from "@superbuilders/errors"
import * as logger from "@superbuilders/slog"
import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { db } from "@/db"
import {
	promptPhaseOverrides,
	promptPhases,
	promptRepoPhases,
	promptUserOverrides,
	promptUserPhases
} from "@/db/schemas/prompt"
import { PHASE_ORDER } from "@/lib/prompt-constants"

async function ensureUserPhasesMaterialized(slackUserId: string): Promise<void> {
	const existing = await db
		.select({ id: promptUserPhases.id })
		.from(promptUserPhases)
		.where(eq(promptUserPhases.slackUserId, slackUserId))
		.limit(1)

	if (existing.length > 0) return

	logger.info("materializing default phases", { slackUserId })

	const values = PHASE_ORDER.map((phase, idx) => ({
		slackUserId,
		phase,
		position: idx * 10
	}))

	const result = await errors.try(db.insert(promptUserPhases).values(values))
	if (result.error) {
		logger.error("failed to materialize phases", { error: result.error })
		throw errors.wrap(result.error, "materialize default phases")
	}
}

const CreateUserPhaseInput = z.object({
	slackUserId: z.string().min(1),
	phase: z.string().min(1)
})

async function createUserPhase(input: unknown): Promise<{ id: string }> {
	const parsed = CreateUserPhaseInput.safeParse(input)
	if (!parsed.success) {
		logger.error("invalid input for createUserPhase", { error: parsed.error })
		throw errors.new("invalid input")
	}

	const { slackUserId, phase } = parsed.data
	logger.info("creating user phase", { slackUserId, phase })

	await ensureUserPhasesMaterialized(slackUserId)

	const maxResult = await errors.try(
		db
			.select({ position: promptUserPhases.position })
			.from(promptUserPhases)
			.where(eq(promptUserPhases.slackUserId, slackUserId))
			.orderBy(promptUserPhases.position)
	)
	if (maxResult.error) {
		logger.error("failed to read phase positions", { error: maxResult.error })
		throw errors.wrap(maxResult.error, "read phase positions")
	}

	const lastRow = maxResult.data[maxResult.data.length - 1]
	const nextPosition = lastRow ? lastRow.position + 10 : 0

	const result = await errors.try(
		db
			.insert(promptUserPhases)
			.values({ slackUserId, phase, position: nextPosition })
			.returning({ id: promptUserPhases.id })
	)
	if (result.error) {
		logger.error("failed to create user phase", { error: result.error })
		throw errors.wrap(result.error, "create user phase")
	}

	const created = result.data[0]
	if (!created) {
		logger.error("insert returned no rows for phase", { phase })
		throw errors.new("insert returned no rows")
	}

	revalidatePath("/prompts")
	return created
}

const DeleteUserPhaseInput = z.object({
	slackUserId: z.string().min(1),
	phase: z.string().min(1)
})

async function deleteUserPhase(input: unknown): Promise<void> {
	const parsed = DeleteUserPhaseInput.safeParse(input)
	if (!parsed.success) {
		logger.error("invalid input for deleteUserPhase", { error: parsed.error })
		throw errors.new("invalid input")
	}

	const { slackUserId, phase } = parsed.data
	logger.info("deleting user phase", { slackUserId, phase })

	await ensureUserPhasesMaterialized(slackUserId)

	const phaseResult = await errors.try(
		db
			.delete(promptUserPhases)
			.where(and(eq(promptUserPhases.slackUserId, slackUserId), eq(promptUserPhases.phase, phase)))
	)
	if (phaseResult.error) {
		logger.error("failed to delete user phase", { error: phaseResult.error })
		throw errors.wrap(phaseResult.error, "delete user phase")
	}

	const sectionsResult = await errors.try(
		db
			.delete(promptUserOverrides)
			.where(
				and(eq(promptUserOverrides.slackUserId, slackUserId), eq(promptUserOverrides.phase, phase))
			)
	)
	if (sectionsResult.error) {
		logger.error("failed to delete phase sections", { error: sectionsResult.error })
		throw errors.wrap(sectionsResult.error, "delete phase sections")
	}

	revalidatePath("/prompts")
}

const ReorderUserPhasesInput = z.object({
	slackUserId: z.string().min(1),
	phases: z.array(z.string().min(1))
})

async function reorderUserPhases(input: unknown): Promise<void> {
	const parsed = ReorderUserPhasesInput.safeParse(input)
	if (!parsed.success) {
		logger.error("invalid input for reorderUserPhases", { error: parsed.error })
		throw errors.new("invalid input")
	}

	const { slackUserId, phases } = parsed.data
	logger.info("reordering user phases", { slackUserId, count: phases.length })

	await ensureUserPhasesMaterialized(slackUserId)

	const updates = phases.map((phase, idx) =>
		db
			.update(promptUserPhases)
			.set({ position: idx * 10 })
			.where(and(eq(promptUserPhases.slackUserId, slackUserId), eq(promptUserPhases.phase, phase)))
	)

	const result = await errors.try(Promise.all(updates))
	if (result.error) {
		logger.error("failed to reorder phases", { error: result.error })
		throw errors.wrap(result.error, "reorder phases")
	}

	revalidatePath("/prompts")
}

const CreateUserOverrideInput = z.object({
	slackUserId: z.string().min(1),
	phase: z.string().min(1),
	header: z.string().min(1),
	content: z.string(),
	position: z.number().int()
})

async function createUserOverride(input: unknown): Promise<{ id: string }> {
	const parsed = CreateUserOverrideInput.safeParse(input)
	if (!parsed.success) {
		logger.error("invalid input for createUserOverride", { error: parsed.error })
		throw errors.new("invalid input")
	}

	const { slackUserId, phase, header, content, position } = parsed.data
	logger.info("creating user override", { slackUserId, phase, header })

	const result = await errors.try(
		db
			.insert(promptUserOverrides)
			.values({ slackUserId, phase, header, content, position })
			.returning({ id: promptUserOverrides.id })
	)
	if (result.error) {
		logger.error("failed to create user override", { error: result.error })
		throw errors.wrap(result.error, "create user override")
	}

	const created = result.data[0]
	if (!created) {
		logger.error("insert returned no rows", { phase, header })
		throw errors.new("insert returned no rows")
	}

	revalidatePath("/prompts")
	return created
}

const UpdateUserOverrideInput = z.object({
	id: z.string().uuid(),
	content: z.string()
})

async function updateUserOverride(input: unknown): Promise<void> {
	const parsed = UpdateUserOverrideInput.safeParse(input)
	if (!parsed.success) {
		logger.error("invalid input for updateUserOverride", { error: parsed.error })
		throw errors.new("invalid input")
	}

	const { id, content } = parsed.data
	logger.info("updating user override", { id })

	const result = await errors.try(
		db.update(promptUserOverrides).set({ content }).where(eq(promptUserOverrides.id, id))
	)
	if (result.error) {
		logger.error("failed to update user override", { error: result.error, id })
		throw errors.wrap(result.error, "update user override")
	}

	revalidatePath("/prompts")
}

const DeleteUserOverrideInput = z.object({
	id: z.string().uuid()
})

async function deleteUserOverride(input: unknown): Promise<void> {
	const parsed = DeleteUserOverrideInput.safeParse(input)
	if (!parsed.success) {
		logger.error("invalid input for deleteUserOverride", { error: parsed.error })
		throw errors.new("invalid input")
	}

	const { id } = parsed.data
	logger.info("deleting user override", { id })

	const result = await errors.try(
		db.delete(promptUserOverrides).where(eq(promptUserOverrides.id, id))
	)
	if (result.error) {
		logger.error("failed to delete user override", { error: result.error, id })
		throw errors.wrap(result.error, "delete user override")
	}

	revalidatePath("/prompts")
}

const ReorderPhaseSectionsInput = z.object({
	items: z.array(
		z.object({
			id: z.string().uuid(),
			table: z.enum(["base", "override"])
		})
	)
})

async function reorderPhaseSections(input: unknown): Promise<void> {
	const parsed = ReorderPhaseSectionsInput.safeParse(input)
	if (!parsed.success) {
		logger.error("invalid input for reorderPhaseSections", { error: parsed.error })
		throw errors.new("invalid input")
	}

	const { items } = parsed.data
	logger.info("reordering phase sections", { count: items.length })

	const updates = items.map((item, idx) => {
		const tbl = item.table === "base" ? promptPhases : promptUserOverrides
		return db
			.update(tbl)
			.set({ position: idx * 10 })
			.where(eq(tbl.id, item.id))
	})

	const result = await errors.try(Promise.all(updates))
	if (result.error) {
		logger.error("failed to reorder sections", { error: result.error })
		throw errors.wrap(result.error, "reorder sections")
	}

	revalidatePath("/prompts")
}

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

async function getAvailableRepos(): Promise<string[]> {
	const [overrideRepos, phaseRepos] = await Promise.all([
		db.selectDistinct({ repository: promptPhaseOverrides.repository }).from(promptPhaseOverrides),
		db.selectDistinct({ repository: promptRepoPhases.repository }).from(promptRepoPhases)
	])

	const repoSet = new Set<string>()
	for (const r of overrideRepos) repoSet.add(r.repository)
	for (const r of phaseRepos) repoSet.add(r.repository)

	return [...repoSet].sort()
}

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

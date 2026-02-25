"use server"

import * as errors from "@superbuilders/errors"
import * as logger from "@superbuilders/slog"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { db } from "@/db"
import { promptPhases, promptUserOverrides } from "@/db/schemas/prompt"

const UpdateBaseSectionInput = z.object({
	id: z.string().uuid(),
	content: z.string().min(1)
})

async function updateBaseSection(input: unknown): Promise<void> {
	const parsed = UpdateBaseSectionInput.safeParse(input)
	if (!parsed.success) {
		logger.error("invalid input for updateBaseSection", { error: parsed.error })
		throw errors.new("invalid input")
	}

	const { id, content } = parsed.data
	logger.info("updating base section", { id })

	const result = await errors.try(
		db.update(promptPhases).set({ content }).where(eq(promptPhases.id, id))
	)
	if (result.error) {
		logger.error("failed to update base section", { error: result.error, id })
		throw errors.wrap(result.error, "update base section")
	}

	revalidatePath("/prompts")
}

const CreateUserOverrideInput = z.object({
	slackUserId: z.string().min(1),
	phase: z.string().min(1),
	header: z.string().min(1),
	content: z.string().min(1),
	position: z.number().int()
})

async function createUserOverride(input: unknown): Promise<void> {
	const parsed = CreateUserOverrideInput.safeParse(input)
	if (!parsed.success) {
		logger.error("invalid input for createUserOverride", { error: parsed.error })
		throw errors.new("invalid input")
	}

	const { slackUserId, phase, header, content, position } = parsed.data
	logger.info("creating user override", { slackUserId, phase, header })

	const result = await errors.try(
		db.insert(promptUserOverrides).values({ slackUserId, phase, header, content, position })
	)
	if (result.error) {
		logger.error("failed to create user override", { error: result.error })
		throw errors.wrap(result.error, "create user override")
	}

	revalidatePath("/prompts")
}

const UpdateUserOverrideInput = z.object({
	id: z.string().uuid(),
	content: z.string().min(1)
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

export { createUserOverride, deleteUserOverride, updateBaseSection, updateUserOverride }

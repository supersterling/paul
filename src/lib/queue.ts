import * as errors from "@superbuilders/errors"
import * as logger from "@superbuilders/slog"
import { and, asc, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { cursorThreadQueue } from "@/db/schemas/cursor"

const MAX_QUEUE_SIZE = 5

const ErrQueueFull = errors.new("queue full")
const ErrQueueCountFailed = errors.new("queue count query returned no rows")
const ErrQueueInsertFailed = errors.new("queue insert failed")

type QueueItem = {
	id: number
	threadId: string
	prompt: string
	rawMessage: string
	slackUserId: string
	messageId: string
	position: number
	status: string
	createdAt: Date
}

async function enqueue(item: {
	threadId: string
	prompt: string
	rawMessage: string
	slackUserId: string
	messageId: string
}): Promise<{ position: number; id: number }> {
	const countRows = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(cursorThreadQueue)
		.where(
			and(eq(cursorThreadQueue.threadId, item.threadId), eq(cursorThreadQueue.status, "pending"))
		)

	const countRow = countRows[0]
	if (countRow === undefined) {
		logger.error("failed to count pending queue items", { threadId: item.threadId })
		throw ErrQueueCountFailed
	}

	const count = countRow.count
	if (count >= MAX_QUEUE_SIZE) {
		logger.warn("queue full", { threadId: item.threadId, count })
		throw ErrQueueFull
	}

	const position = count + 1

	const inserted = await db
		.insert(cursorThreadQueue)
		.values({
			threadId: item.threadId,
			prompt: item.prompt,
			rawMessage: item.rawMessage,
			slackUserId: item.slackUserId,
			messageId: item.messageId,
			position,
			status: "pending",
			createdAt: new Date()
		})
		.returning({ id: cursorThreadQueue.id })

	const row = inserted[0]
	if (!row) {
		logger.error("queue insert returned no rows", { threadId: item.threadId })
		throw ErrQueueInsertFailed
	}

	logger.info("enqueued", { threadId: item.threadId, position, id: row.id })

	return { position, id: row.id }
}

async function dequeue(id: number): Promise<QueueItem | undefined> {
	const rows = await db
		.update(cursorThreadQueue)
		.set({ status: "cancelled" })
		.where(and(eq(cursorThreadQueue.id, id), eq(cursorThreadQueue.status, "pending")))
		.returning({
			id: cursorThreadQueue.id,
			threadId: cursorThreadQueue.threadId,
			prompt: cursorThreadQueue.prompt,
			rawMessage: cursorThreadQueue.rawMessage,
			slackUserId: cursorThreadQueue.slackUserId,
			messageId: cursorThreadQueue.messageId,
			position: cursorThreadQueue.position,
			status: cursorThreadQueue.status,
			createdAt: cursorThreadQueue.createdAt
		})

	const row = rows[0]
	if (!row) {
		logger.warn("dequeue failed, item not found or not pending", { id })
		return undefined
	}

	await compactPositions(row.threadId)

	logger.info("dequeued", { id, threadId: row.threadId })

	return row
}

async function popNext(threadId: string): Promise<QueueItem | undefined> {
	const rows = await db
		.select({
			id: cursorThreadQueue.id,
			threadId: cursorThreadQueue.threadId,
			prompt: cursorThreadQueue.prompt,
			rawMessage: cursorThreadQueue.rawMessage,
			slackUserId: cursorThreadQueue.slackUserId,
			messageId: cursorThreadQueue.messageId,
			position: cursorThreadQueue.position,
			status: cursorThreadQueue.status,
			createdAt: cursorThreadQueue.createdAt
		})
		.from(cursorThreadQueue)
		.where(and(eq(cursorThreadQueue.threadId, threadId), eq(cursorThreadQueue.status, "pending")))
		.orderBy(asc(cursorThreadQueue.position))
		.limit(1)

	const row = rows[0]
	if (!row) {
		return undefined
	}

	await db
		.update(cursorThreadQueue)
		.set({ status: "processing" })
		.where(eq(cursorThreadQueue.id, row.id))

	await compactPositions(threadId)

	logger.info("popped next queue item", { id: row.id, threadId })

	return {
		id: row.id,
		threadId: row.threadId,
		prompt: row.prompt,
		rawMessage: row.rawMessage,
		slackUserId: row.slackUserId,
		messageId: row.messageId,
		position: row.position,
		status: "processing",
		createdAt: row.createdAt
	}
}

async function pendingCount(threadId: string): Promise<number> {
	const rows = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(cursorThreadQueue)
		.where(and(eq(cursorThreadQueue.threadId, threadId), eq(cursorThreadQueue.status, "pending")))

	const row = rows[0]
	if (row === undefined) {
		logger.error("failed to count pending queue items", { threadId })
		throw ErrQueueCountFailed
	}

	return row.count
}

async function compactPositions(threadId: string): Promise<void> {
	const pending = await db
		.select({ id: cursorThreadQueue.id })
		.from(cursorThreadQueue)
		.where(and(eq(cursorThreadQueue.threadId, threadId), eq(cursorThreadQueue.status, "pending")))
		.orderBy(asc(cursorThreadQueue.position))

	for (let i = 0; i < pending.length; i++) {
		const item = pending[i]
		if (!item) continue
		await db
			.update(cursorThreadQueue)
			.set({ position: i + 1 })
			.where(eq(cursorThreadQueue.id, item.id))
	}
}

export {
	ErrQueueFull,
	ErrQueueCountFailed,
	ErrQueueInsertFailed,
	MAX_QUEUE_SIZE,
	compactPositions,
	dequeue,
	enqueue,
	pendingCount,
	popNext
}
export type { QueueItem }

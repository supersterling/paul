import * as errors from "@superbuilders/errors"
import * as logger from "@superbuilders/slog"
import type { Lock, StateAdapter } from "chat"
import { and, eq, gt, lt } from "drizzle-orm"
import { db } from "@/db"
import { botCache, botLocks, botSubscriptions } from "@/db/schemas/bot-state"

function createPostgresState(): StateAdapter {
	async function connect(): Promise<void> {}

	async function disconnect(): Promise<void> {}

	async function subscribe(threadId: string): Promise<void> {
		await db
			.insert(botSubscriptions)
			.values({ threadId, subscribedAt: new Date() })
			.onConflictDoNothing()
	}

	async function unsubscribe(threadId: string): Promise<void> {
		await db.delete(botSubscriptions).where(eq(botSubscriptions.threadId, threadId))
	}

	async function isSubscribed(threadId: string): Promise<boolean> {
		const rows = await db
			.select({ threadId: botSubscriptions.threadId })
			.from(botSubscriptions)
			.where(eq(botSubscriptions.threadId, threadId))

		return rows.length > 0
	}

	async function acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
		const now = Date.now()
		const expiresAt = now + ttlMs
		const token = crypto.randomUUID()

		await db.delete(botLocks).where(lt(botLocks.expiresAt, now))

		const result = await errors.try(
			db
				.insert(botLocks)
				.values({ threadId, token, expiresAt })
				.onConflictDoNothing()
				.returning({ threadId: botLocks.threadId })
		)
		if (result.error) {
			logger.debug("lock acquisition failed", { threadId, error: result.error })
			return null
		}

		if (result.data.length === 0) {
			return null
		}

		return { threadId, token, expiresAt }
	}

	async function releaseLock(lock: Lock): Promise<void> {
		await db
			.delete(botLocks)
			.where(and(eq(botLocks.threadId, lock.threadId), eq(botLocks.token, lock.token)))
	}

	async function extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
		const newExpiresAt = Date.now() + ttlMs
		const rows = await db
			.update(botLocks)
			.set({ expiresAt: newExpiresAt })
			.where(
				and(
					eq(botLocks.threadId, lock.threadId),
					eq(botLocks.token, lock.token),
					gt(botLocks.expiresAt, Date.now())
				)
			)
			.returning({ threadId: botLocks.threadId })

		if (rows.length === 0) {
			return false
		}

		lock.expiresAt = newExpiresAt
		return true
	}

	async function get<T = unknown>(key: string): Promise<T | null> {
		const rows = await db
			.select({ value: botCache.value, expiresAt: botCache.expiresAt })
			.from(botCache)
			.where(eq(botCache.key, key))

		const row = rows[0]
		if (!row) {
			return null
		}

		if (row.expiresAt && row.expiresAt < Date.now()) {
			await db.delete(botCache).where(eq(botCache.key, key))
			return null
		}

		const parsed = errors.trySync(() => JSON.parse(row.value))
		if (parsed.error) {
			logger.warn("failed to parse cached value", { key, error: parsed.error })
			return null
		}

		return parsed.data
	}

	async function set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
		const expiresAt = ttlMs ? Date.now() + ttlMs : null
		const serialized = JSON.stringify(value)

		await db
			.insert(botCache)
			.values({ key, value: serialized, expiresAt })
			.onConflictDoUpdate({
				target: botCache.key,
				set: { value: serialized, expiresAt }
			})
	}

	async function del(key: string): Promise<void> {
		await db.delete(botCache).where(eq(botCache.key, key))
	}

	return {
		connect,
		disconnect,
		subscribe,
		unsubscribe,
		isSubscribed,
		acquireLock,
		releaseLock,
		extendLock,
		get,
		set,
		delete: del
	}
}

export { createPostgresState }

import { bigint, pgSchema, text, timestamp } from "drizzle-orm/pg-core"

const agentSchema = pgSchema("agent")

const botSubscriptions = agentSchema.table("bot_subscriptions", {
	threadId: text("thread_id").primaryKey(),
	subscribedAt: timestamp("subscribed_at", { mode: "date", withTimezone: true }).notNull()
})

const botCache = agentSchema.table("bot_cache", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
	expiresAt: bigint("expires_at", { mode: "number" })
})

const botLocks = agentSchema.table("bot_locks", {
	threadId: text("thread_id").primaryKey(),
	token: text("token").notNull(),
	expiresAt: bigint("expires_at", { mode: "number" }).notNull()
})

export { botCache, botLocks, botSubscriptions }

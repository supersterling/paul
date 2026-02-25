import { pgSchema, text, timestamp } from "drizzle-orm/pg-core"

const agentSchema = pgSchema("agent")

const cursorAgentThreads = agentSchema.table("cursor_agent_threads", {
	threadId: text("thread_id").primaryKey(),
	agentId: text("agent_id").notNull(),
	status: text("status").notNull(),
	repository: text("repository").notNull(),
	ref: text("ref").notNull(),
	branchName: text("branch_name"),
	agentUrl: text("agent_url").notNull(),
	pendingFollowup: text("pending_followup"),
	createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull()
})

export { cursorAgentThreads }

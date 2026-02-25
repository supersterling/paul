import { integer, jsonb, pgSchema, serial, text, timestamp } from "drizzle-orm/pg-core"

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
	pendingFollowupImages: jsonb("pending_followup_images"),
	createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull()
})

const cursorThreadQueue = agentSchema.table("cursor_thread_queue", {
	id: serial("id").primaryKey(),
	threadId: text("thread_id").notNull(),
	prompt: text("prompt").notNull(),
	rawMessage: text("raw_message").notNull(),
	slackUserId: text("slack_user_id").notNull(),
	messageId: text("message_id").notNull(),
	position: integer("position").notNull(),
	status: text("status").notNull(),
	createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull()
})

export { cursorAgentThreads, cursorThreadQueue }

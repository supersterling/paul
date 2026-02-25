import { integer, pgSchema, text, uuid } from "drizzle-orm/pg-core"

const agentSchema = pgSchema("agent")

const promptPhases = agentSchema.table("prompt_phases", {
	id: uuid("id").defaultRandom().primaryKey(),
	phase: text("phase").notNull(),
	header: text("header").notNull(),
	content: text("content").notNull(),
	position: integer("position").notNull()
})

const promptPhaseOverrides = agentSchema.table("prompt_phase_overrides", {
	id: uuid("id").defaultRandom().primaryKey(),
	repository: text("repository").notNull(),
	phase: text("phase").notNull(),
	header: text("header").notNull(),
	content: text("content").notNull(),
	position: integer("position").notNull()
})

export { promptPhaseOverrides, promptPhases }

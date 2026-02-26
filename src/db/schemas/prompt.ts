import { integer, pgSchema, text, unique, uuid } from "drizzle-orm/pg-core"

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

const promptRepoPhases = agentSchema.table(
	"prompt_repo_phases",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		repository: text("repository").notNull(),
		phase: text("phase").notNull(),
		position: integer("position").notNull()
	},
	(t) => [unique("prompt_repo_phases_repo_phase").on(t.repository, t.phase)]
)

const promptUserOverrides = agentSchema.table(
	"prompt_user_overrides",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		slackUserId: text("slack_user_id").notNull(),
		phase: text("phase").notNull(),
		header: text("header").notNull(),
		content: text("content").notNull(),
		position: integer("position").notNull()
	},
	(t) => [unique("prompt_user_overrides_user_phase_header").on(t.slackUserId, t.phase, t.header)]
)

const promptUserPhases = agentSchema.table(
	"prompt_user_phases",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		slackUserId: text("slack_user_id").notNull(),
		phase: text("phase").notNull(),
		position: integer("position").notNull()
	},
	(t) => [unique("prompt_user_phases_user_phase").on(t.slackUserId, t.phase)]
)

export {
	promptPhaseOverrides,
	promptPhases,
	promptRepoPhases,
	promptUserOverrides,
	promptUserPhases
}

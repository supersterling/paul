import { drizzle } from "drizzle-orm/bun-sql"
import * as agent from "@/db/schemas/agent"
import * as botState from "@/db/schemas/bot-state"
import * as cursor from "@/db/schemas/cursor"
import * as prompt from "@/db/schemas/prompt"
import { env } from "@/env"

const schema = { ...agent, ...botState, ...cursor, ...prompt }
const db = drizzle(env.DATABASE_URL, { schema })

export { db }

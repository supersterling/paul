import { drizzle } from "drizzle-orm/bun-sql"
import * as agent from "@/db/schemas/agent"
import * as botState from "@/db/schemas/bot-state"
import * as cursor from "@/db/schemas/cursor"
import { env } from "@/env"

const schema = { ...agent, ...botState, ...cursor }
const db = drizzle(env.DATABASE_URL, { schema })

export { db }

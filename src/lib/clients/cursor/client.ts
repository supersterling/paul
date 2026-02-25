import createClient from "openapi-fetch"
import type { paths } from "@/lib/clients/cursor/openapi"

const BASE_URL = "https://api.cursor.com"

function createCursorClient(apiKey: string) {
	return createClient<paths>({
		baseUrl: BASE_URL,
		headers: {
			Authorization: `Bearer ${apiKey}`
		}
	})
}

type CursorClient = ReturnType<typeof createCursorClient>

export { createCursorClient }
export type { CursorClient, paths }

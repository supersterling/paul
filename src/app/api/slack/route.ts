import { after } from "next/server"
import { bot } from "@/lib/bot"

async function POST(request: Request) {
	return bot.webhooks.slack(request, {
		waitUntil: (task) => after(() => task)
	})
}

export { POST }

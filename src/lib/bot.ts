import { createSlackAdapter } from "@chat-adapter/slack"
import { createMemoryState } from "@chat-adapter/state-memory"
import * as errors from "@superbuilders/errors"
import * as logger from "@superbuilders/slog"
import { Chat, type Thread, ThreadImpl } from "chat"
import { inngest } from "@/inngest"

const CHANNEL_REPOS: Record<string, { repository: string; ref: string }> = {
	C0AHSQHA5A4: { repository: "incept-team/incept", ref: "main" }
}

const bot = new Chat({
	userName: "cursor-bot",
	adapters: {
		slack: createSlackAdapter()
	},
	state: createMemoryState()
}).registerSingleton()

bot.onNewMention(async (thread, message) => {
	const prompt = message.text.trim()
	if (!prompt) {
		await thread.post("Give me a task and I'll launch a Cursor agent for it.")
		return
	}

	const config = CHANNEL_REPOS[thread.channelId]
	if (!config) {
		await thread.post(`No repo configured for this channel (\`${thread.channelId}\`).`)
		return
	}

	await inngest.send({
		name: "cursor/agent.launch",
		data: {
			prompt,
			repository: config.repository,
			ref: config.ref,
			threadId: thread.id
		}
	})

	await thread.post(
		`Launching Cursor agent on \`${config.repository}\` (branch: \`${config.ref}\`)...`
	)
})

function thread(threadId: string): Thread {
	const firstColon = threadId.indexOf(":")
	if (firstColon === -1) {
		logger.error("invalid thread id format", { threadId })
		throw errors.new("invalid thread id format, expected adapter:channel:ts")
	}
	const adapterName = threadId.slice(0, firstColon)
	const secondColon = threadId.indexOf(":", firstColon + 1)
	if (secondColon === -1) {
		logger.error("invalid thread id format", { threadId })
		throw errors.new("invalid thread id format, expected adapter:channel:ts")
	}
	const channelId = threadId.slice(0, secondColon)
	return new ThreadImpl({
		adapterName,
		channelId,
		id: threadId
	})
}

export { bot, CHANNEL_REPOS, thread }

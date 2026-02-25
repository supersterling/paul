import { createSlackAdapter } from "@chat-adapter/slack"
import { createMemoryState } from "@chat-adapter/state-memory"
import { Chat } from "chat"
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
})

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

export { bot, CHANNEL_REPOS }

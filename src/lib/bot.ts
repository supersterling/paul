import { createSlackAdapter } from "@chat-adapter/slack"
import { createMemoryState } from "@chat-adapter/state-memory"
import * as errors from "@superbuilders/errors"
import * as logger from "@superbuilders/slog"
import { Actions, Button, Card, CardText, Chat, type Thread, ThreadImpl } from "chat"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { cursorAgentThreads } from "@/db/schemas/cursor"
import { env } from "@/env"
import { inngest } from "@/inngest"
import { createCursorClient } from "@/lib/clients/cursor/client"

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
	const result = await errors.try(handleNewMention(thread, message.text))
	if (result.error) {
		logger.error("onNewMention failed", { error: result.error, threadId: thread.id })
		await postError(thread, result.error)
	}
})

bot.onSubscribedMessage(async (thread, message) => {
	const result = await errors.try(handleSubscribedMessage(thread, message))
	if (result.error) {
		logger.error("onSubscribedMessage failed", { error: result.error, threadId: thread.id })
		await postError(thread, result.error)
	}
})

bot.onAction("cursor-stop-and-followup", async (event) => {
	const result = await errors.try(handleStopAndFollowup(event.thread, event.threadId))
	if (result.error) {
		logger.error("stop-and-followup action failed", {
			error: result.error,
			threadId: event.threadId
		})
		await postError(event.thread, result.error)
	}
})

bot.onAction("cursor-cancel-followup", async (event) => {
	const result = await errors.try(handleCancelFollowup(event.thread, event.threadId))
	if (result.error) {
		logger.error("cancel-followup action failed", {
			error: result.error,
			threadId: event.threadId
		})
		await postError(event.thread, result.error)
	}
})

async function postError(thread: Thread<unknown>, err: Error): Promise<void> {
	const postResult = await errors.try(thread.post(`*Error:* \`${err.message}\``))
	if (postResult.error) {
		logger.error("failed to post error to thread", { error: postResult.error })
	}
}

async function handleNewMention(thread: Thread, rawText: string): Promise<void> {
	const prompt = rawText.replace(/@U0AGS2FM1NX/g, "@Cursor").trim()
	if (!prompt) {
		await thread.post("Give me a task and I'll launch a Cursor agent for it.")
		return
	}

	const config = CHANNEL_REPOS[thread.channelId]
	if (!config) {
		await thread.post(`No repo configured for this channel (\`${thread.channelId}\`).`)
		return
	}

	await thread.subscribe()

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
}

type FollowupMessage = {
	text: string
	author: {
		userId: string
		userName: string
		fullName: string
		isBot: boolean | "unknown"
		isMe: boolean
	}
}

async function handleSubscribedMessage(thread: Thread, message: FollowupMessage): Promise<void> {
	const followupText = message.text.replace(/@U0AGS2FM1NX/g, "@Cursor").trim()
	if (!followupText) {
		return
	}

	logger.debug("subscribed message received", { threadId: thread.id, text: followupText })

	const rows = await db
		.select({
			agentId: cursorAgentThreads.agentId,
			status: cursorAgentThreads.status,
			agentUrl: cursorAgentThreads.agentUrl
		})
		.from(cursorAgentThreads)
		.where(eq(cursorAgentThreads.threadId, thread.id))

	const row = rows[0]
	if (!row) {
		logger.warn("no agent found for subscribed thread", { threadId: thread.id })
		return
	}

	const apiKey = env.CURSOR_API_KEY
	if (!apiKey) {
		logger.error("missing CURSOR_API_KEY for followup")
		throw errors.new("CURSOR_API_KEY not configured")
	}

	if (row.status === "RUNNING" || row.status === "CREATING") {
		await db
			.update(cursorAgentThreads)
			.set({ pendingFollowup: followupText })
			.where(eq(cursorAgentThreads.threadId, thread.id))

		const card = Card({
			children: [
				CardText("The agent is still running. To send a follow-up, I need to stop it first."),
				Actions([
					Button({
						id: "cursor-stop-and-followup",
						label: "Stop & Send Follow-up",
						style: "danger"
					}),
					Button({
						id: "cursor-cancel-followup",
						label: "Cancel"
					})
				])
			]
		})

		await thread.postEphemeral(message.author, card, { fallbackToDM: false })
		return
	}

	await sendFollowup(apiKey, row.agentId, followupText)
	await thread.post("Follow-up sent to the agent.")
	logger.info("followup sent", { agentId: row.agentId, threadId: thread.id })
}

async function handleStopAndFollowup(thread: Thread<unknown>, threadId: string): Promise<void> {
	logger.info("stop and followup action", { threadId })

	const rows = await db
		.select({
			agentId: cursorAgentThreads.agentId,
			pendingFollowup: cursorAgentThreads.pendingFollowup
		})
		.from(cursorAgentThreads)
		.where(eq(cursorAgentThreads.threadId, threadId))

	const row = rows[0]
	if (!row) {
		logger.error("no agent found for action", { threadId })
		throw errors.new("no agent found for this thread")
	}

	if (!row.pendingFollowup) {
		logger.error("no pending followup", { threadId })
		throw errors.new("no pending follow-up message found")
	}

	const apiKey = env.CURSOR_API_KEY
	if (!apiKey) {
		logger.error("missing CURSOR_API_KEY for stop+followup")
		throw errors.new("CURSOR_API_KEY not configured")
	}

	const client = createCursorClient(apiKey)

	const stopResponse = await client.POST("/v0/agents/{id}/stop", {
		params: { path: { id: row.agentId } }
	})

	if (stopResponse.error) {
		const detail = JSON.stringify(stopResponse.error)
		logger.error("failed to stop agent", { error: detail, agentId: row.agentId })
		throw errors.new(`cursor stop API: ${detail}`)
	}

	logger.info("agent stopped", { agentId: row.agentId })

	await sendFollowup(apiKey, row.agentId, row.pendingFollowup)

	await db
		.update(cursorAgentThreads)
		.set({ pendingFollowup: null, status: "FINISHED" })
		.where(eq(cursorAgentThreads.threadId, threadId))

	await thread.post("Agent stopped and follow-up sent.")
	logger.info("stop and followup complete", { agentId: row.agentId })
}

async function handleCancelFollowup(thread: Thread<unknown>, threadId: string): Promise<void> {
	logger.debug("cancel followup action", { threadId })

	await db
		.update(cursorAgentThreads)
		.set({ pendingFollowup: null })
		.where(eq(cursorAgentThreads.threadId, threadId))

	await thread.post("Cancelled.")
}

async function sendFollowup(apiKey: string, agentId: string, text: string): Promise<void> {
	const client = createCursorClient(apiKey)
	const { error } = await client.POST("/v0/agents/{id}/followup", {
		params: { path: { id: agentId } },
		body: { prompt: { text } }
	})

	if (error) {
		const detail = JSON.stringify(error)
		logger.error("cursor followup api error", { error: detail, agentId })
		throw errors.new(`cursor followup API: ${detail}`)
	}
}

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

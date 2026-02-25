import { createSlackAdapter } from "@chat-adapter/slack"
import * as errors from "@superbuilders/errors"
import * as logger from "@superbuilders/slog"
import { Actions, Button, Card, CardText, Chat, type Thread, ThreadImpl } from "chat"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { cursorAgentThreads } from "@/db/schemas/cursor"
import { env } from "@/env"
import { inngest } from "@/inngest"
import { createCursorClient } from "@/lib/clients/cursor/client"
import { composeWorkflowPrompt } from "@/lib/prompt-compose"
import { createPostgresState } from "@/lib/state-postgres"

const CHANNEL_REPOS: Record<string, { repository: string; ref: string }> = {
	C0AHSQHA5A4: { repository: "incept-team/incept", ref: "main" }
}

const bot = new Chat({
	userName: "cursor-bot",
	adapters: {
		slack: createSlackAdapter()
	},
	state: createPostgresState()
}).registerSingleton()

bot.onNewMention(async (thread, message) => {
	const result = await errors.try(handleNewMention(thread, message))
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

async function reactToMessage(
	thread: Thread<unknown>,
	messageId: string,
	emoji: string,
	action: "add" | "remove"
): Promise<void> {
	const fn = action === "add" ? thread.adapter.addReaction : thread.adapter.removeReaction
	const result = await errors.try(fn.call(thread.adapter, thread.id, messageId, emoji))
	if (result.error) {
		logger.warn("failed to update reaction", { action, emoji, error: result.error })
	}
}

type IncomingMessage = {
	id: string
	text: string
	author: {
		userId: string
		userName: string
		fullName: string
		isBot: boolean | "unknown"
		isMe: boolean
	}
}

const BOT_MENTION_PATTERN = /^@U0AGS2FM1NX/

async function handleNewMention(thread: Thread, message: IncomingMessage): Promise<void> {
	if (!BOT_MENTION_PATTERN.test(message.text)) {
		logger.debug("ignoring non-leading mention", { threadId: thread.id })
		return
	}

	const prompt = message.text.replace(/@U0AGS2FM1NX/g, "@Cursor").trim()
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

	const reactResult = await errors.try(
		thread.adapter.addReaction(thread.id, message.id, "one-sec-cooking")
	)
	if (reactResult.error) {
		logger.warn("failed to react to mention", { error: reactResult.error })
	}

	const composedPrompt = await composeWorkflowPrompt(config.repository, prompt)

	await inngest.send({
		name: "cursor/agent.launch",
		data: {
			prompt: composedPrompt,
			repository: config.repository,
			ref: config.ref,
			threadId: thread.id
		}
	})
}

async function handleSubscribedMessage(thread: Thread, message: IncomingMessage): Promise<void> {
	const followupText = message.text.replace(/@U0AGS2FM1NX/g, "@Cursor").trim()
	if (!followupText) {
		return
	}

	logger.debug("subscribed message received", { threadId: thread.id, text: followupText })

	await reactToMessage(thread, message.id, "see_no_evil", "add")

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
		await reactToMessage(thread, message.id, "see_no_evil", "remove")
		return
	}

	const apiKey = env.CURSOR_API_KEY
	if (!apiKey) {
		await reactToMessage(thread, message.id, "see_no_evil", "remove")
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
		await reactToMessage(thread, message.id, "see_no_evil", "remove")
		return
	}

	await sendFollowup(apiKey, row.agentId, followupText)

	await inngest.send({
		name: "cursor/followup.sent",
		data: { agentId: row.agentId, threadId: thread.id, agentUrl: row.agentUrl }
	})

	await reactToMessage(thread, message.id, "see_no_evil", "remove")

	await thread.post(
		"*Follow-up sent*\n\nYour follow-up has been sent to the agent. Waiting for a response..."
	)
	logger.info("followup sent", { agentId: row.agentId, threadId: thread.id })
}

async function handleStopAndFollowup(thread: Thread<unknown>, threadId: string): Promise<void> {
	logger.info("stop and followup action", { threadId })

	const rows = await db
		.select({
			agentId: cursorAgentThreads.agentId,
			agentUrl: cursorAgentThreads.agentUrl,
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
		.set({ pendingFollowup: null })
		.where(eq(cursorAgentThreads.threadId, threadId))

	await inngest.send({
		name: "cursor/followup.sent",
		data: { agentId: row.agentId, threadId, agentUrl: row.agentUrl }
	})

	await thread.post(
		"*Follow-up sent*\n\nAgent stopped and follow-up sent. Waiting for a response..."
	)
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

export { CHANNEL_REPOS, bot, thread }

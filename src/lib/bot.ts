import { createSlackAdapter } from "@chat-adapter/slack"
import * as errors from "@superbuilders/errors"
import * as logger from "@superbuilders/slog"
import type { Attachment } from "chat"
import { Actions, type Author, Button, Card, CardText, Chat, type Thread, ThreadImpl } from "chat"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { cursorAgentThreads } from "@/db/schemas/cursor"
import { env } from "@/env"
import { inngest } from "@/inngest"
import { createCursorClient } from "@/lib/clients/cursor/client"
import { composeWorkflowPrompt } from "@/lib/prompt-compose"
import { dequeue, ErrQueueFull, enqueue, MAX_QUEUE_SIZE, pendingCount } from "@/lib/queue"
import type { CursorImage } from "@/lib/slack-images"
import { extractImages, parseCursorImages } from "@/lib/slack-images"
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

bot.onAction("cursor-queue", async (event) => {
	const result = await errors.try(
		handleQueue(event.thread, event.threadId, event.user, event.messageId)
	)
	if (result.error) {
		logger.error("queue action failed", { error: result.error, threadId: event.threadId })
		await postError(event.thread, result.error)
	}
})

bot.onAction("cursor-dequeue", async (event) => {
	const result = await errors.try(
		handleDequeue(event.thread, event.threadId, event.user, event.value)
	)
	if (result.error) {
		logger.error("dequeue action failed", { error: result.error, threadId: event.threadId })
		await postError(event.thread, result.error)
	}
})

async function postError(thread: Thread<unknown>, err: Error): Promise<void> {
	const postResult = await errors.try(thread.post(`*Error:* \`${err.message}\``))
	if (postResult.error) {
		logger.error("failed to post error to thread", { error: postResult.error })
	}
}

async function postWarnings(thread: Thread<unknown>, warnings: string[]): Promise<void> {
	if (warnings.length === 0) return
	const text = warnings.map((w) => `> ${w}`).join("\n")
	const postResult = await errors.try(thread.post(text))
	if (postResult.error) {
		logger.warn("failed to post image warnings", { error: postResult.error })
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
	attachments: Attachment[]
	author: {
		userId: string
		userName: string
		fullName: string
		isBot: boolean | "unknown"
		isMe: boolean
	}
}

const BOT_USER_ID = "U0AGS2FM1NX"
const BOT_MENTION_PATTERN = new RegExp(`^@${BOT_USER_ID}`)
const USER_MENTION_PATTERN = /@(?!here\b|channel\b|everyone\b)\S+/g

async function handleNewMention(thread: Thread, message: IncomingMessage): Promise<void> {
	if (!BOT_MENTION_PATTERN.test(message.text)) {
		logger.debug("ignoring non-leading mention", { threadId: thread.id })
		return
	}

	const prompt = message.text.replace(new RegExp(`@${BOT_USER_ID}`, "g"), "@Cursor").trim()
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

	const { images, warnings } = await extractImages(message.attachments)
	await postWarnings(thread, warnings)

	const composedPrompt = await composeWorkflowPrompt(
		config.repository,
		prompt,
		message.author.userId
	)

	await inngest.send({
		name: "cursor/agent.launch",
		data: {
			prompt: composedPrompt,
			repository: config.repository,
			ref: config.ref,
			threadId: thread.id,
			images
		}
	})
}

function isDirectedElsewhere(text: string): boolean {
	const mentions = text.match(USER_MENTION_PATTERN)
	if (!mentions) return false
	return !mentions.some((m) => m === `@${BOT_USER_ID}`)
}

async function handleSubscribedMessage(thread: Thread, message: IncomingMessage): Promise<void> {
	if (isDirectedElsewhere(message.text)) {
		logger.debug("ignoring message directed at others", { threadId: thread.id })
		return
	}

	const followupText = message.text.replace(new RegExp(`@${BOT_USER_ID}`, "g"), "@Cursor").trim()
	if (!followupText) {
		return
	}

	logger.debug("subscribed message received", { threadId: thread.id, text: followupText })

	await reactToMessage(thread, message.id, "see_no_evil", "add")

	const { images, warnings } = await extractImages(message.attachments)
	await postWarnings(thread, warnings)

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
		const followupImages = images.length > 0 ? images : null
		await db
			.update(cursorAgentThreads)
			.set({
				pendingFollowup: followupText,
				pendingFollowupImages: followupImages
			})
			.where(eq(cursorAgentThreads.threadId, thread.id))

		const queueCount = await pendingCount(thread.id)
		const queueIsFull = queueCount >= MAX_QUEUE_SIZE

		const stopButton = Button({
			id: "cursor-stop-and-followup",
			label: "Stop & Send Now",
			style: "danger"
		})
		const cancelButton = Button({
			id: "cursor-cancel-followup",
			label: "Cancel"
		})

		const buttons = queueIsFull
			? [stopButton, cancelButton]
			: [
					Button({
						id: "cursor-queue",
						label: `Queue This (#${queueCount + 1} in line)`,
						style: "primary"
					}),
					stopButton,
					cancelButton
				]

		const cardText = queueIsFull
			? `The agent is still running. Queue is full (${MAX_QUEUE_SIZE}/${MAX_QUEUE_SIZE}).`
			: "The agent is still running. You can queue this message or stop the agent."

		const card = Card({
			children: [CardText(cardText), Actions(buttons)]
		})

		await thread.postEphemeral(message.author, card, { fallbackToDM: false })
		await reactToMessage(thread, message.id, "see_no_evil", "remove")
		return
	}

	await sendFollowup(apiKey, row.agentId, followupText, images)

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
			pendingFollowup: cursorAgentThreads.pendingFollowup,
			pendingFollowupImages: cursorAgentThreads.pendingFollowupImages
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

	const pendingImages = parseCursorImages(row.pendingFollowupImages)
	await sendFollowup(apiKey, row.agentId, row.pendingFollowup, pendingImages)

	await db
		.update(cursorAgentThreads)
		.set({ pendingFollowup: null, pendingFollowupImages: null })
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
		.set({ pendingFollowup: null, pendingFollowupImages: null })
		.where(eq(cursorAgentThreads.threadId, threadId))

	await thread.post("Cancelled.")
}

async function handleQueue(
	thread: Thread<unknown>,
	threadId: string,
	user: Author,
	messageId: string
): Promise<void> {
	logger.info("queue action", { threadId, userId: user.userId })

	const rows = await db
		.select({
			pendingFollowup: cursorAgentThreads.pendingFollowup,
			repository: cursorAgentThreads.repository
		})
		.from(cursorAgentThreads)
		.where(eq(cursorAgentThreads.threadId, threadId))

	const row = rows[0]
	if (!row) {
		logger.error("no agent found for queue action", { threadId })
		throw errors.new("no agent found for this thread")
	}

	if (!row.pendingFollowup) {
		logger.error("no pending followup for queue action", { threadId })
		throw errors.new("no pending follow-up message found")
	}

	const config = CHANNEL_REPOS[thread.channelId]
	if (!config) {
		logger.error("no repo configured for channel", { channelId: thread.channelId })
		throw errors.new("no repo configured for this channel")
	}

	const composedPrompt = await composeWorkflowPrompt(
		config.repository,
		row.pendingFollowup,
		user.userId
	)

	const enqueueResult = await errors.try(
		enqueue({
			threadId,
			prompt: composedPrompt,
			rawMessage: row.pendingFollowup,
			slackUserId: user.userId,
			messageId
		})
	)
	if (enqueueResult.error) {
		if (errors.is(enqueueResult.error, ErrQueueFull)) {
			const fullCard = Card({
				children: [
					CardText(`Queue is full (${MAX_QUEUE_SIZE}/${MAX_QUEUE_SIZE}). Try again later.`)
				]
			})
			await thread.postEphemeral(user, fullCard, { fallbackToDM: false })
			return
		}
		logger.error("enqueue failed", { error: enqueueResult.error, threadId })
		throw errors.wrap(enqueueResult.error, "enqueue")
	}

	await db
		.update(cursorAgentThreads)
		.set({ pendingFollowup: null, pendingFollowupImages: null })
		.where(eq(cursorAgentThreads.threadId, threadId))

	await reactToMessage(thread, messageId, "hourglass_flowing_sand", "add")

	const position = enqueueResult.data.position
	const itemId = enqueueResult.data.id

	const queuedCard = Card({
		children: [
			CardText(`Queued at position #${position}.`),
			Actions([
				Button({
					id: "cursor-dequeue",
					label: "Remove from Queue",
					style: "danger",
					value: String(itemId)
				})
			])
		]
	})

	await thread.postEphemeral(user, queuedCard, { fallbackToDM: false })
	logger.info("message queued", { threadId, position, itemId })
}

async function handleDequeue(
	thread: Thread<unknown>,
	threadId: string,
	user: Author,
	value: string | undefined
): Promise<void> {
	logger.info("dequeue action", { threadId, value })

	if (!value) {
		logger.error("dequeue action missing value", { threadId })
		throw errors.new("missing queue item id")
	}

	const itemId = Number.parseInt(value, 10)
	if (Number.isNaN(itemId)) {
		logger.error("dequeue action invalid value", { threadId, value })
		throw errors.new("invalid queue item id")
	}

	const item = await dequeue(itemId)
	if (!item) {
		const goneCard = Card({
			children: [CardText("Item was already removed or processed.")]
		})
		await thread.postEphemeral(user, goneCard, { fallbackToDM: false })
		return
	}

	if (item.messageId) {
		await reactToMessage(thread, item.messageId, "hourglass_flowing_sand", "remove")
	}

	const removedCard = Card({
		children: [CardText("Removed from queue.")]
	})
	await thread.postEphemeral(user, removedCard, { fallbackToDM: false })
	logger.info("item dequeued", { threadId, itemId })
}

async function sendFollowup(
	apiKey: string,
	agentId: string,
	text: string,
	images: CursorImage[]
): Promise<void> {
	const client = createCursorClient(apiKey)
	const promptBody = images.length > 0 ? { text, images } : { text }
	const { error } = await client.POST("/v0/agents/{id}/followup", {
		params: { path: { id: agentId } },
		body: { prompt: promptBody }
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

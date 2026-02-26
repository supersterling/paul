import * as errors from "@superbuilders/errors"
import type { Thread } from "chat"
import { and, eq } from "drizzle-orm"
import type { Logger } from "inngest"
import { NonRetriableError } from "inngest"
import { db } from "@/db"
import { cursorAgentThreads } from "@/db/schemas/cursor"
import { env } from "@/env"
import { inngest } from "@/inngest"
import { buildResultMessage } from "@/inngest/functions/cursor/format"
import { thread } from "@/lib/bot"
import { createCursorClient } from "@/lib/clients/cursor/client"
import { popNext } from "@/lib/queue"

async function postToThread(
	t: Thread,
	message: string,
	logger: Logger,
	context: string
): Promise<void> {
	const result = await errors.try(t.post(message))
	if (result.error) {
		logger.error("failed to post to slack", { error: result.error, context })
		throw errors.wrap(result.error, context)
	}
}

function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text
	return `${text.slice(0, maxLength - 3)}...`
}

const agentLifecycle = inngest.createFunction(
	{
		id: "cursor/agent-lifecycle",
		cancelOn: [
			{
				event: "cursor/followup.sent",
				if: "event.data.threadId == async.data.threadId"
			}
		]
	},
	{ event: "cursor/agent.launch" },
	async ({ event, logger, step }) => {
		const {
			prompt,
			repository,
			ref,
			threadId,
			images,
			model,
			branchName,
			autoCreatePr,
			openAsCursorGithubApp,
			skipReviewerRequest
		} = event.data

		const apiKey = env.CURSOR_API_KEY
		if (!apiKey) {
			logger.error("missing CURSOR_API_KEY")
			throw new NonRetriableError("CURSOR_API_KEY not configured")
		}

		const webhookUrl = env.INNGEST_WEBHOOK_URL
		if (!webhookUrl) {
			logger.error("missing INNGEST_WEBHOOK_URL")
			throw new NonRetriableError("INNGEST_WEBHOOK_URL not configured")
		}

		const agent = await step.run("launch-agent", async () => {
			const client = createCursorClient(apiKey)
			logger.info("launching cursor agent", {
				repository,
				ref,
				prompt,
				imageCount: images.length
			})

			const promptBody = images.length > 0 ? { text: prompt, images } : { text: prompt }

			const targetConfig = {
				autoCreatePr: autoCreatePr !== undefined ? autoCreatePr : true,
				openAsCursorGithubApp: openAsCursorGithubApp !== undefined ? openAsCursorGithubApp : false,
				skipReviewerRequest: skipReviewerRequest !== undefined ? skipReviewerRequest : false,
				autoBranch: true,
				...(branchName ? { branchName } : {})
			}

			const { data, error } = await client.POST("/v0/agents", {
				body: {
					prompt: promptBody,
					...(model ? { model } : {}),
					source: { repository: `https://github.com/${repository}`, ref },
					target: targetConfig,
					webhook: { url: webhookUrl }
				}
			})

			if (error) {
				logger.error("cursor api error", { error: JSON.stringify(error) })
				throw new NonRetriableError(`Cursor API error: ${error.error?.message}`)
			}

			logger.info("cursor agent launched", {
				agentId: data.id,
				name: data.name,
				status: data.status,
				branchName: data.target.branchName,
				url: data.target.url
			})

			return {
				agentId: data.id,
				name: data.name,
				branchName: data.target.branchName,
				url: data.target.url
			}
		})

		await step.run("post-confirmation", async () => {
			const t = thread(threadId)
			const branchSuffix = agent.branchName ? `, branch \`${agent.branchName}\`` : ""
			const lines = [
				"*Running*",
				"",
				`Your agent is running on \`${repository}\`${branchSuffix}.`,
				"",
				`View the agent in <${agent.url}|Cursor>.`
			]
			const message = lines.join("\n")
			logger.info("posting confirmation", { threadId })
			await postToThread(t, message, logger, "post confirmation to slack")

			await db.insert(cursorAgentThreads).values({
				threadId,
				agentId: agent.agentId,
				status: "CREATING",
				repository,
				ref,
				branchName: agent.branchName,
				agentUrl: agent.url,
				createdAt: new Date()
			})

			logger.info("cursor agent thread row inserted", { threadId, agentId: agent.agentId })
		})

		await step.run("mark-running", async () => {
			await db
				.update(cursorAgentThreads)
				.set({ status: "RUNNING" })
				.where(eq(cursorAgentThreads.threadId, threadId))
		})

		const completionEvent = await step.waitForEvent("wait-for-completion", {
			event: "cursor/agent.finished",
			if: `async.data.agentId == '${agent.agentId}'`,
			timeout: "30d"
		})

		const lastMessage = await step.run("fetch-conversation", async () => {
			if (!completionEvent) {
				return ""
			}

			const client = createCursorClient(apiKey)
			const { data, error } = await client.GET("/v0/agents/{id}/conversation", {
				params: { path: { id: agent.agentId } }
			})

			if (error) {
				logger.warn("failed to fetch conversation", { agentId: agent.agentId })
				return ""
			}

			const messages = data.messages
			for (let i = messages.length - 1; i >= 0; i--) {
				const msg = messages[i]
				if (msg && msg.type === "assistant_message") {
					return msg.text
				}
			}

			return ""
		})

		await step.run("post-result", async () => {
			const t = thread(threadId)
			const finalStatus = completionEvent ? completionEvent.data.status : "EXPIRED"

			const claimed = await db
				.update(cursorAgentThreads)
				.set({
					status: finalStatus,
					branchName: completionEvent?.data.branchName
				})
				.where(
					and(eq(cursorAgentThreads.threadId, threadId), eq(cursorAgentThreads.status, "RUNNING"))
				)
				.returning({ threadId: cursorAgentThreads.threadId })

			if (claimed.length === 0) {
				logger.info("skipping post-result, another lifecycle claimed this thread", {
					threadId
				})
				return
			}

			if (!completionEvent) {
				logger.warn("agent timed out", { agentId: agent.agentId })
				const timeoutMsg = `*Timed out*\n\nYour agent timed out.\n\nView the agent in <${agent.url}|Cursor>.`
				await postToThread(t, timeoutMsg, logger, "post timeout to slack")
				return
			}

			logger.info("agent completed", {
				agentId: agent.agentId,
				status: completionEvent.data.status,
				prUrl: completionEvent.data.prUrl,
				branchName: completionEvent.data.branchName
			})

			const resultMsg = buildResultMessage(completionEvent.data, agent.url, lastMessage)
			await postToThread(t, resultMsg, logger, "post result to slack")
		})

		await step.run("check-queue", async () => {
			const next = await popNext(threadId)
			if (!next) {
				logger.info("no queued items", { threadId })
				return
			}

			logger.info("sending queued followup", { threadId, queueItemId: next.id })

			if (next.messageId) {
				const t = thread(threadId)
				const reactResult = await errors.try(
					t.adapter.removeReaction(t.id, next.messageId, "hourglass_flowing_sand")
				)
				if (reactResult.error) {
					logger.warn("failed to remove hourglass reaction", { error: reactResult.error })
				}
			}

			const t = thread(threadId)
			const preview = truncate(next.rawMessage, 200)
			const queueMsg = `*Sending queued follow-up*\n\n_"${preview}"_`
			await postToThread(t, queueMsg, logger, "post queue followup to slack")

			const client = createCursorClient(apiKey)
			const { error } = await client.POST("/v0/agents/{id}/followup", {
				params: { path: { id: agent.agentId } },
				body: { prompt: { text: next.rawMessage } }
			})

			if (error) {
				const detail = JSON.stringify(error)
				logger.error("cursor followup api error for queued item", {
					error: detail,
					agentId: agent.agentId
				})
				await postToThread(
					t,
					`*Error sending queued follow-up:* \`${detail}\``,
					logger,
					"post queue error"
				)
				return
			}

			await inngest.send({
				name: "cursor/followup.sent",
				data: { agentId: agent.agentId, threadId, agentUrl: agent.url }
			})

			logger.info("queued followup sent", { threadId, queueItemId: next.id })
		})

		return { agentId: agent.agentId, status: completionEvent?.data.status }
	}
)

export { agentLifecycle }

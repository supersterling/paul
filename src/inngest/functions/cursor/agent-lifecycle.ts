import * as errors from "@superbuilders/errors"
import type { Thread } from "chat"
import { eq } from "drizzle-orm"
import type { Logger } from "inngest"
import { NonRetriableError } from "inngest"
import { db } from "@/db"
import { cursorAgentThreads } from "@/db/schemas/cursor"
import { env } from "@/env"
import { inngest } from "@/inngest"
import { thread } from "@/lib/bot"
import { createCursorClient } from "@/lib/clients/cursor/client"

type AgentInfo = {
	agentId: string
	name: string
	branchName?: string
	url: string
}

type CompletionData = {
	status: "FINISHED" | "ERROR"
	summary?: string
	branchName?: string
	prUrl?: string
	agentUrl?: string
}

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

function buildResultMessage(
	data: CompletionData,
	agent: AgentInfo,
	lastAssistantMessage: string
): string {
	const { status, prUrl, branchName, agentUrl } = data
	const viewUrl = agentUrl ? agentUrl : agent.url
	const isError = status === "ERROR"
	const heading = isError ? "*Agent errored*" : "*Agent finished*"

	const lines = [heading]

	if (branchName) {
		lines.push(`Branch: \`${branchName}\``)
	}
	if (prUrl) {
		lines.push(`<${prUrl}|View PR>`)
	}
	if (isError) {
		lines.push(`<${viewUrl}|View in Cursor>`)
	}

	if (lastAssistantMessage) {
		lines.push("")
		const quoted = lastAssistantMessage
			.split("\n")
			.map((line) => `> ${line}`)
			.join("\n")
		lines.push(quoted)
	}

	return lines.join("\n")
}

const agentLifecycle = inngest.createFunction(
	{ id: "cursor/agent-lifecycle" },
	{ event: "cursor/agent.launch" },
	async ({ event, logger, step }) => {
		const { prompt, repository, ref, threadId } = event.data

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
			logger.info("launching cursor agent", { repository, ref, prompt })

			const { data, error } = await client.POST("/v0/agents", {
				body: {
					prompt: { text: prompt },
					source: { repository: `https://github.com/${repository}`, ref },
					target: {
						autoCreatePr: true,
						openAsCursorGithubApp: false,
						skipReviewerRequest: false,
						autoBranch: true
					},
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
			const branchDisplay = agent.branchName ? ` on branch \`${agent.branchName}\`` : ""
			const message = `Agent launched${branchDisplay} \u2014 <${agent.url}|View in Cursor>`
			logger.info("posting confirmation", { threadId, message })
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

			await db
				.update(cursorAgentThreads)
				.set({
					status: finalStatus,
					branchName: completionEvent?.data.branchName
				})
				.where(eq(cursorAgentThreads.threadId, threadId))

			logger.info("cursor agent thread status updated", { threadId, status: finalStatus })

			if (!completionEvent) {
				logger.warn("agent timed out", { agentId: agent.agentId })
				await postToThread(
					t,
					`Agent timed out. <${agent.url}|Check manually>`,
					logger,
					"post timeout to slack"
				)
				return
			}

			const isError = completionEvent.data.status === "ERROR"
			if (isError) {
				logger.error("agent errored", { agentId: agent.agentId })
			} else {
				logger.info("agent finished", {
					agentId: agent.agentId,
					prUrl: completionEvent.data.prUrl,
					branchName: completionEvent.data.branchName
				})
			}

			const message = buildResultMessage(completionEvent.data, agent, lastMessage)
			await postToThread(t, message, logger, "post result to slack")
		})

		return { agentId: agent.agentId, status: completionEvent?.data.status }
	}
)

export { agentLifecycle }

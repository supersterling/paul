import * as errors from "@superbuilders/errors"
import type { Thread } from "chat"
import type { Logger } from "inngest"
import { NonRetriableError } from "inngest"
import { env } from "@/env"
import { inngest } from "@/inngest"
import { thread } from "@/lib/bot"
import { createCursorClient } from "@/lib/clients/cursor"

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
	agent: AgentInfo
): { message: string; level: "error" | "info" } {
	const { status, summary, prUrl, branchName, agentUrl } = data
	const viewUrl = agentUrl ? agentUrl : agent.url

	if (status === "ERROR") {
		const summaryLine = summary ? `\n${summary}` : ""
		return {
			message: `*Agent errored*${summaryLine}\n<${viewUrl}|View in Cursor>`,
			level: "error"
		}
	}

	const summaryLine = summary ? `\n${summary}` : ""
	const prLine = prUrl ? `\n<${prUrl}|View PR>` : ""
	const branchLine = branchName ? `\nBranch: \`${branchName}\`` : ""
	return {
		message: `*Agent finished*${summaryLine}${prLine}${branchLine}`,
		level: "info"
	}
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
		})

		const completionEvent = await step.waitForEvent("wait-for-completion", {
			event: "cursor/agent.finished",
			if: `async.data.agentId == '${agent.agentId}'`,
			timeout: "30d"
		})

		await step.run("post-result", async () => {
			const t = thread(threadId)

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

			const result = buildResultMessage(completionEvent.data, agent)

			if (result.level === "error") {
				logger.error("agent errored", {
					agentId: agent.agentId,
					summary: completionEvent.data.summary
				})
			} else {
				logger.info("agent finished", {
					agentId: agent.agentId,
					summary: completionEvent.data.summary,
					prUrl: completionEvent.data.prUrl,
					branchName: completionEvent.data.branchName
				})
			}

			await postToThread(t, result.message, logger, "post result to slack")
		})

		return { agentId: agent.agentId, status: completionEvent?.data.status }
	}
)

export { agentLifecycle }

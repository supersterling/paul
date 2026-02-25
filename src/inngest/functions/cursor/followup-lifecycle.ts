import * as errors from "@superbuilders/errors"
import { and, eq } from "drizzle-orm"
import { NonRetriableError } from "inngest"
import { db } from "@/db"
import { cursorAgentThreads } from "@/db/schemas/cursor"
import { env } from "@/env"
import { inngest } from "@/inngest"
import { buildResultMessage } from "@/inngest/functions/cursor/format"
import { thread } from "@/lib/bot"
import { createCursorClient } from "@/lib/clients/cursor/client"

const followupLifecycle = inngest.createFunction(
	{
		id: "cursor/followup-lifecycle",
		cancelOn: [
			{
				event: "cursor/followup.sent",
				if: "event.data.threadId == async.data.threadId"
			}
		]
	},
	{ event: "cursor/followup.sent" },
	async ({ event, logger, step }) => {
		const { agentId, threadId, agentUrl } = event.data

		const apiKey = env.CURSOR_API_KEY
		if (!apiKey) {
			logger.error("missing CURSOR_API_KEY")
			throw new NonRetriableError("CURSOR_API_KEY not configured")
		}

		await step.run("mark-running", async () => {
			await db
				.update(cursorAgentThreads)
				.set({ status: "RUNNING" })
				.where(eq(cursorAgentThreads.threadId, threadId))
		})

		const completionEvent = await step.waitForEvent("wait-for-followup-completion", {
			event: "cursor/agent.finished",
			if: `async.data.agentId == '${agentId}'`,
			timeout: "30d"
		})

		const lastMessage = await step.run("fetch-conversation", async () => {
			if (!completionEvent) {
				return ""
			}

			const client = createCursorClient(apiKey)
			const { data, error } = await client.GET("/v0/agents/{id}/conversation", {
				params: { path: { id: agentId } }
			})

			if (error) {
				logger.warn("failed to fetch conversation", { agentId })
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

		await step.run("post-followup-result", async () => {
			const t = thread(threadId)
			const finalStatus = completionEvent ? completionEvent.data.status : "EXPIRED"

			const claimed = await db
				.update(cursorAgentThreads)
				.set({ status: finalStatus, branchName: completionEvent?.data.branchName })
				.where(
					and(eq(cursorAgentThreads.threadId, threadId), eq(cursorAgentThreads.status, "RUNNING"))
				)
				.returning({ threadId: cursorAgentThreads.threadId })

			if (claimed.length === 0) {
				logger.info("skipping post-followup-result, another lifecycle claimed this thread", {
					threadId
				})
				return
			}

			if (!completionEvent) {
				logger.warn("agent timed out after followup", { agentId })
				const timeoutMsg = `*Timed out*\n\nYour agent timed out.\n\nView the agent in <${agentUrl}|Cursor>.`
				const postResult = await errors.try(t.post(timeoutMsg))
				if (postResult.error) {
					logger.error("failed to post timeout", { error: postResult.error })
				}
				return
			}

			const message = buildResultMessage(completionEvent.data, agentUrl, lastMessage)
			const postResult = await errors.try(t.post(message))
			if (postResult.error) {
				logger.error("failed to post followup result", { error: postResult.error })
			}
		})

		return { agentId, status: completionEvent?.data.status }
	}
)

export { followupLifecycle }

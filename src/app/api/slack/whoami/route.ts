import * as errors from "@superbuilders/errors"
import * as logger from "@superbuilders/slog"
import { env } from "@/env"

async function GET(): Promise<Response> {
	const token = env.SLACK_BOT_TOKEN
	if (!token) {
		return Response.json({ error: "SLACK_BOT_TOKEN not configured" }, { status: 500 })
	}

	const result = await errors.try(
		fetch("https://slack.com/api/auth.test", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json"
			}
		}).then((r) => r.json())
	)
	if (result.error) {
		logger.error("slack auth.test failed", { error: result.error })
		return Response.json({ error: "slack auth.test request failed" }, { status: 500 })
	}

	const data = result.data as {
		ok: boolean
		user_id?: string
		bot_id?: string
		team?: string
		team_id?: string
		error?: string
	}

	if (!data.ok) {
		return Response.json({ error: data.error ?? "slack returned ok: false" }, { status: 500 })
	}

	return Response.json({
		user_id: data.user_id,
		bot_id: data.bot_id,
		team: data.team,
		team_id: data.team_id,
		hint: `Set SLACK_BOT_USER_ID=${data.user_id} in your Vercel env vars`
	})
}

export { GET }

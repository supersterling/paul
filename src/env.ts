// biome-ignore-all lint/style/noProcessEnv: env wrapper needs to be able to access process.env
import * as logger from "@superbuilders/slog"
import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

logger.setDefaultLogLevel(logger.DEBUG)

const isServerRuntime = typeof window === "undefined"

if (!process.env.NEXT_RUNTIME && isServerRuntime) {
	const { loadEnvConfig } = require("@next/env")
	const projectDir = process.cwd()
	loadEnvConfig(projectDir)
}

const env = createEnv({
	/**
	 * Specify your server-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars.
	 */
	server: {
		ANTHROPIC_API_KEY: z.string().optional(),
		CLERK_SECRET_KEY: z.string().optional(),
		DATABASE_URL: z.url(),
		INNGEST_EVENT_KEY: z.string().optional(),
		INNGEST_SIGNING_KEY: z.string().optional(),
		VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
		VERCEL_GIT_COMMIT_SHA: z.string().optional(),
		VERCEL_OIDC_TOKEN: z.string().optional(),
		NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
		GITHUB_PAT_TOKEN: z.string().optional(),
		SLACK_BOT_TOKEN: z.string().optional(),
		SLACK_SIGNING_SECRET: z.string().optional(),
		INNGEST_WEBHOOK_URL: z.string().url().optional(),
		CURSOR_API_KEY: z.string().optional()
	},

	/**
	 * Specify your client-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars. To expose them to the client, prefix them with
	 * `NEXT_PUBLIC_`.
	 */
	client: {
		NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional()
	},

	/**
	 * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
	 * middlewares) or client-side so we need to destruct manually.
	 */
	runtimeEnv: {
		ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
		CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
		DATABASE_URL: process.env.DATABASE_URL,
		INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
		INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY,
		NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
		VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
		VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
		VERCEL_OIDC_TOKEN: process.env.VERCEL_OIDC_TOKEN,
		NODE_ENV: process.env.NODE_ENV,
		GITHUB_PAT_TOKEN: process.env.GITHUB_PAT_TOKEN,
		SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
		SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
		INNGEST_WEBHOOK_URL: process.env.INNGEST_WEBHOOK_URL,
		CURSOR_API_KEY: process.env.CURSOR_API_KEY
	},
	/**
	 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
	 * useful for Docker builds.
	 */
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	/**
	 * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
	 * `SOME_VAR=''` will throw an error.
	 */
	emptyStringAsUndefined: true
})

export { env }

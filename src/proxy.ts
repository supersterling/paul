import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"
import type { NextFetchEvent, NextRequest } from "next/server"

const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)", "/api(.*)"])

// biome-ignore lint/style/useExportsLast: Next.js requires statically analyzable config export
export const config = {
	matcher: [
		"/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
		"/(api|trpc)(.*)"
	]
}

const handler = clerkMiddleware(async (auth, request) => {
	if (!isPublicRoute(request)) {
		await auth.protect()
	}
})

function proxy(request: NextRequest, event: NextFetchEvent) {
	return handler(request, event)
}

export { proxy }

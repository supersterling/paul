import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs"
import type { Metadata } from "next"
import { Geist, Inter } from "next/font/google"
import Link from "next/link"
import type * as React from "react"
import "@/app/globals.css"
import { cn } from "@/lib/utils"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

const metadata: Metadata = {
	title: "Paul",
	description: "Prompt management for Cursor agents",
	icons: [{ rel: "icon", url: "/favicon.svg", type: "image/svg+xml" }]
}

const geist = Geist({
	subsets: ["latin"],
	variable: "--font-geist-sans"
})

function RootLayout({ children }: { readonly children: React.ReactNode }) {
	return (
		<ClerkProvider appearance={{ cssLayerName: "clerk" }}>
			<html lang="en" className={cn(geist.variable, inter.variable)}>
				<body>
					<header data-slot="nav" className="flex h-14 items-center justify-between border-b px-6">
						<nav className="flex items-center gap-6">
							<Link href="/" className="font-semibold text-sm">
								Paul
							</Link>
							<Link
								href={{ pathname: "/prompts" }}
								className="text-muted-foreground text-sm hover:text-foreground"
							>
								Prompts
							</Link>
						</nav>
						<div className="flex items-center gap-4">
							<SignedOut>
								<SignInButton />
							</SignedOut>
							<SignedIn>
								<UserButton />
							</SignedIn>
						</div>
					</header>
					{children}
				</body>
			</html>
		</ClerkProvider>
	)
}

export { metadata }
export default RootLayout

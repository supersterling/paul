import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs"
import type { Metadata } from "next"
import { Lora, Poppins } from "next/font/google"
import Link from "next/link"
import type * as React from "react"
import { Toaster } from "sonner"
import "@/app/globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { cn } from "@/lib/utils"

const poppins = Poppins({
	subsets: ["latin"],
	weight: ["300", "400", "500", "600", "700"],
	variable: "--font-sans"
})

const lora = Lora({
	subsets: ["latin"],
	variable: "--font-serif"
})

const metadata: Metadata = {
	title: "Paul",
	description: "Prompt management for Cursor agents",
	icons: [{ rel: "icon", url: "/favicon.svg", type: "image/svg+xml" }]
}

function RootLayout({ children }: { readonly children: React.ReactNode }) {
	return (
		<ClerkProvider appearance={{ cssLayerName: "clerk" }}>
			<html lang="en" className={cn(poppins.variable, lora.variable)} suppressHydrationWarning>
				<body>
					<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
						<header
							data-slot="nav"
							className="flex h-14 items-center justify-between border-b px-6"
						>
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
								<ThemeSwitcher />
								<SignedOut>
									<SignInButton />
								</SignedOut>
								<SignedIn>
									<UserButton />
								</SignedIn>
							</div>
						</header>
						{children}
						<Toaster richColors position="bottom-right" />
					</ThemeProvider>
				</body>
			</html>
		</ClerkProvider>
	)
}

export { metadata }
export default RootLayout

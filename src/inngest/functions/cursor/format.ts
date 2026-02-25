type CompletionData = {
	status: "FINISHED" | "ERROR"
	summary?: string
	branchName?: string
	prUrl?: string
	agentUrl?: string
}

function buildResultMessage(
	data: CompletionData,
	agentUrl: string,
	lastAssistantMessage: string
): string {
	const viewUrl = data.agentUrl ? data.agentUrl : agentUrl
	const isError = data.status === "ERROR"

	const lines: string[] = []

	if (isError) {
		lines.push("*Error*")
		lines.push("")
		const branchSuffix = data.branchName ? ` on branch \`${data.branchName}\`` : ""
		lines.push(`Your agent experienced an error${branchSuffix}.`)
	} else {
		lines.push("*Finished*")
		lines.push("")
		const branchSuffix = data.branchName ? ` on branch \`${data.branchName}\`` : ""
		lines.push(`Your agent finished${branchSuffix}.`)
	}

	if (lastAssistantMessage) {
		lines.push("")
		const quoted = lastAssistantMessage
			.split("\n")
			.map((line) => `> ${line}`)
			.join("\n")
		lines.push(quoted)
	}

	const links: string[] = []
	if (data.prUrl) {
		links.push(`<${data.prUrl}|View PR>`)
	}
	links.push(`<${viewUrl}|View in Cursor>`)

	lines.push("")
	lines.push(links.join(" \u00b7 "))

	return lines.join("\n")
}

function buildPhaseResultMessage(
	phase: string,
	nextPhaseLabel: string | undefined,
	agentUrl: string,
	lastAssistantMessage: string
): string {
	const label = phase.charAt(0).toUpperCase() + phase.slice(1)
	const lines: string[] = []

	lines.push(`*${label} complete*`)

	if (lastAssistantMessage) {
		lines.push("")
		const quoted = lastAssistantMessage
			.split("\n")
			.map((line) => `> ${line}`)
			.join("\n")
		lines.push(quoted)
	}

	lines.push("")
	lines.push(`<${agentUrl}|View in Cursor>`)

	if (nextPhaseLabel) {
		lines.push("")
		lines.push("Reply with feedback, or continue to the next phase.")
	}

	return lines.join("\n")
}

export { buildPhaseResultMessage, buildResultMessage }
export type { CompletionData }

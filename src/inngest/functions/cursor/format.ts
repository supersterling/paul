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

export { buildResultMessage }
export type { CompletionData }

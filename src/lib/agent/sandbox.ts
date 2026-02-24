import * as errors from "@superbuilders/errors"
import { Sandbox } from "@vercel/sandbox"
import { NonRetriableError } from "inngest"

type InngestLogger = {
	info: (message: string, context?: Record<string, unknown>) => void
	error: (message: string, context?: Record<string, unknown>) => void
}

async function connectSandbox(sandboxId: string, logger: InngestLogger): Promise<Sandbox> {
	const result = await errors.try(Sandbox.get({ sandboxId }))
	if (result.error) {
		logger.error("sandbox connection failed", {
			error: result.error,
			sandboxId
		})
		throw new NonRetriableError(`sandbox connection failed: ${String(result.error)}`)
	}
	const sbx = result.data
	if (sbx.status !== "running" && sbx.status !== "pending") {
		logger.error("sandbox not usable", { sandboxId, status: sbx.status })
		throw new NonRetriableError(`sandbox not usable: status is '${sbx.status}'`)
	}
	logger.info("sandbox connected", { sandboxId: sbx.sandboxId, status: sbx.status })
	return sbx
}

export { connectSandbox }
export type { InngestLogger }

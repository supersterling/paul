import type { Attachment } from "chat"
import * as errors from "@superbuilders/errors"
import * as logger from "@superbuilders/slog"

const MAX_IMAGES = 5

type CursorImage = {
	data: string
	dimension?: {
		width: number
		height: number
	}
}

type ExtractionResult = {
	images: CursorImage[]
	warnings: string[]
}

async function extractImages(attachments: Attachment[]): Promise<ExtractionResult> {
	const images: CursorImage[] = []
	const warnings: string[] = []

	const imageAttachments: Attachment[] = []
	const nonImageAttachments: Attachment[] = []

	for (const attachment of attachments) {
		if (attachment.type === "image") {
			imageAttachments.push(attachment)
		} else {
			nonImageAttachments.push(attachment)
		}
	}

	if (nonImageAttachments.length > 0) {
		const types = [...new Set(nonImageAttachments.map((a) => a.type))]
		warnings.push(
			`Skipped ${nonImageAttachments.length} non-image attachment(s) (${types.join(", ")}). Cursor only supports images.`
		)
	}

	const capped = imageAttachments.slice(0, MAX_IMAGES)
	if (imageAttachments.length > MAX_IMAGES) {
		warnings.push(
			`Forwarded ${MAX_IMAGES} of ${imageAttachments.length} images (Cursor limit is ${MAX_IMAGES}).`
		)
	}

	for (const attachment of capped) {
		if (!attachment.fetchData) {
			logger.warn("image attachment missing fetchData", { name: attachment.name })
			warnings.push(`Could not fetch image "${attachment.name}" (no download method available).`)
			continue
		}

		const fetchResult = await errors.try(attachment.fetchData())
		if (fetchResult.error) {
			logger.error("failed to fetch image attachment", {
				error: fetchResult.error,
				name: attachment.name
			})
			warnings.push(`Failed to download image "${attachment.name}".`)
			continue
		}

		const base64 = fetchResult.data.toString("base64")
		const dimension =
			attachment.width && attachment.height
				? { width: attachment.width, height: attachment.height }
				: undefined

		images.push({ data: base64, dimension })
	}

	logger.debug("image extraction complete", {
		total: attachments.length,
		extracted: images.length,
		warningCount: warnings.length
	})

	return { images, warnings }
}

export { extractImages }
export type { CursorImage, ExtractionResult }

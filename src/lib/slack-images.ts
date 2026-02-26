import { extname } from "node:path"
import * as errors from "@superbuilders/errors"
import * as logger from "@superbuilders/slog"
import type { Attachment } from "chat"
import { z } from "zod"

const MAX_IMAGES = 5
const MAX_FILES = 10
const MAX_FILE_SIZE = 100 * 1024

const CursorImageSchema = z.object({
	data: z.string().min(1),
	dimension: z
		.object({
			width: z.number(),
			height: z.number()
		})
		.optional()
})

type CursorImage = z.infer<typeof CursorImageSchema>

const CursorImageArraySchema = z.array(CursorImageSchema)

const TEXT_MIME_TYPES = new Set([
	"application/json",
	"application/xml",
	"application/javascript",
	"application/typescript",
	"application/x-yaml",
	"application/yaml",
	"application/toml",
	"application/x-sh",
	"application/sql",
	"application/graphql",
	"application/ld+json",
	"application/xhtml+xml"
])

const TEXT_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".py",
	".rb",
	".go",
	".rs",
	".java",
	".c",
	".cpp",
	".h",
	".hpp",
	".cs",
	".css",
	".scss",
	".less",
	".html",
	".htm",
	".svg",
	".json",
	".xml",
	".yaml",
	".yml",
	".toml",
	".ini",
	".cfg",
	".conf",
	".md",
	".mdx",
	".txt",
	".csv",
	".tsv",
	".log",
	".sql",
	".graphql",
	".gql",
	".sh",
	".bash",
	".zsh",
	".fish",
	".env",
	".gitignore",
	".dockerignore",
	".prisma",
	".proto",
	".tf",
	".hcl",
	".vue",
	".svelte",
	".astro",
	".swift",
	".kt",
	".scala",
	".r",
	".jl",
	".lua",
	".zig",
	".ex",
	".exs",
	".dockerfile"
])

function isTextReadable(attachment: Attachment): boolean {
	if (attachment.mimeType) {
		if (attachment.mimeType.startsWith("text/")) return true
		if (TEXT_MIME_TYPES.has(attachment.mimeType)) return true
	}
	if (attachment.name) {
		const ext = extname(attachment.name).toLowerCase()
		if (TEXT_EXTENSIONS.has(ext)) return true
	}
	return false
}

type FileContent = {
	name: string
	content: string
}

type PartitionedAttachments = {
	images: Attachment[]
	textFiles: Attachment[]
	unsupported: Attachment[]
}

type AttachmentExtractionResult = {
	images: CursorImage[]
	fileContents: string
	warnings: string[]
}

function partitionAttachments(attachments: Attachment[]): PartitionedAttachments {
	const images: Attachment[] = []
	const textFiles: Attachment[] = []
	const unsupported: Attachment[] = []

	for (const attachment of attachments) {
		if (attachment.type === "image") {
			images.push(attachment)
		} else if (isTextReadable(attachment)) {
			textFiles.push(attachment)
		} else {
			unsupported.push(attachment)
		}
	}

	return { images, textFiles, unsupported }
}

async function fetchImageData(
	attachments: Attachment[],
	warnings: string[]
): Promise<CursorImage[]> {
	const images: CursorImage[] = []
	const capped = attachments.slice(0, MAX_IMAGES)

	if (attachments.length > MAX_IMAGES) {
		warnings.push(
			`Forwarded ${MAX_IMAGES} of ${attachments.length} images (Cursor limit is ${MAX_IMAGES}).`
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

	return images
}

async function fetchTextFileData(
	attachments: Attachment[],
	warnings: string[]
): Promise<FileContent[]> {
	const files: FileContent[] = []
	const capped = attachments.slice(0, MAX_FILES)

	if (attachments.length > MAX_FILES) {
		warnings.push(
			`Included ${MAX_FILES} of ${attachments.length} text files (limit is ${MAX_FILES}).`
		)
	}

	for (const attachment of capped) {
		const fileName = attachment.name ? attachment.name : "unnamed-file"

		if (!attachment.fetchData) {
			logger.warn("file attachment missing fetchData", { name: fileName })
			warnings.push(`Could not fetch file "${fileName}" (no download method available).`)
			continue
		}

		if (attachment.size !== undefined && attachment.size > MAX_FILE_SIZE) {
			logger.debug("file too large, skipping", { name: fileName, size: attachment.size })
			warnings.push(
				`Skipped "${fileName}" (${Math.round(attachment.size / 1024)}KB exceeds ${MAX_FILE_SIZE / 1024}KB limit).`
			)
			continue
		}

		const fetchResult = await errors.try(attachment.fetchData())
		if (fetchResult.error) {
			logger.error("failed to fetch file attachment", {
				error: fetchResult.error,
				name: fileName
			})
			warnings.push(`Failed to download file "${fileName}".`)
			continue
		}

		const buffer = fetchResult.data
		if (buffer.length > MAX_FILE_SIZE) {
			logger.debug("fetched file too large", { name: fileName, size: buffer.length })
			warnings.push(
				`Skipped "${fileName}" (${Math.round(buffer.length / 1024)}KB exceeds ${MAX_FILE_SIZE / 1024}KB limit).`
			)
			continue
		}

		files.push({ name: fileName, content: buffer.toString("utf-8") })
	}

	return files
}

async function extractAttachments(attachments: Attachment[]): Promise<AttachmentExtractionResult> {
	const warnings: string[] = []
	const { images: imageAttachments, textFiles, unsupported } = partitionAttachments(attachments)

	if (unsupported.length > 0) {
		const names = unsupported.map((a) => a.name).filter(Boolean)
		const nameList = names.length > 0 ? `: ${names.join(", ")}` : ""
		warnings.push(
			`Skipped ${unsupported.length} unsupported attachment(s)${nameList}. Only images and text files are supported.`
		)
	}

	const images = await fetchImageData(imageAttachments, warnings)
	const files = await fetchTextFileData(textFiles, warnings)

	logger.debug("attachment extraction complete", {
		total: attachments.length,
		images: images.length,
		files: files.length,
		warningCount: warnings.length
	})

	return { images, fileContents: formatFileContents(files), warnings }
}

function formatFileContents(files: FileContent[]): string {
	if (files.length === 0) return ""
	return files
		.map((f) => `<attached-file name="${f.name}">\n${f.content}\n</attached-file>`)
		.join("\n\n")
}

function parseCursorImages(raw: unknown): CursorImage[] {
	const result = CursorImageArraySchema.safeParse(raw)
	if (!result.success) {
		logger.warn("invalid cursor images data", { error: result.error })
		return []
	}
	return result.data
}

export { CursorImageArraySchema, CursorImageSchema, extractAttachments, parseCursorImages }
export type { AttachmentExtractionResult, CursorImage }

"use client"

import {
	BoldIcon,
	CodeIcon,
	EyeIcon,
	Heading2Icon,
	ItalicIcon,
	LinkIcon,
	ListIcon,
	PencilIcon
} from "lucide-react"
import * as React from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

type MarkdownEditorProps = {
	value: string
	onChange: (value: string) => void
	onSave?: () => void
	isDirty?: boolean
	isSaving?: boolean
	isSuccess?: boolean
	placeholder?: string
	readOnly?: boolean
}

type SelectionResult = {
	value: string
	selectionStart: number
	selectionEnd: number
}

function computeWrappedText(
	text: string,
	selStart: number,
	selEnd: number,
	before: string,
	after: string,
	placeholder: string
): SelectionResult {
	const selected = text.slice(selStart, selEnd)
	const hasSelection = selected.length > 0
	const replacement = hasSelection
		? `${before}${selected}${after}`
		: `${before}${placeholder}${after}`
	const value = text.slice(0, selStart) + replacement + text.slice(selEnd)

	const newStart = selStart + before.length
	const newEnd = hasSelection
		? newStart + selected.length
		: newStart + placeholder.length

	return { value, selectionStart: newStart, selectionEnd: newEnd }
}

function useUndoHistory(value: string, onChange: (v: string) => void) {
	const historyRef = React.useRef<string[]>([value])
	const indexRef = React.useRef(0)
	const isUndoRedoRef = React.useRef(false)

	if (
		!isUndoRedoRef.current &&
		historyRef.current[indexRef.current] !== value
	) {
		const history = historyRef.current.slice(0, indexRef.current + 1)
		history.push(value)
		historyRef.current = history
		indexRef.current = history.length - 1
	}
	isUndoRedoRef.current = false

	function undo() {
		if (indexRef.current <= 0) return
		indexRef.current -= 1
		isUndoRedoRef.current = true
		onChange(historyRef.current[indexRef.current]!)
	}

	function redo() {
		if (indexRef.current >= historyRef.current.length - 1) return
		indexRef.current += 1
		isUndoRedoRef.current = true
		onChange(historyRef.current[indexRef.current]!)
	}

	return { undo, redo }
}

function MarkdownEditor(props: MarkdownEditorProps) {
	const [mode, setMode] = React.useState<"edit" | "preview">("edit")
	const textareaRef = React.useRef<HTMLTextAreaElement>(null)
	const { undo, redo } = useUndoHistory(props.value, props.onChange)

	function handleFormat(before: string, after: string, placeholder: string) {
		const textarea = textareaRef.current
		if (!textarea) return

		const result = computeWrappedText(
			textarea.value,
			textarea.selectionStart,
			textarea.selectionEnd,
			before,
			after,
			placeholder
		)

		props.onChange(result.value)

		requestAnimationFrame(() => {
			textarea.focus()
			textarea.setSelectionRange(result.selectionStart, result.selectionEnd)
		})
	}

	function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
		if (!e.metaKey && !e.ctrlKey) return

		if (e.key === "z" && e.shiftKey) {
			e.preventDefault()
			redo()
		} else if (e.key === "z") {
			e.preventDefault()
			undo()
		} else if (e.key === "b") {
			e.preventDefault()
			handleFormat("**", "**", "bold")
		} else if (e.key === "i") {
			e.preventDefault()
			handleFormat("_", "_", "italic")
		} else if (e.key === "e") {
			e.preventDefault()
			handleFormat("`", "`", "code")
		} else if (e.key === "s" && props.onSave) {
			e.preventDefault()
			props.onSave()
		}
	}

	if (props.readOnly) {
		return (
			<div
				data-slot="markdown-editor"
				data-mode="preview"
				className="rounded-lg border border-input opacity-90"
			>
				<div
					data-slot="markdown-editor-preview"
					className="markdown-preview min-h-20 px-2.5 py-2"
				>
					<Markdown remarkPlugins={[remarkGfm]}>{props.value}</Markdown>
				</div>
			</div>
		)
	}

	const isEdit = mode === "edit"
	const editVariant = isEdit ? "secondary" : "ghost"
	const previewVariant = isEdit ? "ghost" : "secondary"
	const dirtyAttr = props.isDirty ? true : undefined
	const successAttr = props.isSuccess ? true : undefined

	const editorArea = isEdit ? (
		<textarea
			ref={textareaRef}
			data-slot="markdown-editor-input"
			value={props.value}
			onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
				props.onChange(e.target.value)
			}}
			onKeyDown={handleKeyDown}
			placeholder={props.placeholder}
			className="field-sizing-content min-h-20 w-full bg-transparent px-2.5 py-2 font-mono text-xs outline-none placeholder:text-muted-foreground"
		/>
	) : (
		<div
			data-slot="markdown-editor-preview"
			className="markdown-preview min-h-20 px-2.5 py-2"
		>
			<Markdown remarkPlugins={[remarkGfm]}>{props.value}</Markdown>
		</div>
	)

	return (
		<div
			data-slot="markdown-editor"
			data-mode={mode}
			data-dirty={dirtyAttr}
			data-success={successAttr}
			className={cn(
				"rounded-lg border border-input transition-colors",
				"focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
				props.isDirty && "border-l-2 border-l-ring",
				props.isSuccess && "border-l-2 border-l-success"
			)}
		>
			<div
				data-slot="markdown-editor-toolbar"
				className="flex items-center gap-0.5 border-b border-input px-1 py-1"
			>
				<Button
					variant={editVariant}
					size="icon-xs"
					onClick={() => setMode("edit")}
					type="button"
				>
					<PencilIcon />
				</Button>
				<Button
					variant={previewVariant}
					size="icon-xs"
					onClick={() => setMode("preview")}
					type="button"
				>
					<EyeIcon />
				</Button>

				{isEdit && (
					<>
						<Separator orientation="vertical" className="mx-1 h-4" />
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={() => handleFormat("**", "**", "bold")}
							type="button"
						>
							<BoldIcon />
						</Button>
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={() => handleFormat("_", "_", "italic")}
							type="button"
						>
							<ItalicIcon />
						</Button>
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={() => handleFormat("`", "`", "code")}
							type="button"
						>
							<CodeIcon />
						</Button>
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={() => handleFormat("## ", "", "heading")}
							type="button"
						>
							<Heading2Icon />
						</Button>
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={() => handleFormat("- ", "", "item")}
							type="button"
						>
							<ListIcon />
						</Button>
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={() => handleFormat("[", "](url)", "link text")}
							type="button"
						>
							<LinkIcon />
						</Button>
					</>
				)}
			</div>

			{editorArea}
		</div>
	)
}

export { MarkdownEditor }
export type { MarkdownEditorProps }

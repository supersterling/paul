"use client"

import * as errors from "@superbuilders/errors"
import {
	ChevronDownIcon,
	ChevronRightIcon,
	CircleDotIcon,
	CopyIcon,
	EyeIcon,
	FileTextIcon,
	GripVerticalIcon,
	PlusIcon,
	RotateCcwIcon,
	Trash2Icon
} from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import {
	createUserOverride,
	createUserPhase,
	deleteUserOverride,
	deleteUserPhase,
	reorderPhaseSections,
	reorderUserPhases,
	updateUserOverride
} from "@/app/prompts/actions"
import type { BaseSection, UserOverride, UserPhase } from "@/app/prompts/page"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MarkdownEditor } from "@/components/ui/markdown-editor"
import { Separator } from "@/components/ui/separator"
import {
	Sortable,
	SortableContent,
	SortableItem,
	SortableItemHandle,
	SortableOverlay
} from "@/components/ui/sortable"
import { PHASE_ORDER } from "@/lib/prompt-constants"
import { cn } from "@/lib/utils"

type UserContext = {
	slackUserId: string | undefined
	overrides: UserOverride[]
	phases: UserPhase[]
}

type EffectiveSection = {
	phase: string
	header: string
	content: string
	position: number
	source: "default" | "customized" | "added"
	baseId: string | undefined
	overrideId: string | undefined
}

type SelectedItem =
	| { kind: "section"; phase: string; header: string }
	| { kind: "new-section"; phase: string }
	| { kind: "new-phase" }
	| null

type ReorderItem = {
	id: string
	header: string
	position: number
	table: "base" | "override"
}

type PhaseReorderItem = {
	id: string
	phase: string
}

const PHASE_COLOR_CYCLE = [
	{ text: "text-chart-1", bg: "bg-chart-1/10", border: "border-chart-1/20" },
	{ text: "text-chart-2", bg: "bg-chart-2/10", border: "border-chart-2/20" },
	{ text: "text-chart-3", bg: "bg-chart-3/10", border: "border-chart-3/20" },
	{ text: "text-chart-4", bg: "bg-chart-4/10", border: "border-chart-4/20" },
	{ text: "text-chart-5", bg: "bg-chart-5/10", border: "border-chart-5/20" }
]

function getPhaseColor(idx: number): { text: string; bg: string; border: string } {
	const color = PHASE_COLOR_CYCLE[idx % PHASE_COLOR_CYCLE.length]
	if (!color) return { text: "text-chart-1", bg: "bg-chart-1/10", border: "border-chart-1/20" }
	return color
}

function mergePhase(
	phase: string,
	phaseBase: BaseSection[],
	phaseOverrides: UserOverride[]
): EffectiveSection[] {
	const overrideMap = new Map<string, UserOverride>()
	const addedOverrides: UserOverride[] = []

	for (const o of phaseOverrides) {
		const matchesBase = phaseBase.some((b) => b.header === o.header)
		if (matchesBase) {
			overrideMap.set(o.header, o)
		} else {
			addedOverrides.push(o)
		}
	}

	const sections: EffectiveSection[] = []

	for (const base of phaseBase) {
		const override = overrideMap.get(base.header)
		if (override && override.content.length > 0) {
			sections.push({
				phase,
				header: base.header,
				content: override.content,
				position: override.position,
				source: "customized",
				baseId: base.id,
				overrideId: override.id
			})
		} else if (!override) {
			sections.push({
				phase,
				header: base.header,
				content: base.content,
				position: base.position,
				source: "default",
				baseId: base.id,
				overrideId: undefined
			})
		}
	}

	for (const added of addedOverrides) {
		if (added.content.length > 0) {
			sections.push({
				phase,
				header: added.header,
				content: added.content,
				position: added.position,
				source: "added",
				baseId: undefined,
				overrideId: added.id
			})
		}
	}

	sections.sort((a, b) => a.position - b.position)
	return sections
}

function computeEffectivePhases(userPhases: UserPhase[]): string[] {
	if (userPhases.length === 0) return PHASE_ORDER
	return userPhases.map((p) => p.phase)
}

function computeEffectiveSections(
	phaseOrder: string[],
	baseSections: BaseSection[],
	overrides: UserOverride[]
): Map<string, EffectiveSection[]> {
	const overridesByPhase = new Map<string, UserOverride[]>()
	for (const o of overrides) {
		const list = overridesByPhase.get(o.phase)
		if (list) {
			list.push(o)
		} else {
			overridesByPhase.set(o.phase, [o])
		}
	}

	const result = new Map<string, EffectiveSection[]>()
	for (const phase of phaseOrder) {
		const phaseBase = baseSections.filter((s) => s.phase === phase)
		const phaseOvr = overridesByPhase.get(phase)
		const ovr = phaseOvr ? phaseOvr : []
		result.set(phase, mergePhase(phase, phaseBase, ovr))
	}

	return result
}

const RESPONSE_STYLE_HEADER = "Response Style"
const RESPONSE_STYLE_CONTENT =
	"Keep responses under 10 lines. Be terse. The user will ask you to expand if needed. Do not produce wall-of-text responses."

function composePreview(
	effectivePhases: string[],
	effectiveByPhase: Map<string, EffectiveSection[]>
): string {
	const blocks: string[] = []

	blocks.push(`# ${RESPONSE_STYLE_HEADER}\n\n${RESPONSE_STYLE_CONTENT}`)

	for (const phase of effectivePhases) {
		const sections = effectiveByPhase.get(phase)
		if (!sections) continue
		for (const section of sections) {
			blocks.push(`# ${section.header}\n\n${section.content}`)
		}
	}

	blocks.push("# Feature Request\n\n[Your feature request will appear here]")

	return blocks.join("\n\n---\n\n")
}

async function performDelete(section: EffectiveSection, slackUserId: string): Promise<boolean> {
	if (section.source === "default") {
		const result = await errors.try(
			createUserOverride({
				slackUserId,
				phase: section.phase,
				header: section.header,
				content: "",
				position: section.position
			})
		)
		if (result.error) return false
		return true
	}

	if (!section.overrideId) return false

	const result = await errors.try(deleteUserOverride({ id: section.overrideId }))
	if (result.error) return false
	return true
}

function Content(props: {
	baseSectionsPromise: Promise<BaseSection[]>
	userContextPromise: Promise<UserContext>
}) {
	const baseSections = React.use(props.baseSectionsPromise)
	const userContext = React.use(props.userContextPromise)

	const [selected, setSelected] = React.useState<SelectedItem>(null)
	const [editBuffers, setEditBuffers] = React.useState<Record<string, string>>({})
	const [savingIds, setSavingIds] = React.useState<Set<string>>(new Set())
	const [successIds, setSuccessIds] = React.useState<Set<string>>(new Set())
	const [expandedPhases, setExpandedPhases] = React.useState<Set<string>>(() => new Set())

	const [newHeader, setNewHeader] = React.useState("")
	const [newContent, setNewContent] = React.useState("")
	const [newPosition, setNewPosition] = React.useState("100")
	const [creating, setCreating] = React.useState(false)

	const [newPhaseName, setNewPhaseName] = React.useState("")
	const [creatingPhase, setCreatingPhase] = React.useState(false)

	const [deleteTarget, setDeleteTarget] = React.useState<
		| { kind: "section"; section: EffectiveSection }
		| { kind: "phase"; phase: string }
		| null
	>(null)
	const [previewOpen, setPreviewOpen] = React.useState(false)

	const effectivePhases = computeEffectivePhases(userContext.phases)

	const initialExpandRef = React.useRef(false)
	if (!initialExpandRef.current) {
		for (const phase of effectivePhases) {
			expandedPhases.add(phase)
		}
		initialExpandRef.current = true
	}

	const effectiveByPhase = computeEffectiveSections(
		effectivePhases,
		baseSections,
		userContext.overrides
	)
	const hasSlack = !!userContext.slackUserId

	function findSelected(): EffectiveSection | undefined {
		if (!selected) return undefined
		if (selected.kind !== "section") return undefined
		const sections = effectiveByPhase.get(selected.phase)
		if (!sections) return undefined
		return sections.find((s) => s.header === selected.header)
	}

	function bufferKey(section: EffectiveSection): string {
		if (section.overrideId) return section.overrideId
		if (section.baseId) return `base:${section.baseId}`
		return `${section.phase}:${section.header}`
	}

	function flashSuccess(key: string) {
		setSuccessIds((prev) => new Set(prev).add(key))
		setTimeout(() => {
			setSuccessIds((prev) => {
				const next = new Set(prev)
				next.delete(key)
				return next
			})
		}, 2000)
	}

	async function handleSave(section: EffectiveSection) {
		if (!userContext.slackUserId) return
		const bk = bufferKey(section)
		const content = editBuffers[bk]
		if (content === undefined) return
		if (content === section.content) return

		setSavingIds((prev) => new Set(prev).add(bk))

		if (section.overrideId) {
			const result = await errors.try(updateUserOverride({ id: section.overrideId, content }))
			setSavingIds((prev) => {
				const next = new Set(prev)
				next.delete(bk)
				return next
			})
			if (result.error) {
				toast.error("Failed to save section")
				return
			}
		} else {
			const result = await errors.try(
				createUserOverride({
					slackUserId: userContext.slackUserId,
					phase: section.phase,
					header: section.header,
					content,
					position: section.position
				})
			)
			setSavingIds((prev) => {
				const next = new Set(prev)
				next.delete(bk)
				return next
			})
			if (result.error) {
				toast.error("Failed to save section")
				return
			}
		}

		setEditBuffers((prev) => {
			const next = { ...prev }
			delete next[bk]
			return next
		})
		flashSuccess(bk)
		toast.success(`Saved "${section.header}"`)
	}

	async function handleDeleteSection(section: EffectiveSection) {
		if (!userContext.slackUserId) return
		const bk = bufferKey(section)
		setSavingIds((prev) => new Set(prev).add(bk))

		const deleteResult = await performDelete(section, userContext.slackUserId)
		setSavingIds((prev) => {
			const next = new Set(prev)
			next.delete(bk)
			return next
		})
		if (!deleteResult) {
			toast.error("Failed to delete section")
			return
		}

		if (selected && selected.kind === "section" && selected.header === section.header) {
			setSelected(null)
		}
		setEditBuffers((prev) => {
			const next = { ...prev }
			delete next[bk]
			return next
		})
		toast.success(`Deleted "${section.header}"`)
	}

	async function handleResetToDefault(section: EffectiveSection) {
		if (!section.overrideId) return
		if (section.source !== "customized") return

		const bk = bufferKey(section)
		setSavingIds((prev) => new Set(prev).add(bk))

		const result = await errors.try(deleteUserOverride({ id: section.overrideId }))
		setSavingIds((prev) => {
			const next = new Set(prev)
			next.delete(bk)
			return next
		})
		if (result.error) {
			toast.error("Failed to reset section")
			return
		}

		setEditBuffers((prev) => {
			const next = { ...prev }
			delete next[bk]
			return next
		})
		toast.success(`Reset "${section.header}" to default`)
	}

	async function handleCreateSection() {
		if (!userContext.slackUserId) return
		if (!selected) return
		if (selected.kind !== "new-section") return
		if (!newHeader) return
		if (!newContent) return

		setCreating(true)
		const result = await errors.try(
			createUserOverride({
				slackUserId: userContext.slackUserId,
				phase: selected.phase,
				header: newHeader,
				content: newContent,
				position: Number.parseInt(newPosition, 10)
			})
		)
		setCreating(false)
		if (result.error) {
			toast.error("Failed to create section")
			return
		}

		toast.success(`Created "${newHeader}"`)
		setSelected({ kind: "section", phase: selected.phase, header: newHeader })
		setNewHeader("")
		setNewContent("")
		setNewPosition("100")
	}

	async function handleCreatePhase() {
		if (!userContext.slackUserId) return
		if (!newPhaseName) return

		setCreatingPhase(true)
		const result = await errors.try(
			createUserPhase({
				slackUserId: userContext.slackUserId,
				phase: newPhaseName
			})
		)
		setCreatingPhase(false)
		if (result.error) {
			toast.error("Failed to create phase")
			return
		}

		toast.success(`Created phase "${newPhaseName}"`)
		setExpandedPhases((prev) => new Set(prev).add(newPhaseName))
		setNewPhaseName("")
		setSelected(null)
	}

	async function handleDeletePhase(phase: string) {
		if (!userContext.slackUserId) return

		const result = await errors.try(
			deleteUserPhase({ slackUserId: userContext.slackUserId, phase })
		)
		if (result.error) {
			toast.error("Failed to delete phase")
			return
		}

		toast.success(`Deleted phase "${phase}"`)
		if (selected && selected.kind !== "new-phase" && selected.phase === phase) {
			setSelected(null)
		}
	}

	async function handleReorderPhases(newItems: PhaseReorderItem[]) {
		if (!userContext.slackUserId) return
		const phases = newItems.map((item) => item.phase)
		const result = await errors.try(
			reorderUserPhases({ slackUserId: userContext.slackUserId, phases })
		)
		if (result.error) return
	}

	const selectedPhase = selected && selected.kind !== "new-phase" ? selected.phase : undefined

	function computeReorderItems(): ReorderItem[] {
		if (!selectedPhase) return []
		const sections = effectiveByPhase.get(selectedPhase)
		if (!sections) return []

		return sections.map((s) => {
			const id = s.overrideId ? s.overrideId : s.baseId
			if (!id) return { id: "", header: s.header, position: s.position, table: "base" as const }
			const table = s.overrideId ? ("override" as const) : ("base" as const)
			return { id, header: s.header, position: s.position, table }
		})
	}

	async function handleReorderSections(newItems: ReorderItem[]) {
		const payload = newItems.map((item) => ({ id: item.id, table: item.table }))
		const result = await errors.try(reorderPhaseSections({ items: payload }))
		if (result.error) return
	}

	const currentSection = findSelected()
	const hasMaterializedPhases = userContext.phases.length > 0

	const phaseReorderItems: PhaseReorderItem[] = effectivePhases.map((phase, idx) => {
		if (!hasMaterializedPhases) {
			return { id: `default-${idx}`, phase }
		}
		const userPhase = userContext.phases.find((p) => p.phase === phase)
		if (!userPhase) {
			return { id: `default-${idx}`, phase }
		}
		return { id: userPhase.id, phase }
	})

	return (
		<div data-slot="prompt-editor" className="flex h-full">
			<div className="flex w-72 shrink-0 flex-col border-r">
				<div className="flex-1 overflow-y-auto p-3">
					{hasMaterializedPhases ? (
						<Sortable
							value={phaseReorderItems}
							onValueChange={handleReorderPhases}
							getItemValue={(item) => item.id}
							orientation="vertical"
						>
							<SortableContent className="space-y-1">
								{phaseReorderItems.map((item, idx) => {
									const phase = item.phase
									const isExpanded = expandedPhases.has(phase)
									const sections = effectiveByPhase.get(phase)
									const colors = getPhaseColor(idx)

									return (
										<SortableItem key={item.id} value={item.id} className="rounded" asChild>
											<div>
												<PhaseFolder
													phase={phase}
													isExpanded={isExpanded}
													colors={colors}
													hasSlack={hasSlack}
													dragHandle={
														<SortableItemHandle className="shrink-0 text-muted-foreground">
															<GripVerticalIcon className="size-3" />
														</SortableItemHandle>
													}
													onToggle={() => {
														setExpandedPhases((prev) => {
															const next = new Set(prev)
															if (next.has(phase)) {
																next.delete(phase)
															} else {
																next.add(phase)
															}
															return next
														})
													}}
													onAddSection={() => {
														setNewHeader("")
														setNewContent("")
														setNewPosition("100")
														setSelected({
															kind: "new-section",
															phase
														})
													}}
													onDeletePhase={() => setDeleteTarget({ kind: "phase", phase })}
												>
													{sections?.map((section) => {
														const isSelected =
															selected?.kind === "section" &&
															selected.phase === phase &&
															selected.header === section.header
														return (
															<SectionTreeItem
																key={`${section.phase}:${section.header}`}
																header={section.header}
																source={section.source}
																isSelected={isSelected}
																onClick={() =>
																	setSelected({
																		kind: "section",
																		phase: section.phase,
																		header: section.header
																	})
																}
															/>
														)
													})}
												</PhaseFolder>
											</div>
										</SortableItem>
									)
								})}
							</SortableContent>
							<SortableOverlay />
						</Sortable>
					) : (
						<div className="space-y-1">
							{effectivePhases.map((phase, idx) => {
								const isExpanded = expandedPhases.has(phase)
								const sections = effectiveByPhase.get(phase)
								const colors = getPhaseColor(idx)

								return (
									<PhaseFolder
										key={phase}
										phase={phase}
										isExpanded={isExpanded}
										colors={colors}
										hasSlack={hasSlack}
										onToggle={() => {
											setExpandedPhases((prev) => {
												const next = new Set(prev)
												if (next.has(phase)) {
													next.delete(phase)
												} else {
													next.add(phase)
												}
												return next
											})
										}}
										onAddSection={() => {
											setNewHeader("")
											setNewContent("")
											setNewPosition("100")
											setSelected({ kind: "new-section", phase })
										}}
										onDeletePhase={() => setDeleteTarget({ kind: "phase", phase })}
									>
										{sections?.map((section) => {
											const isSelected =
												selected?.kind === "section" &&
												selected.phase === phase &&
												selected.header === section.header
											return (
												<SectionTreeItem
													key={`${section.phase}:${section.header}`}
													header={section.header}
													source={section.source}
													isSelected={isSelected}
													onClick={() =>
														setSelected({
															kind: "section",
															phase: section.phase,
															header: section.header
														})
													}
												/>
											)
										})}
									</PhaseFolder>
								)
							})}
						</div>
					)}

					{hasSlack && (
						<button
							type="button"
							onClick={() => {
								setNewPhaseName("")
								setSelected({ kind: "new-phase" })
							}}
							className="mt-3 flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-muted-foreground text-xs hover:bg-accent hover:text-foreground"
						>
							<PlusIcon className="size-3.5" />
							Add phase
						</button>
					)}

					<button
						type="button"
						onClick={() => setPreviewOpen(true)}
						className="mt-1 flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-muted-foreground text-xs hover:bg-accent hover:text-foreground"
					>
						<EyeIcon className="size-3.5" />
						Preview full prompt
					</button>

					{!hasSlack && (
						<p className="mt-4 px-2 text-muted-foreground text-xs">
							Link Slack to create and edit sections.
						</p>
					)}
				</div>

				<ReorderPanel
					phase={selectedPhase}
					sections={computeReorderItems()}
					onReorder={handleReorderSections}
				/>
			</div>

			<div className="flex flex-1 flex-col overflow-hidden">
				{selected?.kind === "new-phase" ? (
					<NewPhaseForm
						name={newPhaseName}
						creating={creatingPhase}
						onNameChange={setNewPhaseName}
						onCreate={handleCreatePhase}
					/>
				) : (
					<EditorPanel
						selected={selected}
						section={currentSection}
						editBuffers={editBuffers}
						savingIds={savingIds}
						successIds={successIds}
						hasSlack={hasSlack}
						onBufferChange={(key, v) => setEditBuffers((prev) => ({ ...prev, [key]: v }))}
						bufferKey={currentSection ? bufferKey(currentSection) : undefined}
						onSave={handleSave}
						onDelete={(section) => setDeleteTarget({ kind: "section", section })}
						onResetToDefault={handleResetToDefault}
						newHeader={newHeader}
						newContent={newContent}
						newPosition={newPosition}
						creating={creating}
						onNewHeaderChange={setNewHeader}
						onNewContentChange={setNewContent}
						onNewPositionChange={setNewPosition}
						onCreateSection={handleCreateSection}
					/>
				)}
			</div>

			<PromptPreviewDialog
				open={previewOpen}
				onOpenChange={setPreviewOpen}
				effectivePhases={effectivePhases}
				effectiveByPhase={effectiveByPhase}
			/>

			<DeleteConfirmDialog
				target={deleteTarget}
				onCancel={() => setDeleteTarget(null)}
				onConfirm={async () => {
					if (!deleteTarget) return
					if (deleteTarget.kind === "section") {
						await handleDeleteSection(deleteTarget.section)
					} else {
						await handleDeletePhase(deleteTarget.phase)
					}
					setDeleteTarget(null)
				}}
			/>
		</div>
	)
}

function PromptPreviewDialog(props: {
	open: boolean
	onOpenChange: (open: boolean) => void
	effectivePhases: string[]
	effectiveByPhase: Map<string, EffectiveSection[]>
}) {
	const preview = composePreview(props.effectivePhases, props.effectiveByPhase)

	function handleCopy() {
		navigator.clipboard.writeText(preview)
		toast.success("Copied prompt to clipboard")
	}

	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
				<DialogHeader>
					<DialogTitle>Prompt Preview</DialogTitle>
					<DialogDescription>
						This is the full prompt that will be sent to Cursor when an agent is launched.
					</DialogDescription>
				</DialogHeader>
				<div className="flex-1 overflow-y-auto rounded-md border bg-muted/30 p-4">
					<pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground/90">
						{preview}
					</pre>
				</div>
				<DialogFooter>
					<Button variant="outline" size="sm" onClick={handleCopy}>
						<CopyIcon className="mr-1.5 size-3.5" />
						Copy
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

function DeleteConfirmDialog(props: {
	target:
		| { kind: "section"; section: EffectiveSection }
		| { kind: "phase"; phase: string }
		| null
	onCancel: () => void
	onConfirm: () => void
}) {
	const isOpen = props.target !== null

	const title = props.target?.kind === "phase" ? "Delete phase?" : "Delete section?"
	const description =
		props.target?.kind === "phase"
			? `This will remove the "${props.target.phase}" phase and all its custom sections.`
			: props.target?.kind === "section"
				? `This will delete "${props.target.section.header}" from your overrides.`
				: ""

	return (
		<AlertDialog open={isOpen} onOpenChange={(open) => { if (!open) props.onCancel() }}>
			<AlertDialogContent size="sm">
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction variant="destructive" onClick={props.onConfirm}>
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}

function PhaseFolder(props: {
	phase: string
	isExpanded: boolean
	colors: { text: string; bg: string; border: string }
	hasSlack: boolean
	dragHandle?: React.ReactNode
	onToggle: () => void
	onAddSection: () => void
	onDeletePhase?: () => void
	children: React.ReactNode
}) {
	const chevronIcon = props.isExpanded ? (
		<ChevronDownIcon className="size-3.5" />
	) : (
		<ChevronRightIcon className="size-3.5" />
	)

	const badgeClasses = cn(props.colors.text, props.colors.bg, props.colors.border)

	return (
		<div data-slot="phase-folder">
			<div className="flex items-center gap-0.5">
				{props.dragHandle}
				<button
					type="button"
					onClick={props.onToggle}
					className="flex flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm hover:bg-accent"
				>
					{chevronIcon}
					<Badge
						variant="outline"
						className={cn("font-semibold text-[10px] uppercase", badgeClasses)}
					>
						{props.phase}
					</Badge>
				</button>
				{props.hasSlack && (
					<div className="flex items-center">
						<button
							type="button"
							onClick={props.onAddSection}
							className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
						>
							<PlusIcon className="size-3.5" />
						</button>
						{props.onDeletePhase && (
							<button
								type="button"
								onClick={props.onDeletePhase}
								className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
							>
								<Trash2Icon className="size-3" />
							</button>
						)}
					</div>
				)}
			</div>
			{props.isExpanded && <div className="ml-3 border-l pl-2">{props.children}</div>}
		</div>
	)
}

function SectionTreeItem(props: {
	header: string
	source: "default" | "customized" | "added"
	isSelected: boolean
	onClick: () => void
}) {
	const isModified = props.source !== "default"

	return (
		<button
			type="button"
			onClick={props.onClick}
			className={cn(
				"flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs",
				props.isSelected
					? "bg-accent font-medium text-accent-foreground"
					: "text-foreground/80 hover:bg-accent/50"
			)}
		>
			{isModified && <CircleDotIcon className="size-2.5 shrink-0 text-chart-2" />}
			<span className={cn("truncate", !isModified && "pl-[14px]")}>{props.header}</span>
		</button>
	)
}

function ReorderPanel(props: {
	phase: string | undefined
	sections: ReorderItem[]
	onReorder: (items: ReorderItem[]) => void
}) {
	if (!props.phase) return null
	if (props.sections.length === 0) return null

	return (
		<>
			<Separator />
			<div className="p-3">
				<p className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
					Reorder sections
				</p>
				<Sortable
					value={props.sections}
					onValueChange={props.onReorder}
					getItemValue={(item) => item.id}
					orientation="vertical"
				>
					<SortableContent className="space-y-0.5">
						{props.sections.map((section) => (
							<SortableItem
								key={section.id}
								value={section.id}
								className="flex items-center gap-1 rounded border border-transparent px-1 py-0.5 text-xs data-dragging:border-border data-dragging:bg-accent"
							>
								<SortableItemHandle className="shrink-0 text-muted-foreground">
									<GripVerticalIcon className="size-3" />
								</SortableItemHandle>
								<span className="truncate text-foreground/80">{section.header}</span>
							</SortableItem>
						))}
					</SortableContent>
					<SortableOverlay />
				</Sortable>
			</div>
		</>
	)
}

function EditorPanel(props: {
	selected: SelectedItem
	section: EffectiveSection | undefined
	editBuffers: Record<string, string>
	savingIds: Set<string>
	successIds: Set<string>
	hasSlack: boolean
	onBufferChange: (key: string, value: string) => void
	bufferKey: string | undefined
	onSave: (section: EffectiveSection) => void
	onDelete: (section: EffectiveSection) => void
	onResetToDefault: (section: EffectiveSection) => void
	newHeader: string
	newContent: string
	newPosition: string
	creating: boolean
	onNewHeaderChange: (v: string) => void
	onNewContentChange: (v: string) => void
	onNewPositionChange: (v: string) => void
	onCreateSection: () => void
}) {
	if (!props.selected) {
		return <EmptyState />
	}

	if (props.selected.kind === "new-phase") {
		return <EmptyState />
	}

	if (props.selected.kind === "new-section") {
		return (
			<NewSectionForm
				phase={props.selected.phase}
				header={props.newHeader}
				content={props.newContent}
				position={props.newPosition}
				creating={props.creating}
				onHeaderChange={props.onNewHeaderChange}
				onContentChange={props.onNewContentChange}
				onPositionChange={props.onNewPositionChange}
				onCreate={props.onCreateSection}
			/>
		)
	}

	const section = props.section
	if (!section) return <EmptyState />

	const bk = props.bufferKey
	if (!bk) return <EmptyState />

	const buffered = props.editBuffers[bk]
	const currentContent = buffered !== undefined ? buffered : section.content
	const isDirty = buffered !== undefined && buffered !== section.content
	const isSaving = props.savingIds.has(bk)
	const isSuccess = props.successIds.has(bk)

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<EditorHeader
				section={section}
				isDirty={isDirty}
				isSaving={isSaving}
				isSuccess={isSuccess}
				hasSlack={props.hasSlack}
				onSave={() => props.onSave(section)}
				onDelete={() => props.onDelete(section)}
				onResetToDefault={
					section.source === "customized" ? () => props.onResetToDefault(section) : undefined
				}
			/>
			<div className="flex-1 overflow-y-auto p-4">
				<MarkdownEditor
					value={currentContent}
					onChange={(v: string) => props.onBufferChange(bk, v)}
					onSave={() => props.onSave(section)}
					isDirty={isDirty}
					isSaving={isSaving}
					isSuccess={isSuccess}
					readOnly={!props.hasSlack}
				/>
			</div>
		</div>
	)
}

function EditorHeader(props: {
	section: EffectiveSection
	isDirty: boolean
	isSaving: boolean
	isSuccess: boolean
	hasSlack: boolean
	onSave: () => void
	onDelete: () => void
	onResetToDefault: (() => void) | undefined
}) {
	const sourceLabel =
		props.section.source === "default"
			? "Default"
			: props.section.source === "customized"
				? "Modified"
				: "Custom"

	const saveLabel = props.isSaving ? "Saving..." : props.isSuccess ? "Saved" : "Save"
	const saveDisabled = props.isSaving ? true : !props.isDirty

	return (
		<div className="flex items-center gap-3 border-b px-4 py-3">
			<Badge variant="outline" className="font-semibold text-[10px] uppercase">
				{props.section.phase}
			</Badge>
			{props.section.source !== "default" && (
				<span className="font-medium text-[10px] text-chart-2 uppercase">{sourceLabel}</span>
			)}
			<h2 className="flex-1 font-semibold text-sm">{props.section.header}</h2>
			{props.hasSlack && (
				<div className="flex items-center gap-2">
					{props.onResetToDefault && (
						<Button
							size="sm"
							variant="ghost"
							onClick={props.onResetToDefault}
							disabled={props.isSaving}
						>
							<RotateCcwIcon className="mr-1 size-3" />
							Reset
						</Button>
					)}
					<Button size="sm" onClick={props.onSave} disabled={saveDisabled}>
						{saveLabel}
					</Button>
					<Button
						size="sm"
						variant="destructive"
						onClick={props.onDelete}
						disabled={props.isSaving}
					>
						<Trash2Icon className="size-3.5" />
					</Button>
				</div>
			)}
		</div>
	)
}

function EmptyState() {
	return (
		<div className="flex flex-1 items-center justify-center text-muted-foreground">
			<div className="text-center">
				<FileTextIcon className="mx-auto mb-2 size-8 opacity-40" />
				<p className="text-sm">Select a section to view or edit</p>
			</div>
		</div>
	)
}

function NewPhaseForm(props: {
	name: string
	creating: boolean
	onNameChange: (v: string) => void
	onCreate: () => void
}) {
	const isReady = props.name && !props.creating

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<div className="flex items-center gap-3 border-b px-4 py-3">
				<h2 className="flex-1 font-semibold text-sm">New Phase</h2>
				<Button size="sm" onClick={props.onCreate} disabled={!isReady}>
					{props.creating ? "Creating..." : "Create"}
				</Button>
			</div>
			<div className="space-y-4 p-4">
				<div className="space-y-1.5">
					<Label>Phase name</Label>
					<Input
						value={props.name}
						onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
							props.onNameChange(e.target.value)
						}
						placeholder="e.g. testing, deploy, qa"
					/>
				</div>
				<p className="text-muted-foreground text-xs">
					Create a new phase grouping. You can add sections to it after creation.
				</p>
			</div>
		</div>
	)
}

function NewSectionForm(props: {
	phase: string
	header: string
	content: string
	position: string
	creating: boolean
	onHeaderChange: (v: string) => void
	onContentChange: (v: string) => void
	onPositionChange: (v: string) => void
	onCreate: () => void
}) {
	const isReady = props.header && props.content && !props.creating

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<div className="flex items-center gap-3 border-b px-4 py-3">
				<Badge variant="outline" className="font-semibold text-[10px] uppercase">
					{props.phase}
				</Badge>
				<h2 className="flex-1 font-semibold text-sm">New Section</h2>
				<Button size="sm" onClick={props.onCreate} disabled={!isReady}>
					{props.creating ? "Creating..." : "Create"}
				</Button>
			</div>
			<div className="flex-1 space-y-4 overflow-y-auto p-4">
				<div className="grid grid-cols-2 gap-4">
					<div className="space-y-1.5">
						<Label>Header</Label>
						<Input
							value={props.header}
							onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
								props.onHeaderChange(e.target.value)
							}
							placeholder="Section header"
						/>
					</div>
					<div className="space-y-1.5">
						<Label>Position</Label>
						<Input
							type="number"
							value={props.position}
							onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
								props.onPositionChange(e.target.value)
							}
						/>
					</div>
				</div>
				<div className="space-y-1.5">
					<Label>Content</Label>
					<MarkdownEditor
						value={props.content}
						onChange={props.onContentChange}
						placeholder="Section content..."
					/>
				</div>
			</div>
		</div>
	)
}

export { Content }

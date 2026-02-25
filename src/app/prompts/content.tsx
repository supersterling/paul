"use client"

import * as errors from "@superbuilders/errors"
import * as React from "react"
import {
	createUserOverride,
	deleteUserOverride,
	updateBaseSection,
	updateUserOverride
} from "@/app/prompts/actions"
import type { BaseSection, UserOverride } from "@/app/prompts/page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

type UserContext = {
	slackUserId: string | undefined
	overrides: UserOverride[]
}

const PHASE_ORDER = ["research", "propose", "build", "review", "pr"]

function Content(props: {
	baseSectionsPromise: Promise<BaseSection[]>
	userContextPromise: Promise<UserContext>
}) {
	const baseSections = React.use(props.baseSectionsPromise)
	const userContext = React.use(props.userContextPromise)

	const [editedBase, setEditedBase] = React.useState<Record<string, string>>({})
	const [editedOverrides, setEditedOverrides] = React.useState<Record<string, string>>({})
	const [savingIds, setSavingIds] = React.useState<Set<string>>(new Set())
	const [successIds, setSuccessIds] = React.useState<Set<string>>(new Set())

	const [newPhase, setNewPhase] = React.useState("")
	const [newHeader, setNewHeader] = React.useState("")
	const [newContent, setNewContent] = React.useState("")
	const [newPosition, setNewPosition] = React.useState("100")
	const [creating, setCreating] = React.useState(false)

	const grouped = groupByPhase(baseSections)

	async function handleSaveBase(id: string) {
		const content = editedBase[id]
		if (!content) return

		setSavingIds((prev) => new Set(prev).add(id))
		const result = await errors.try(updateBaseSection({ id, content }))
		setSavingIds((prev) => {
			const next = new Set(prev)
			next.delete(id)
			return next
		})
		if (result.error) return

		setEditedBase((prev) => {
			const next = { ...prev }
			delete next[id]
			return next
		})
		flashSuccess(id)
	}

	async function handleSaveOverride(id: string) {
		const content = editedOverrides[id]
		if (!content) return

		setSavingIds((prev) => new Set(prev).add(id))
		const result = await errors.try(updateUserOverride({ id, content }))
		setSavingIds((prev) => {
			const next = new Set(prev)
			next.delete(id)
			return next
		})
		if (result.error) return

		setEditedOverrides((prev) => {
			const next = { ...prev }
			delete next[id]
			return next
		})
		flashSuccess(id)
	}

	async function handleDeleteOverride(id: string) {
		setSavingIds((prev) => new Set(prev).add(id))
		const result = await errors.try(deleteUserOverride({ id }))
		if (result.error) {
			setSavingIds((prev) => {
				const next = new Set(prev)
				next.delete(id)
				return next
			})
			return
		}
		setSavingIds((prev) => {
			const next = new Set(prev)
			next.delete(id)
			return next
		})
	}

	async function handleCreateOverride() {
		if (!userContext.slackUserId) return
		if (!newPhase) return
		if (!newHeader) return
		if (!newContent) return

		setCreating(true)
		const result = await errors.try(
			createUserOverride({
				slackUserId: userContext.slackUserId,
				phase: newPhase,
				header: newHeader,
				content: newContent,
				position: Number.parseInt(newPosition, 10)
			})
		)
		setCreating(false)
		if (result.error) return

		setNewPhase("")
		setNewHeader("")
		setNewContent("")
		setNewPosition("100")
	}

	function flashSuccess(id: string) {
		setSuccessIds((prev) => new Set(prev).add(id))
		setTimeout(() => {
			setSuccessIds((prev) => {
				const next = new Set(prev)
				next.delete(id)
				return next
			})
		}, 2000)
	}

	const overridesByPhase = groupOverridesByPhase(userContext.overrides)
	const hasSlack = !!userContext.slackUserId

	return (
		<div data-slot="prompt-editor" className="space-y-6">
			<div>
				<h1 className="font-semibold text-2xl">Prompt Sections</h1>
				<p className="text-muted-foreground text-sm">
					Manage base prompt sections and personal overrides for the Cursor agent.
				</p>
			</div>

			<Tabs defaultValue="base">
				<TabsList>
					<TabsTrigger value="base">Base Prompts</TabsTrigger>
					<TabsTrigger value="overrides">My Overrides</TabsTrigger>
				</TabsList>

				<TabsContent value="base" className="space-y-8 pt-4">
					{PHASE_ORDER.map((phase) => {
						const sections = grouped.get(phase)
						if (!sections) return null

						return (
							<PhaseGroup key={phase} phase={phase}>
								{sections.map((section) => {
									const edited = editedBase[section.id]
									const currentContent = edited !== undefined ? edited : section.content
									const isDirty = edited !== undefined
									const isSaving = savingIds.has(section.id)
									const isSuccess = successIds.has(section.id)

									return (
										<SectionCard
											key={section.id}
											header={section.header}
											position={section.position}
											content={currentContent}
											isDirty={isDirty}
											isSaving={isSaving}
											isSuccess={isSuccess}
											onContentChange={(value: string) => {
												setEditedBase((prev) => ({ ...prev, [section.id]: value }))
											}}
											onSave={() => {
												handleSaveBase(section.id)
											}}
										/>
									)
								})}
							</PhaseGroup>
						)
					})}
				</TabsContent>

				<TabsContent value="overrides" className="space-y-8 pt-4">
					{!hasSlack && (
						<Card>
							<CardContent className="py-6">
								<p className="text-muted-foreground text-sm">
									Link your Slack account in Clerk to create personal overrides.
								</p>
							</CardContent>
						</Card>
					)}

					{hasSlack && (
						<>
							{PHASE_ORDER.map((phase) => {
								const overrides = overridesByPhase.get(phase)
								if (!overrides) return null

								return (
									<PhaseGroup key={phase} phase={phase}>
										{overrides.map((override) => {
											const editedOv = editedOverrides[override.id]
											const currentContent = editedOv !== undefined ? editedOv : override.content
											const isDirty = editedOv !== undefined
											const isSaving = savingIds.has(override.id)
											const isSuccess = successIds.has(override.id)

											return (
												<SectionCard
													key={override.id}
													header={override.header}
													position={override.position}
													content={currentContent}
													isDirty={isDirty}
													isSaving={isSaving}
													isSuccess={isSuccess}
													onContentChange={(value: string) => {
														setEditedOverrides((prev) => ({
															...prev,
															[override.id]: value
														}))
													}}
													onSave={() => {
														handleSaveOverride(override.id)
													}}
													onDelete={() => {
														handleDeleteOverride(override.id)
													}}
												/>
											)
										})}
									</PhaseGroup>
								)
							})}

							<Card>
								<CardHeader>
									<CardTitle>New Override</CardTitle>
								</CardHeader>
								<CardContent className="space-y-4">
									<div className="grid grid-cols-2 gap-4">
										<div className="space-y-1.5">
											<Label>Phase</Label>
											<Select value={newPhase} onValueChange={setNewPhase}>
												<SelectTrigger className="w-full">
													<SelectValue placeholder="Select phase" />
												</SelectTrigger>
												<SelectContent>
													{PHASE_ORDER.map((p) => (
														<SelectItem key={p} value={p}>
															{p}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
										<div className="space-y-1.5">
											<Label>Position</Label>
											<Input
												type="number"
												value={newPosition}
												onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
													setNewPosition(e.target.value)
												}}
											/>
										</div>
									</div>
									<div className="space-y-1.5">
										<Label>Header</Label>
										<Input
											value={newHeader}
											onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
												setNewHeader(e.target.value)
											}}
											placeholder="Section header (matches base section to override)"
										/>
									</div>
									<div className="space-y-1.5">
										<Label>Content</Label>
										<Textarea
											value={newContent}
											onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
												setNewContent(e.target.value)
											}}
											placeholder="Override content..."
											className="min-h-24"
										/>
									</div>
								</CardContent>
								<CardFooter>
									<Button
										onClick={handleCreateOverride}
										disabled={isCreateFormIncomplete(creating, newPhase, newHeader, newContent)}
									>
										{creating ? "Creating..." : "Create Override"}
									</Button>
								</CardFooter>
							</Card>
						</>
					)}
				</TabsContent>
			</Tabs>
		</div>
	)
}

function PhaseGroup(props: { phase: string; children: React.ReactNode }) {
	return (
		<div data-slot="phase-group" className="space-y-3">
			<h2 className="flex items-center gap-2 font-medium text-muted-foreground text-sm uppercase tracking-wide">
				<Badge variant="outline">{props.phase}</Badge>
			</h2>
			<div className="space-y-3">{props.children}</div>
		</div>
	)
}

function SectionCard(props: {
	header: string
	position: number
	content: string
	isDirty: boolean
	isSaving: boolean
	isSuccess: boolean
	onContentChange: (value: string) => void
	onSave: () => void
	onDelete?: () => void
}) {
	const saveLabel = props.isSaving ? "Saving..." : props.isSuccess ? "Saved" : "Save"
	const saveDisabled = props.isSaving ? true : !props.isDirty

	return (
		<Card size="sm">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					{props.header}
					<span className="text-muted-foreground text-xs">#{props.position}</span>
				</CardTitle>
			</CardHeader>
			<CardContent>
				<Textarea
					value={props.content}
					onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
						props.onContentChange(e.target.value)
					}}
					className="min-h-20 font-mono text-xs"
				/>
			</CardContent>
			<CardFooter className="gap-2">
				<Button size="sm" onClick={props.onSave} disabled={saveDisabled}>
					{saveLabel}
				</Button>
				{props.onDelete && (
					<Button
						size="sm"
						variant="destructive"
						onClick={props.onDelete}
						disabled={props.isSaving}
					>
						Delete
					</Button>
				)}
			</CardFooter>
		</Card>
	)
}

function groupByPhase(sections: BaseSection[]): Map<string, BaseSection[]> {
	const map = new Map<string, BaseSection[]>()
	for (const section of sections) {
		const list = map.get(section.phase)
		if (list) {
			list.push(section)
		} else {
			map.set(section.phase, [section])
		}
	}
	return map
}

function groupOverridesByPhase(overrides: UserOverride[]): Map<string, UserOverride[]> {
	const map = new Map<string, UserOverride[]>()
	for (const override of overrides) {
		const list = map.get(override.phase)
		if (list) {
			list.push(override)
		} else {
			map.set(override.phase, [override])
		}
	}
	return map
}

function isCreateFormIncomplete(
	creating: boolean,
	phase: string,
	header: string,
	content: string
): boolean {
	if (creating) return true
	if (!phase) return true
	if (!header) return true
	if (!content) return true
	return false
}

export { Content }

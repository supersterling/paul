import { env } from "@/env"
import { codeFunction } from "@/inngest/functions/agents/code"
import { exploreFunction } from "@/inngest/functions/agents/explore"
import { orchestrateFunction } from "@/inngest/functions/agents/orchestrate"
import { echoFunction } from "@/inngest/functions/debug/echo"
import { analysisFunction } from "@/inngest/functions/pipeline/analysis"
import { approachesFunction } from "@/inngest/functions/pipeline/approaches"
import { featureRunFunction } from "@/inngest/functions/pipeline/feature-run"
import { implementationFunction } from "@/inngest/functions/pipeline/implementation"
import { judgingFunction } from "@/inngest/functions/pipeline/judging"
import { createFunction } from "@/inngest/functions/sandbox/create"
import { stopFunction } from "@/inngest/functions/sandbox/stop"

const coreFunctions = [
	codeFunction,
	exploreFunction,
	orchestrateFunction,
	analysisFunction,
	approachesFunction,
	featureRunFunction,
	implementationFunction,
	judgingFunction,
	createFunction,
	stopFunction
]

const debugFunctions = env.NODE_ENV === "production" ? [] : [echoFunction]

const functions = [...coreFunctions, ...debugFunctions]

export { functions }

CREATE SCHEMA "agent";
--> statement-breakpoint
CREATE TYPE "agent"."cta_kind" AS ENUM('approval', 'text', 'choice');--> statement-breakpoint
CREATE TYPE "agent"."feature_phase" AS ENUM('analysis', 'approaches', 'judging', 'implementation', 'pr', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "agent"."phase_status" AS ENUM('running', 'passed', 'failed');--> statement-breakpoint
CREATE TYPE "agent"."sandbox_source_type" AS ENUM('git', 'tarball', 'snapshot', 'empty');--> statement-breakpoint
CREATE TYPE "agent"."sandbox_status" AS ENUM('pending', 'running', 'stopping', 'stopped', 'failed', 'aborted', 'snapshotting');--> statement-breakpoint
CREATE TABLE "agent"."agent_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phase_result_id" uuid NOT NULL,
	"parent_invocation_id" uuid,
	"agent_type" text NOT NULL,
	"model_id" text NOT NULL,
	"system_prompt" text NOT NULL,
	"input_messages" jsonb NOT NULL,
	"finish_reason" text,
	"output_text" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"steps" jsonb,
	"tool_calls" jsonb,
	"raw_response" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent"."cta_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"phase_result_id" uuid NOT NULL,
	"invocation_id" uuid,
	"tool_call_id" text,
	"kind" "agent"."cta_kind" NOT NULL,
	"request_message" text,
	"request_prompt" text,
	"request_placeholder" text,
	"request_options" jsonb,
	"response_approved" boolean,
	"response_reason" text,
	"response_text" text,
	"response_selected_id" text,
	"requested_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"timed_out" boolean
);
--> statement-breakpoint
CREATE TABLE "agent"."feature_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt" text NOT NULL,
	"sandbox_id" text NOT NULL,
	"github_repo_url" text NOT NULL,
	"github_branch" text NOT NULL,
	"current_phase" "agent"."feature_phase" NOT NULL,
	"memories" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent"."phase_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"phase" "agent"."feature_phase" NOT NULL,
	"status" "agent"."phase_status" NOT NULL,
	"output" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent"."sandboxes" (
	"id" text PRIMARY KEY NOT NULL,
	"status" "agent"."sandbox_status" NOT NULL,
	"runtime" text NOT NULL,
	"memory" integer NOT NULL,
	"vcpus" integer NOT NULL,
	"region" text NOT NULL,
	"cwd" text NOT NULL,
	"timeout" integer NOT NULL,
	"network_policy" jsonb,
	"interactive_port" integer,
	"routes" jsonb,
	"source_snapshot_id" text,
	"source_type" "agent"."sandbox_source_type",
	"source_url" text,
	"source_revision" text,
	"source_depth" integer,
	"requested_at" timestamp with time zone,
	"created_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"requested_stop_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"aborted_at" timestamp with time zone,
	"snapshotted_at" timestamp with time zone,
	"duration" integer
);
--> statement-breakpoint
ALTER TABLE "agent"."agent_invocations" ADD CONSTRAINT "agent_invocations_phase_result_id_phase_results_id_fk" FOREIGN KEY ("phase_result_id") REFERENCES "agent"."phase_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."agent_invocations" ADD CONSTRAINT "agent_invocations_parent_invocation_id_agent_invocations_id_fk" FOREIGN KEY ("parent_invocation_id") REFERENCES "agent"."agent_invocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."cta_events" ADD CONSTRAINT "cta_events_run_id_feature_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "agent"."feature_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."cta_events" ADD CONSTRAINT "cta_events_phase_result_id_phase_results_id_fk" FOREIGN KEY ("phase_result_id") REFERENCES "agent"."phase_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."cta_events" ADD CONSTRAINT "cta_events_invocation_id_agent_invocations_id_fk" FOREIGN KEY ("invocation_id") REFERENCES "agent"."agent_invocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."feature_runs" ADD CONSTRAINT "feature_runs_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "agent"."sandboxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."phase_results" ADD CONSTRAINT "phase_results_run_id_feature_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "agent"."feature_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cta_events_run_id_idx" ON "agent"."cta_events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "feature_runs_created_at_idx" ON "agent"."feature_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "phase_results_run_id_phase_idx" ON "agent"."phase_results" USING btree ("run_id","phase");
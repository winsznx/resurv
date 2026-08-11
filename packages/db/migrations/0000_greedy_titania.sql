CREATE TYPE "public"."attempt_status" AS ENUM('PENDING', 'RECONCILING', 'PLANNING', 'SIMULATING', 'SIMULATION_REJECTED', 'SUBMITTING', 'AWAITING_KEEPERHUB', 'AWAITING_CONFIRMATIONS', 'SATISFIED', 'EXHAUSTED', 'EXPIRED', 'ESCALATED', 'FAILED_INTERNAL');--> statement-breakpoint
CREATE TYPE "public"."execution_state" AS ENUM('PENDING', 'COMPLETED', 'FAILED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."onchain_status" AS ENUM('NONE', 'DRAFT', 'ARMED', 'TRIGGERED', 'EXECUTING', 'SATISFIED', 'EXPIRED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."simulation_provider" AS ENUM('keeperhub', 'rpc');--> statement-breakpoint
CREATE TYPE "public"."trigger_status" AS ENUM('RECEIVED', 'VALIDATED', 'REJECTED', 'SUBMITTED', 'CONSUMED');--> statement-breakpoint
CREATE TABLE "action_specs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"covenant_id" uuid NOT NULL,
	"action_index" integer NOT NULL,
	"adapter_address" text NOT NULL,
	"config_json" jsonb NOT NULL,
	"config_hash" text NOT NULL,
	"max_attempts" integer NOT NULL,
	"priority" integer NOT NULL,
	"schema_version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"semantic_attempt_id" text NOT NULL,
	"covenant_id" uuid NOT NULL,
	"action_index" integer NOT NULL,
	"attempt_sequence" integer NOT NULL,
	"expected_state_hash" text,
	"request_body_hash" text,
	"status" "attempt_status" DEFAULT 'PENDING' NOT NULL,
	"planner_decision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"covenant_id" uuid NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"status" "onchain_status" NOT NULL,
	"state_hash" text,
	"observed_value" numeric(78, 0),
	"vault_balance" numeric(78, 0),
	"safe_balance" numeric(78, 0),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "covenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_address" text NOT NULL,
	"onchain_covenant_id" text NOT NULL,
	"requester_address" text NOT NULL,
	"trigger_authority" text NOT NULL,
	"responder_address" text NOT NULL,
	"verifier_address" text NOT NULL,
	"verifier_context" text NOT NULL,
	"verifier_context_hash" text NOT NULL,
	"fee_token" text NOT NULL,
	"fee_amount" numeric(78, 0) NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"onchain_status" "onchain_status" DEFAULT 'NONE' NOT NULL,
	"last_reconciled_block" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keeperhub_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"execution_id" text,
	"idempotency_key_hash" text NOT NULL,
	"request_id" text,
	"state" "execution_state" DEFAULT 'PENDING' NOT NULL,
	"raw_status" text,
	"transaction_hash" text,
	"transaction_link" text,
	"gas_used" numeric(78, 0),
	"gas_price_wei" numeric(78, 0),
	"sponsored" boolean,
	"error_code" text,
	"error_message" text,
	"private_mempool_expected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planner_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"covenant_id" uuid NOT NULL,
	"model_provider" text NOT NULL,
	"model_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"output_json" jsonb NOT NULL,
	"valid" boolean NOT NULL,
	"fallback_used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"covenant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"receipt_json" jsonb NOT NULL,
	"receipt_hash" text NOT NULL,
	"signature" text,
	"verification_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"provider" "simulation_provider" NOT NULL,
	"request_json" jsonb NOT NULL,
	"request_hash" text NOT NULL,
	"response_json" jsonb NOT NULL,
	"response_hash" text NOT NULL,
	"would_revert" boolean NOT NULL,
	"revert_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trigger_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"covenant_id" uuid NOT NULL,
	"signal_hash" text NOT NULL,
	"nonce" numeric(78, 0) NOT NULL,
	"valid_after" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"signature" text NOT NULL,
	"submission_tx_hash" text,
	"status" "trigger_status" DEFAULT 'RECEIVED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_specs" ADD CONSTRAINT "action_specs_covenant_id_covenants_id_fk" FOREIGN KEY ("covenant_id") REFERENCES "public"."covenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_covenant_id_covenants_id_fk" FOREIGN KEY ("covenant_id") REFERENCES "public"."covenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_planner_decision_id_planner_decisions_id_fk" FOREIGN KEY ("planner_decision_id") REFERENCES "public"."planner_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_observations" ADD CONSTRAINT "chain_observations_covenant_id_covenants_id_fk" FOREIGN KEY ("covenant_id") REFERENCES "public"."covenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keeperhub_executions" ADD CONSTRAINT "keeperhub_executions_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planner_decisions" ADD CONSTRAINT "planner_decisions_covenant_id_covenants_id_fk" FOREIGN KEY ("covenant_id") REFERENCES "public"."covenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_covenant_id_covenants_id_fk" FOREIGN KEY ("covenant_id") REFERENCES "public"."covenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulations" ADD CONSTRAINT "simulations_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_signals" ADD CONSTRAINT "trigger_signals_covenant_id_covenants_id_fk" FOREIGN KEY ("covenant_id") REFERENCES "public"."covenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_specs_covenant_index_key" ON "action_specs" USING btree ("covenant_id","action_index");--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_semantic_attempt_id_key" ON "attempts" USING btree ("semantic_attempt_id");--> statement-breakpoint
CREATE INDEX "attempts_covenant_idx" ON "attempts" USING btree ("covenant_id");--> statement-breakpoint
CREATE INDEX "audit_events_subject_idx" ON "audit_events" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "chain_observations_covenant_block_idx" ON "chain_observations" USING btree ("covenant_id","block_number");--> statement-breakpoint
CREATE UNIQUE INDEX "covenants_onchain_identity_key" ON "covenants" USING btree ("chain_id","contract_address","onchain_covenant_id");--> statement-breakpoint
CREATE INDEX "covenants_status_idx" ON "covenants" USING btree ("onchain_status");--> statement-breakpoint
CREATE UNIQUE INDEX "keeperhub_executions_execution_id_key" ON "keeperhub_executions" USING btree ("execution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "keeperhub_executions_transaction_hash_key" ON "keeperhub_executions" USING btree ("transaction_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "keeperhub_executions_idempotency_key" ON "keeperhub_executions" USING btree ("idempotency_key_hash");--> statement-breakpoint
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events" USING btree ("published_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_covenant_version_key" ON "receipts" USING btree ("covenant_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "trigger_signals_signal_hash_key" ON "trigger_signals" USING btree ("signal_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "trigger_signals_covenant_nonce_key" ON "trigger_signals" USING btree ("covenant_id","nonce");
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * RESURV orchestration schema (PRD 15.1).
 *
 * Scope note: users, organizations and organization_members are deferred to the phase that
 * introduces operator auth. Every table here is on the execution critical path.
 *
 * Money and chain quantities are `numeric(78, 0)`, which holds a full uint256 without loss.
 * `bigint` would silently truncate a wei value.
 */

export const onchainStatusEnum = pgEnum('onchain_status', [
  'NONE',
  'DRAFT',
  'ARMED',
  'TRIGGERED',
  'EXECUTING',
  'SATISFIED',
  'EXPIRED',
  'CANCELLED',
]);

export const attemptStatusEnum = pgEnum('attempt_status', [
  'PENDING',
  'RECONCILING',
  'PLANNING',
  'SIMULATING',
  'SIMULATION_REJECTED',
  'SUBMITTING',
  'AWAITING_KEEPERHUB',
  'AWAITING_CONFIRMATIONS',
  'SATISFIED',
  'EXHAUSTED',
  'EXPIRED',
  'ESCALATED',
  'FAILED_INTERNAL',
]);

export const executionStateEnum = pgEnum('execution_state', [
  'PENDING',
  'COMPLETED',
  'FAILED',
  'UNKNOWN',
]);

export const simulationProviderEnum = pgEnum('simulation_provider', ['keeperhub', 'rpc']);

export const triggerStatusEnum = pgEnum('trigger_status', [
  'RECEIVED',
  'VALIDATED',
  'REJECTED',
  'SUBMITTED',
  'CONSUMED',
]);

export const covenants = pgTable(
  'covenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chainId: integer('chain_id').notNull(),
    contractAddress: text('contract_address').notNull(),
    onchainCovenantId: text('onchain_covenant_id').notNull(),
    requesterAddress: text('requester_address').notNull(),
    triggerAuthority: text('trigger_authority').notNull(),
    responderAddress: text('responder_address').notNull(),
    verifierAddress: text('verifier_address').notNull(),
    verifierContext: text('verifier_context').notNull(),
    verifierContextHash: text('verifier_context_hash').notNull(),
    feeToken: text('fee_token').notNull(),
    feeAmount: numeric('fee_amount', { precision: 78, scale: 0 }).notNull(),
    deadline: timestamp('deadline', { withTimezone: true }).notNull(),
    onchainStatus: onchainStatusEnum('onchain_status').notNull().default('NONE'),
    lastReconciledBlock: bigint('last_reconciled_block', { mode: 'bigint' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('covenants_onchain_identity_key').on(
      table.chainId,
      table.contractAddress,
      table.onchainCovenantId,
    ),
    index('covenants_status_idx').on(table.onchainStatus),
  ],
);

export const actionSpecs = pgTable(
  'action_specs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    covenantId: uuid('covenant_id')
      .notNull()
      .references(() => covenants.id, { onDelete: 'cascade' }),
    actionIndex: integer('action_index').notNull(),
    adapterAddress: text('adapter_address').notNull(),
    configJson: jsonb('config_json').notNull(),
    configHash: text('config_hash').notNull(),
    maxAttempts: integer('max_attempts').notNull(),
    priority: integer('priority').notNull(),
    schemaVersion: integer('schema_version').notNull(),
  },
  (table) => [
    uniqueIndex('action_specs_covenant_index_key').on(table.covenantId, table.actionIndex),
  ],
);

export const triggerSignals = pgTable(
  'trigger_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    covenantId: uuid('covenant_id')
      .notNull()
      .references(() => covenants.id, { onDelete: 'cascade' }),
    signalHash: text('signal_hash').notNull(),
    nonce: numeric('nonce', { precision: 78, scale: 0 }).notNull(),
    validAfter: timestamp('valid_after', { withTimezone: true }).notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    signature: text('signature').notNull(),
    submissionTxHash: text('submission_tx_hash'),
    status: triggerStatusEnum('status').notNull().default('RECEIVED'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('trigger_signals_signal_hash_key').on(table.signalHash),
    uniqueIndex('trigger_signals_covenant_nonce_key').on(table.covenantId, table.nonce),
  ],
);

export const plannerDecisions = pgTable('planner_decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  covenantId: uuid('covenant_id')
    .notNull()
    .references(() => covenants.id, { onDelete: 'cascade' }),
  modelProvider: text('model_provider').notNull(),
  modelId: text('model_id').notNull(),
  promptVersion: text('prompt_version').notNull(),
  inputHash: text('input_hash').notNull(),
  outputJson: jsonb('output_json').notNull(),
  valid: boolean('valid').notNull(),
  fallbackUsed: boolean('fallback_used').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const attempts = pgTable(
  'attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Permanent economic identity of this attempt. The contract rejects a replay of the
     * same semantic attempt forever, unlike KeeperHub's 24-hour transport window.
     */
    semanticAttemptId: text('semantic_attempt_id').notNull(),
    covenantId: uuid('covenant_id')
      .notNull()
      .references(() => covenants.id, { onDelete: 'cascade' }),
    actionIndex: integer('action_index').notNull(),
    attemptSequence: integer('attempt_sequence').notNull(),
    expectedStateHash: text('expected_state_hash'),
    /**
     * Hash of the canonical request body, written before the first POST. Recovery replays
     * the stored body byte-for-byte; without this row a crash between send and response
     * leaves no way to tell whether a transaction was broadcast.
     */
    requestBodyHash: text('request_body_hash'),
    status: attemptStatusEnum('status').notNull().default('PENDING'),
    plannerDecisionId: uuid('planner_decision_id').references(() => plannerDecisions.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('attempts_semantic_attempt_id_key').on(table.semanticAttemptId),
    index('attempts_covenant_idx').on(table.covenantId),
  ],
);

export const simulations = pgTable('simulations', {
  id: uuid('id').primaryKey().defaultRandom(),
  attemptId: uuid('attempt_id')
    .notNull()
    .references(() => attempts.id, { onDelete: 'cascade' }),
  provider: simulationProviderEnum('provider').notNull(),
  requestJson: jsonb('request_json').notNull(),
  requestHash: text('request_hash').notNull(),
  responseJson: jsonb('response_json').notNull(),
  responseHash: text('response_hash').notNull(),
  wouldRevert: boolean('would_revert').notNull(),
  revertReason: text('revert_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const keeperhubExecutions = pgTable(
  'keeperhub_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    /**
     * Nullable on purpose. The 202 for /contract-call can return before we persist, and a
     * crash there leaves an attempt whose execution id we never saw. The idempotency key
     * below, not this column, is the recovery primitive.
     */
    executionId: text('execution_id'),
    idempotencyKeyHash: text('idempotency_key_hash').notNull(),
    requestId: text('request_id'),
    state: executionStateEnum('state').notNull().default('PENDING'),
    rawStatus: text('raw_status'),
    transactionHash: text('transaction_hash'),
    transactionLink: text('transaction_link'),
    /** Gas units, despite KeeperHub naming the field gasUsedWei. */
    gasUsed: numeric('gas_used', { precision: 78, scale: 0 }),
    gasPriceWei: numeric('gas_price_wei', { precision: 78, scale: 0 }),
    sponsored: boolean('sponsored'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    /** Recorded per run. Base Sepolia measured false; never assumed. */
    privateMempoolExpected: boolean('private_mempool_expected').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('keeperhub_executions_execution_id_key').on(table.executionId),
    uniqueIndex('keeperhub_executions_transaction_hash_key').on(table.transactionHash),
    uniqueIndex('keeperhub_executions_idempotency_key').on(table.idempotencyKeyHash),
  ],
);

export const chainObservations = pgTable(
  'chain_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    covenantId: uuid('covenant_id')
      .notNull()
      .references(() => covenants.id, { onDelete: 'cascade' }),
    blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
    blockHash: text('block_hash').notNull(),
    status: onchainStatusEnum('status').notNull(),
    stateHash: text('state_hash'),
    observedValue: numeric('observed_value', { precision: 78, scale: 0 }),
    vaultBalance: numeric('vault_balance', { precision: 78, scale: 0 }),
    safeBalance: numeric('safe_balance', { precision: 78, scale: 0 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('chain_observations_covenant_block_idx').on(table.covenantId, table.blockNumber),
  ],
);

export const receipts = pgTable(
  'receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    covenantId: uuid('covenant_id')
      .notNull()
      .references(() => covenants.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    receiptJson: jsonb('receipt_json').notNull(),
    receiptHash: text('receipt_hash').notNull(),
    signature: text('signature'),
    verificationStatus: text('verification_status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('receipts_covenant_version_key').on(table.covenantId, table.version)],
);

/**
 * Transactional outbox. State and outbox row are written in one transaction, so a job is
 * never scheduled for a state change that did not commit.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
  },
  (table) => [index('outbox_events_unpublished_idx').on(table.publishedAt, table.createdAt)],
);

/** Append-only. No update or delete path exists for this table. */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('audit_events_subject_idx').on(table.subjectType, table.subjectId)],
);

import type { attempts, covenants, keeperhubExecutions } from './schema.ts';

type Covenant = typeof covenants.$inferSelect;
type Attempt = typeof attempts.$inferSelect;
type NewAttempt = typeof attempts.$inferInsert;
type KeeperhubExecution = typeof keeperhubExecutions.$inferSelect;
type NewKeeperhubExecution = typeof keeperhubExecutions.$inferInsert;

/**
 * Data access boundary. The orchestrator depends on this interface, never on a driver, so
 * the crash-recovery tests can run against an in-memory double and the live connection is
 * not a prerequisite for building the logic that uses it.
 */
export interface CovenantRepository {
  findByOnchainIdentity(
    chainId: number,
    contractAddress: string,
    onchainCovenantId: string,
  ): Promise<Covenant | undefined>;
}

export interface AttemptRepository {
  findBySemanticId(semanticAttemptId: string): Promise<Attempt | undefined>;
  /**
   * Must be a single INSERT ... ON CONFLICT DO NOTHING on `semantic_attempt_id`. Read-then-
   * write races two workers into two attempts for one economic action.
   */
  claim(attempt: NewAttempt): Promise<{ attempt: Attempt; created: boolean }>;
}

export interface KeeperhubExecutionRepository {
  /**
   * Persists the idempotency key and canonical body hash BEFORE the first POST. This is the
   * only durable record that a broadcast may be in flight, because the /contract-call 202
   * carries no transaction hash and there is no list-executions endpoint to search.
   */
  reserve(execution: NewKeeperhubExecution): Promise<KeeperhubExecution>;
  findByIdempotencyKeyHash(hash: string): Promise<KeeperhubExecution | undefined>;
  recordOutcome(
    id: string,
    outcome: Partial<
      Pick<
        KeeperhubExecution,
        | 'executionId'
        | 'state'
        | 'rawStatus'
        | 'transactionHash'
        | 'transactionLink'
        | 'gasUsed'
        | 'gasPriceWei'
        | 'sponsored'
        | 'errorCode'
        | 'errorMessage'
        | 'completedAt'
      >
    >,
  ): Promise<KeeperhubExecution>;
}

export interface Repositories {
  readonly covenants: CovenantRepository;
  readonly attempts: AttemptRepository;
  readonly keeperhubExecutions: KeeperhubExecutionRepository;
}

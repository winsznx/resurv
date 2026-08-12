/**
 * The durable record of a semantic attempt.
 *
 * ADR-004's argument in one paragraph, because this interface is the thing it argues for.
 * `/api/execute/contract-call` executes synchronously and returns HTTP 202. There is no
 * list-executions endpoint for direct execution: `GET /api/execute` and `GET /api/executions`
 * were both measured returning 404. If the client dies between sending the request and reading
 * the response, the execution id exists nowhere locally and cannot be recovered by querying.
 * The only recovery is replaying the same idempotency key with a byte-identical body, and that
 * requires both to be durable *before* the first POST.
 *
 * So the contract of every implementation is one sentence: `reserve` returns only after the
 * record is on stable storage, and it is called before anything is sent.
 */

import type { AttemptState } from '@resurv/domain';

export interface AttemptRecord {
  /** Permanent economic identity. Unique. The onchain burn uses the same derivation. */
  readonly semanticAttemptId: string;
  readonly covenantId: string;
  readonly actionIndex: number;
  readonly attemptSequence: number;
  readonly expectedStateHash: string | undefined;
  /** The exact bytes sent. A replay must reproduce this string or KeeperHub answers 409. */
  readonly canonicalBody: string;
  readonly canonicalBodyHash: string;
  readonly idempotencyKey: string;
  /**
   * The chain head before the first request left. Durable for the same reason the key is: a
   * resumed process searching for the attempt's onchain marker has to start where the attempt
   * started, not at the head it happens to see now.
   *
   * Recomputing it on resume was a real defect. A crash, a later re-run, and a log search that
   * begins at the current head skips the very block the transaction landed in, and the reconciler
   * concludes `PROVEN_NOT_BROADCAST` for an attempt that succeeded. That verdict is the one that
   * invites a second economic effect.
   */
  readonly fromBlock: number;
  readonly state: AttemptState;
  readonly executionId: string | undefined;
  readonly transactionHash: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Bounded retry counter. The loop leaves on evidence, never on this alone. */
  readonly reconciliationRounds: number;
  readonly note: string | undefined;
}

export type AttemptUpdate = Partial<
  Pick<AttemptRecord, 'state' | 'executionId' | 'transactionHash' | 'reconciliationRounds' | 'note'>
>;

export interface AttemptStore {
  /**
   * Claim a semantic attempt. Must be atomic: a read-then-write races two workers into two
   * attempts for one economic action. Returns `created: false` when the id already existed,
   * along with the record that already exists, which is what a second worker must reconcile
   * against rather than re-send.
   */
  reserve(record: AttemptRecord): Promise<{ record: AttemptRecord; created: boolean }>;
  find(semanticAttemptId: string): Promise<AttemptRecord | undefined>;
  update(semanticAttemptId: string, update: AttemptUpdate): Promise<AttemptRecord>;
  list(): Promise<readonly AttemptRecord[]>;
}

export class AttemptNotFoundError extends Error {
  constructor(semanticAttemptId: string) {
    super(`no attempt record for ${semanticAttemptId}`);
    this.name = 'AttemptNotFoundError';
  }
}

/**
 * For tests, and for nothing else. It satisfies the interface and not the contract: nothing here
 * survives the process, which is precisely the failure the interface exists to prevent.
 */
export class InMemoryAttemptStore implements AttemptStore {
  readonly #records = new Map<string, AttemptRecord>();

  async reserve(record: AttemptRecord): Promise<{ record: AttemptRecord; created: boolean }> {
    const existing = this.#records.get(record.semanticAttemptId);
    if (existing !== undefined) return { record: existing, created: false };
    this.#records.set(record.semanticAttemptId, record);
    return { record, created: true };
  }

  async find(semanticAttemptId: string): Promise<AttemptRecord | undefined> {
    return this.#records.get(semanticAttemptId);
  }

  async update(semanticAttemptId: string, update: AttemptUpdate): Promise<AttemptRecord> {
    const existing = this.#records.get(semanticAttemptId);
    if (existing === undefined) throw new AttemptNotFoundError(semanticAttemptId);
    const next: AttemptRecord = { ...existing, ...update, updatedAt: new Date().toISOString() };
    this.#records.set(semanticAttemptId, next);
    return next;
  }

  async list(): Promise<readonly AttemptRecord[]> {
    return [...this.#records.values()];
  }
}

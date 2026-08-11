/**
 * Execution status normalization.
 *
 * Every rule in this file exists because a live probe contradicted the documentation.
 * See docs/CLAIMS.md and the Phase 2 seam record. Do not "simplify" this into a switch
 * with a `default: failed` branch, which is precisely the bug it prevents.
 */

/**
 * Statuses listed in the Direct Execution endpoint reference.
 */
export const DOCUMENTED_EXECUTION_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;

/**
 * Observed live but absent from the endpoint reference. The first-verified-transaction
 * guide describes it as non-terminal: the status endpoint keeps asking you to poll.
 * Treating it as a failure reports a false negative for a transaction still settling.
 */
export const UNDOCUMENTED_EXECUTION_STATUSES = ['unconfirmed'] as const;

export type NormalizedExecutionState = 'PENDING' | 'COMPLETED' | 'FAILED' | 'UNKNOWN';

export interface NormalizedStatus {
  readonly state: NormalizedExecutionState;
  /** False means keep polling. Only COMPLETED and FAILED are terminal. */
  readonly terminal: boolean;
  /** True when the wire value was not in any list we know about. */
  readonly recognized: boolean;
  readonly raw: string;
}

const KNOWN_NON_TERMINAL: ReadonlySet<string> = new Set(['pending', 'running', 'unconfirmed']);

/**
 * The documented status set is a lower bound, not a closed enum. Anything unrecognized
 * normalizes to UNKNOWN and non-terminal so the caller keeps polling rather than
 * inventing an outcome.
 */
export function normalizeExecutionStatus(raw: string): NormalizedStatus {
  const value = raw.trim().toLowerCase();

  if (value === 'completed') {
    return { state: 'COMPLETED', terminal: true, recognized: true, raw };
  }
  if (value === 'failed') {
    return { state: 'FAILED', terminal: true, recognized: true, raw };
  }
  if (KNOWN_NON_TERMINAL.has(value)) {
    return { state: 'PENDING', terminal: false, recognized: true, raw };
  }
  return { state: 'UNKNOWN', terminal: false, recognized: false, raw };
}

/**
 * Receipt status values KeeperHub reports after re-fetching the receipt from chain.
 */
export type ReceiptStatus = 'success' | 'reverted' | 'safe_inner_failure' | 'not_found' | 'timeout';

export type ReceiptVerdict = 'LANDED' | 'REVERTED' | 'UNKNOWN';

/**
 * `not_found` and `timeout` fail the execution closed at KeeperHub, but the docs warn that
 * a failed execution carrying `timeout` may describe a transaction that later lands. Neither
 * value may be mapped to success or to failure. They are unknown, and the reconciler must
 * settle them against chain.
 */
export function classifyReceiptStatus(status: string): ReceiptVerdict {
  switch (status.trim().toLowerCase()) {
    case 'success':
      return 'LANDED';
    case 'reverted':
    case 'safe_inner_failure':
      return 'REVERTED';
    case 'not_found':
    case 'timeout':
      return 'UNKNOWN';
    default:
      return 'UNKNOWN';
  }
}

/**
 * `X-Poll-Interval-Hint` carries seconds to wait; `0` means terminal. A missing or
 * unparseable header falls back to the caller's default rather than to zero, because
 * zero would be read as "stop polling".
 */
export function parsePollIntervalHint(
  header: string | null | undefined,
  fallbackSeconds: number,
): { seconds: number; terminal: boolean } {
  if (header === null || header === undefined || header.trim() === '') {
    return { seconds: fallbackSeconds, terminal: false };
  }
  const parsed = Number(header.trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { seconds: fallbackSeconds, terminal: false };
  }
  if (parsed === 0) {
    return { seconds: 0, terminal: true };
  }
  return { seconds: parsed, terminal: false };
}

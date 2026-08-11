/**
 * Execution status normalization.
 *
 * Provenance, corrected after the Phase 0 independent review found this file overstating it.
 * No KeeperHub call has ever been made from this repository, and there is no Phase 2 seam
 * record: Phase 2 has not happened. Every rule below comes from official documentation, from
 * two official documents disagreeing with each other, or from the sibling `keeperhub-flightcheck`
 * spike, and the level of each is recorded in `docs/CLAIMS.md`. Read the ledger before
 * treating any of it as measured.
 *
 * What survives regardless of provenance is the failure mode this file is shaped around: do
 * not "simplify" it into a switch with a `default: failed` branch. An unrecognized status
 * must not become an invented outcome.
 */

/**
 * Statuses listed in the Direct Execution endpoint reference.
 */
export const DOCUMENTED_EXECUTION_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;

/**
 * Absent from the endpoint reference, described by the first-verified-transaction guide as a
 * state that keeps asking you to poll. Two official documents disagree, so `docs/CLAIMS.md`
 * rates this `DOCUMENTED (conflicting)` rather than measured. Treating it as a failure would
 * report a false negative for a transaction that is still settling, so it is non-terminal.
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
 *
 * The `reverted` and `safe_inner_failure` mapping is the hypothesis Phase 0.5 exists to test,
 * not settled behavior: `docs/CLAIMS.md` rates "a reverted broadcast is distinguishable from
 * a transport failure" as ASSUMED and unmeasured, and `safe_inner_failure` has never been
 * observed by this project at all. The seam probe records what actually comes back and this
 * mapping changes to match it, rather than the probe being read as confirmation.
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

/**
 * Test-only reference model of the attempt lifecycle, transcribed by hand from
 * `docs/phase-logs/PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md` sections 8 and 9. It is the
 * oracle `canTransitionAttempt`, `isTerminalAttemptState` and `mayStartAnotherSemanticAction`
 * are judged against, and it never imports them. ADR-009.
 *
 * The representation is deliberately unlike production's record of name arrays: a flat
 * character grid indexed by position, in the same shape as the covenant reference model.
 *
 * Two transcription decisions, stated here because a reader should not have to infer them:
 *
 * 1. `RECONCILIATION_REQUIRED -> RECONCILIATION_REQUIRED` is drawn in section 8's transition
 *    block ("bounded retry; never leaves on a timer") and is kept. It is the only permitted
 *    self-transition in either RESURV state machine.
 * 2. Section 8's "may RESURV start another semantic action" column answers `yes` for `PLANNED`
 *    and `SIMULATED_OK` even though neither is terminal, because nothing has been sent in
 *    either. `MAY_ADVANCE_ROW` follows that column, not the terminal row.
 */

/** Position in this array indexes both tables below. */
export const REFERENCE_ATTEMPT_ORDER = [
  'PLANNED',
  'REJECTED_LOCALLY',
  'SIMULATION_REJECTED',
  'SIMULATED_OK',
  'KEY_COMMITTED',
  'EXECUTED_NO_EFFECT',
  'RECONCILIATION_REQUIRED',
  'CONFIRMED',
  'REVERTED',
  'PROVEN_NOT_BROADCAST',
] as const;

export type ReferenceAttemptState = (typeof REFERENCE_ATTEMPT_ORDER)[number];

/** Row = from, column = to, in the order above. `X` permitted, `.` forbidden. */
export const REFERENCE_ATTEMPT_TRANSITION_TABLE = [
  '.XXX......', // PLANNED                 -> REJECTED_LOCALLY, SIMULATION_REJECTED, SIMULATED_OK
  '..........', // REJECTED_LOCALLY        -> nothing
  '..........', // SIMULATION_REJECTED     -> nothing
  '....X.....', // SIMULATED_OK            -> KEY_COMMITTED
  '.....XX...', // KEY_COMMITTED           -> EXECUTED_NO_EFFECT, RECONCILIATION_REQUIRED
  '..........', // EXECUTED_NO_EFFECT      -> nothing
  '......XXXX', // RECONCILIATION_REQUIRED -> itself, CONFIRMED, REVERTED, PROVEN_NOT_BROADCAST
  '..........', // CONFIRMED               -> nothing
  '..........', // REVERTED                -> nothing
  '..........', // PROVEN_NOT_BROADCAST    -> nothing
] as const;

/** `X` where the state is terminal. */
export const REFERENCE_ATTEMPT_TERMINAL_ROW = '.XX..X.XXX';

/** `X` where RESURV may begin another semantic recovery action. Section 9. */
export const REFERENCE_ATTEMPT_MAY_ADVANCE_ROW = 'XXXX.X.XXX';

function positionOf(state: ReferenceAttemptState): number {
  return REFERENCE_ATTEMPT_ORDER.indexOf(state);
}

export function referenceAttemptAllows(
  from: ReferenceAttemptState,
  to: ReferenceAttemptState,
): boolean {
  return REFERENCE_ATTEMPT_TRANSITION_TABLE[positionOf(from)]?.[positionOf(to)] === 'X';
}

export function referenceAttemptIsTerminal(state: ReferenceAttemptState): boolean {
  return REFERENCE_ATTEMPT_TERMINAL_ROW[positionOf(state)] === 'X';
}

export function referenceAttemptMayAdvance(state: ReferenceAttemptState): boolean {
  return REFERENCE_ATTEMPT_MAY_ADVANCE_ROW[positionOf(state)] === 'X';
}

export function referenceAttemptAllowedPairs(): [ReferenceAttemptState, ReferenceAttemptState][] {
  const pairs: [ReferenceAttemptState, ReferenceAttemptState][] = [];
  for (const from of REFERENCE_ATTEMPT_ORDER) {
    for (const to of REFERENCE_ATTEMPT_ORDER) {
      if (referenceAttemptAllows(from, to)) pairs.push([from, to]);
    }
  }
  return pairs;
}

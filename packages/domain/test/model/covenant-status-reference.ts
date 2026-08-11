/**
 * Test-only reference model of the covenant state machine, transcribed by hand from PRD 9.1.
 * It is the oracle the production `canTransition` and `isTerminalStatus` are judged against,
 * and it never imports them.
 *
 * The independent Phase 0 review showed why a shared implementation cannot be its own oracle:
 * adding `EXECUTING` to `TRANSITIONS.DRAFT` or `ARMED` to `TRANSITIONS.EXECUTING` left all 17
 * domain tests green, because every test asked the table what the table permitted.
 *
 * The representation is deliberately unlike the production one. Production is a record of
 * name arrays; this is a flat character grid indexed by ordinal, in the same shape as
 * `packages/contracts/test/model/CovenantStatusReference.sol`.
 * `@resurv/repo-policy` compares the two files character for character, so the Solidity and
 * TypeScript state machines cannot drift apart silently.
 *
 * Transcription note: PRD 9.1 draws DRAFT -> ARMED -> TRIGGERED -> EXECUTING -> SATISFIED,
 * with EXPIRED reachable from TRIGGERED and EXECUTING and CANCELLED reachable from DRAFT and
 * ARMED. Its closing note allows EXECUTING to be an emitted attempt state rather than a
 * stored one, so TRIGGERED -> SATISFIED is included. NONE -> DRAFT is covenant creation.
 */

/** Ordinal order. Position in this array is the onchain enum value. */
export const REFERENCE_STATUS_ORDER = [
  'NONE',
  'DRAFT',
  'ARMED',
  'TRIGGERED',
  'EXECUTING',
  'SATISFIED',
  'EXPIRED',
  'CANCELLED',
] as const;

export type ReferenceStatus = (typeof REFERENCE_STATUS_ORDER)[number];

/** Row = from, column = to, in ordinal order. `X` permitted, `.` forbidden. */
export const REFERENCE_TRANSITION_TABLE = [
  '.X......', // NONE      -> DRAFT
  '..X....X', // DRAFT     -> ARMED, CANCELLED
  '...X...X', // ARMED     -> TRIGGERED, CANCELLED
  '....XXX.', // TRIGGERED -> EXECUTING, SATISFIED, EXPIRED
  '.....XX.', // EXECUTING -> SATISFIED, EXPIRED
  '........', // SATISFIED -> nothing
  '........', // EXPIRED   -> nothing
  '........', // CANCELLED -> nothing
] as const;

/** One character per state, in ordinal order. `X` where the state is terminal. */
export const REFERENCE_TERMINAL_ROW = '.....XXX';

function ordinalOf(status: ReferenceStatus): number {
  return REFERENCE_STATUS_ORDER.indexOf(status);
}

export function referenceAllows(from: ReferenceStatus, to: ReferenceStatus): boolean {
  return REFERENCE_TRANSITION_TABLE[ordinalOf(from)]?.[ordinalOf(to)] === 'X';
}

export function referenceIsTerminal(status: ReferenceStatus): boolean {
  return REFERENCE_TERMINAL_ROW[ordinalOf(status)] === 'X';
}

export function referenceAllowedPairs(): [ReferenceStatus, ReferenceStatus][] {
  const pairs: [ReferenceStatus, ReferenceStatus][] = [];
  for (const from of REFERENCE_STATUS_ORDER) {
    for (const to of REFERENCE_STATUS_ORDER) {
      if (referenceAllows(from, to)) pairs.push([from, to]);
    }
  }
  return pairs;
}

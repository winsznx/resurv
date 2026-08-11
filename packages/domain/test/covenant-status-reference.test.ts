import { describe, expect, it } from 'vitest';
import {
  allCovenantStatusNames,
  CovenantStatus,
  canTransition,
  isTerminalStatus,
} from '../src/covenant-status.ts';
import {
  REFERENCE_STATUS_ORDER,
  REFERENCE_TRANSITION_TABLE,
  type ReferenceStatus,
  referenceAllowedPairs,
  referenceAllows,
  referenceIsTerminal,
} from './model/covenant-status-reference.ts';

/**
 * Equivalence between the production state machine and the independent reference model over
 * the complete pair space. Generated from the model, never filtered through production
 * logic, which is what makes it able to see an illegal transition being permitted.
 */

const ALL_PAIRS: [ReferenceStatus, ReferenceStatus][] = REFERENCE_STATUS_ORDER.flatMap((from) =>
  REFERENCE_STATUS_ORDER.map((to): [ReferenceStatus, ReferenceStatus] => [from, to]),
);

describe('the production state machine equals the PRD 9.1 reference model', () => {
  it('agrees on all 64 ordered pairs', () => {
    const disagreements = ALL_PAIRS.filter(
      ([from, to]) => canTransition(from, to) !== referenceAllows(from, to),
    ).map(([from, to]) => `${from} -> ${to}`);
    expect(disagreements).toStrictEqual([]);
  });

  it('agrees on which states are terminal', () => {
    const disagreements = REFERENCE_STATUS_ORDER.filter(
      (status) => isTerminalStatus(status) !== referenceIsTerminal(status),
    );
    expect(disagreements).toStrictEqual([]);
  });

  it('agrees on the ordinal of every state', () => {
    for (const [ordinal, name] of REFERENCE_STATUS_ORDER.entries()) {
      expect(CovenantStatus[name]).toBe(ordinal);
    }
    expect([...allCovenantStatusNames()]).toStrictEqual([...REFERENCE_STATUS_ORDER]);
  });

  it('permits exactly the ten edges the model draws', () => {
    const permitted = ALL_PAIRS.filter(([from, to]) => canTransition(from, to)).map(
      ([from, to]) => `${from} -> ${to}`,
    );
    expect(permitted).toStrictEqual(
      referenceAllowedPairs().map(([from, to]) => `${from} -> ${to}`),
    );
    expect(permitted).toHaveLength(10);
  });

  it('keeps the model itself well formed, so a typo cannot quietly widen it', () => {
    expect(REFERENCE_TRANSITION_TABLE).toHaveLength(REFERENCE_STATUS_ORDER.length);
    for (const row of REFERENCE_TRANSITION_TABLE) {
      expect(row).toMatch(/^[.X]{8}$/);
    }
  });
});

/**
 * Named regression tests for the exact defects the independent review demonstrated. Each of
 * these passed under the Phase 0 suite.
 */
describe('regressions the Phase 0 suite could not see', () => {
  it.each([
    ['DRAFT', 'EXECUTING'],
    ['DRAFT', 'SATISFIED'],
    ['DRAFT', 'TRIGGERED'],
    ['ARMED', 'SATISFIED'],
    ['ARMED', 'EXECUTING'],
    ['EXECUTING', 'ARMED'],
    ['EXECUTING', 'TRIGGERED'],
    ['TRIGGERED', 'ARMED'],
  ] as [ReferenceStatus, ReferenceStatus][])('forbids %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('leaves no terminal state, including into another terminal state', () => {
    for (const from of REFERENCE_STATUS_ORDER) {
      if (!referenceIsTerminal(from)) continue;
      for (const to of REFERENCE_STATUS_ORDER) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
  });

  it('never reports every state as non-terminal, or every state as terminal', () => {
    const terminal = REFERENCE_STATUS_ORDER.filter(isTerminalStatus);
    expect(terminal).toStrictEqual(['SATISFIED', 'EXPIRED', 'CANCELLED']);
  });

  it('reaches SATISFIED only from TRIGGERED and EXECUTING, so the fee cannot bypass the trigger', () => {
    const predecessors = REFERENCE_STATUS_ORDER.filter((from) => canTransition(from, 'SATISFIED'));
    expect(predecessors).toStrictEqual(['TRIGGERED', 'EXECUTING']);
  });

  it('makes expiry and cancellation irreversible', () => {
    for (const to of REFERENCE_STATUS_ORDER) {
      expect(canTransition('EXPIRED', to), `EXPIRED -> ${to}`).toBe(false);
      expect(canTransition('CANCELLED', to), `CANCELLED -> ${to}`).toBe(false);
    }
  });
});

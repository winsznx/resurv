import { describe, expect, it } from 'vitest';
import {
  ATTEMPT_STATES,
  type AttemptState,
  allAttemptStates,
  allowedAttemptTransitions,
  type ChainEvidence,
  canTransitionAttempt,
  classifyBroadcastResponse,
  classifyChainEvidence,
  isTerminalAttemptState,
  mayStartAnotherSemanticAction,
  mustReplaySameIdempotencyKey,
} from '../src/attempt-state.ts';
import {
  REFERENCE_ATTEMPT_ORDER,
  type ReferenceAttemptState,
  referenceAttemptAllowedPairs,
  referenceAttemptAllows,
  referenceAttemptIsTerminal,
  referenceAttemptMayAdvance,
} from './model/attempt-state-reference.ts';

/**
 * The oracle is `./model/attempt-state-reference.ts`, transcribed from the Phase 0.5 report and
 * structurally unlike production. Nothing here asks the implementation what to try.
 *
 * Adversarially checked by mutation on 2026-08-12. Each of these edits to
 * `src/attempt-state.ts` was applied in turn and every one failed at least one test here:
 *   1. adding `RECONCILIATION_REQUIRED` to `TRANSITIONS.KEY_COMMITTED`'s peer `SIMULATED_OK`
 *   2. adding `'KEY_COMMITTED'` to `AMBIGUOUS`'s complement by removing it from the set
 *   3. `classifyChainEvidence` returning CONFIRMED when `expectedEventPresent` is false
 *   4. `classifyChainEvidence` ignoring `innerFailureSignalled`
 *   5. `classifyBroadcastResponse` returning EXECUTED_NO_EFFECT for any HTTP 202
 *   6. `classifyChainEvidence` returning PROVEN_NOT_BROADCAST before the settlement window
 */

const ALL = REFERENCE_ATTEMPT_ORDER;

function asProduction(state: ReferenceAttemptState): AttemptState {
  return state;
}

describe('attempt state machine, against an independent reference model', () => {
  it('has the same state set as the reference model, in the same order', () => {
    expect([...ATTEMPT_STATES]).toEqual([...REFERENCE_ATTEMPT_ORDER]);
    expect(allAttemptStates()).toHaveLength(10);
  });

  it('agrees with the reference model on all 100 ordered pairs', () => {
    const disagreements: string[] = [];
    for (const from of ALL) {
      for (const to of ALL) {
        const production = canTransitionAttempt(asProduction(from), asProduction(to));
        const model = referenceAttemptAllows(from, to);
        if (production !== model) {
          disagreements.push(`${from} -> ${to}: production ${production}, model ${model}`);
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('agrees with the reference model on which states are terminal', () => {
    for (const state of ALL) {
      expect(isTerminalAttemptState(asProduction(state))).toBe(referenceAttemptIsTerminal(state));
    }
  });

  it('agrees with the reference model on which states permit another semantic action', () => {
    for (const state of ALL) {
      expect(mayStartAnotherSemanticAction(asProduction(state))).toBe(
        referenceAttemptMayAdvance(state),
      );
    }
  });

  it('permits exactly the ten transitions the report draws', () => {
    expect(referenceAttemptAllowedPairs()).toHaveLength(10);
    const produced: string[] = [];
    for (const from of ALL) {
      for (const to of allowedAttemptTransitions(asProduction(from)))
        produced.push(`${from}->${to}`);
    }
    expect(produced.sort()).toEqual(
      [
        'KEY_COMMITTED->EXECUTED_NO_EFFECT',
        'KEY_COMMITTED->RECONCILIATION_REQUIRED',
        'PLANNED->REJECTED_LOCALLY',
        'PLANNED->SIMULATED_OK',
        'PLANNED->SIMULATION_REJECTED',
        'RECONCILIATION_REQUIRED->CONFIRMED',
        'RECONCILIATION_REQUIRED->PROVEN_NOT_BROADCAST',
        'RECONCILIATION_REQUIRED->RECONCILIATION_REQUIRED',
        'RECONCILIATION_REQUIRED->REVERTED',
        'SIMULATED_OK->KEY_COMMITTED',
      ].sort(),
    );
  });

  it('makes every terminal state absorbing', () => {
    for (const state of ALL) {
      if (!referenceAttemptIsTerminal(state)) continue;
      expect(allowedAttemptTransitions(asProduction(state))).toEqual([]);
    }
  });

  it('permits exactly one self-transition, and it is the bounded reconciliation loop', () => {
    const selfLoops = ALL.filter((state) => canTransitionAttempt(state, state));
    expect(selfLoops).toEqual(['RECONCILIATION_REQUIRED']);
  });

  it('treats replay-only and may-advance as exact complements', () => {
    for (const state of ALL) {
      expect(mustReplaySameIdempotencyKey(asProduction(state))).toBe(
        !mayStartAnotherSemanticAction(asProduction(state)),
      );
    }
  });

  it('forbids advancing from the two states where an effect may still be in flight', () => {
    expect(mayStartAnotherSemanticAction('KEY_COMMITTED')).toBe(false);
    expect(mayStartAnotherSemanticAction('RECONCILIATION_REQUIRED')).toBe(false);
  });

  it('reaches every state from PLANNED', () => {
    const seen = new Set<AttemptState>(['PLANNED']);
    const queue: AttemptState[] = ['PLANNED'];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) continue;
      for (const next of allowedAttemptTransitions(current)) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    expect([...seen].sort()).toEqual([...ALL].sort());
  });

  it('has no path out of KEY_COMMITTED that reaches a may-advance state without chain evidence', () => {
    // Every state reachable from KEY_COMMITTED that permits another action is terminal, and
    // every one of those terminal states is entered only by classifyChainEvidence or by the
    // EXECUTED_NO_EFFECT shape, both of which require a chain read.
    const reachable = new Set<AttemptState>();
    const queue: AttemptState[] = ['KEY_COMMITTED'];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) continue;
      for (const next of allowedAttemptTransitions(current)) {
        if (reachable.has(next)) continue;
        reachable.add(next);
        queue.push(next);
      }
    }
    for (const state of reachable) {
      if (mayStartAnotherSemanticAction(state)) expect(isTerminalAttemptState(state)).toBe(true);
    }
  });
});

describe('classifyBroadcastResponse, against the measured responses', () => {
  it('classifies the P09 refusal shape as a candidate no-effect that still needs the chain', () => {
    // Measured: HTTP 202, status failed, null hash, empty receipts, zero onchain effects.
    const result = classifyBroadcastResponse({
      httpStatus: 202,
      bodyStatus: 'failed',
      transactionHash: null,
      receiptCount: 0,
      transportError: undefined,
    });
    expect(result.candidate).toBe('EXECUTED_NO_EFFECT');
    expect(result.requiresChainConfirmation).toBe(true);
  });

  it('refuses to read the P05 success shape as anything but reconciliation', () => {
    // Measured: HTTP 202, status completed, and the hash only on the status endpoint. The 202
    // itself proves nothing, which is the whole finding.
    const result = classifyBroadcastResponse({
      httpStatus: 202,
      bodyStatus: 'completed',
      transactionHash: undefined,
      receiptCount: undefined,
      transportError: undefined,
    });
    expect(result.candidate).toBe('RECONCILIATION_REQUIRED');
  });

  it('does not let a 202 alone produce a no-effect classification', () => {
    const result = classifyBroadcastResponse({
      httpStatus: 202,
      bodyStatus: undefined,
      transactionHash: null,
      receiptCount: 0,
      transportError: undefined,
    });
    expect(result.candidate).toBe('RECONCILIATION_REQUIRED');
  });

  it('does not let a failed status with a transaction hash produce a no-effect classification', () => {
    const result = classifyBroadcastResponse({
      httpStatus: 202,
      bodyStatus: 'failed',
      transactionHash: '0xabc',
      receiptCount: 0,
      transportError: undefined,
    });
    expect(result.candidate).toBe('RECONCILIATION_REQUIRED');
  });

  it('does not let a failed status with receipts produce a no-effect classification', () => {
    const result = classifyBroadcastResponse({
      httpStatus: 202,
      bodyStatus: 'failed',
      transactionHash: null,
      receiptCount: 1,
      transportError: undefined,
    });
    expect(result.candidate).toBe('RECONCILIATION_REQUIRED');
  });

  it('classifies a lost response as reconciliation, never as failure', () => {
    const result = classifyBroadcastResponse({
      httpStatus: undefined,
      bodyStatus: undefined,
      transactionHash: undefined,
      receiptCount: undefined,
      transportError: 'AbortError: probe-abort',
    });
    expect(result.candidate).toBe('RECONCILIATION_REQUIRED');
    expect(result.reason).toContain('may or may not');
  });

  it('classifies both 409 codes as reconciliation rather than as an outcome', () => {
    for (const status of [409, 429, 500, 503]) {
      expect(
        classifyBroadcastResponse({
          httpStatus: status,
          bodyStatus: undefined,
          transactionHash: undefined,
          receiptCount: undefined,
          transportError: undefined,
        }).candidate,
      ).toBe('RECONCILIATION_REQUIRED');
    }
  });
});

describe('classifyChainEvidence', () => {
  const base: ChainEvidence = {
    originsAgreed: true,
    receiptStatus: undefined,
    expectedEventPresent: false,
    innerFailureSignalled: false,
    attributableEffectFound: false,
    settlementWindowElapsed: false,
  };

  /** The whole input space: 3 receipt statuses x 2^5 booleans. */
  function* cube(): Generator<ChainEvidence> {
    const statuses: ChainEvidence['receiptStatus'][] = ['0x1', '0x0', undefined];
    for (const receiptStatus of statuses) {
      for (let bits = 0; bits < 32; bits += 1) {
        yield {
          receiptStatus,
          originsAgreed: (bits & 1) !== 0,
          expectedEventPresent: (bits & 2) !== 0,
          innerFailureSignalled: (bits & 4) !== 0,
          attributableEffectFound: (bits & 8) !== 0,
          settlementWindowElapsed: (bits & 16) !== 0,
        };
      }
    }
  }

  it('never returns CONFIRMED without agreement, a 0x1 receipt, the expected event, and no inner failure', () => {
    for (const evidence of cube()) {
      if (classifyChainEvidence(evidence).state !== 'CONFIRMED') continue;
      expect(evidence.originsAgreed).toBe(true);
      expect(evidence.receiptStatus).toBe('0x1');
      expect(evidence.expectedEventPresent).toBe(true);
      expect(evidence.innerFailureSignalled).toBe(false);
    }
  });

  it('never returns a terminal state when the origins disagree', () => {
    for (const evidence of cube()) {
      if (evidence.originsAgreed) continue;
      expect(classifyChainEvidence(evidence).state).toBe('RECONCILIATION_REQUIRED');
    }
  });

  it('never returns PROVEN_NOT_BROADCAST while an effect is visible or the window is open', () => {
    for (const evidence of cube()) {
      if (classifyChainEvidence(evidence).state !== 'PROVEN_NOT_BROADCAST') continue;
      expect(evidence.attributableEffectFound).toBe(false);
      expect(evidence.settlementWindowElapsed).toBe(true);
      expect(evidence.receiptStatus).toBeUndefined();
    }
  });

  it('only ever returns states that RECONCILIATION_REQUIRED can legally reach', () => {
    for (const evidence of cube()) {
      const { state } = classifyChainEvidence(evidence);
      expect(canTransitionAttempt('RECONCILIATION_REQUIRED', state)).toBe(true);
    }
  });

  it('confirms the measured success shape', () => {
    expect(
      classifyChainEvidence({
        ...base,
        receiptStatus: '0x1',
        expectedEventPresent: true,
      }).state,
    ).toBe('CONFIRMED');
  });

  it('treats an inner failure on a successful outer receipt as REVERTED (T15)', () => {
    expect(
      classifyChainEvidence({
        ...base,
        receiptStatus: '0x1',
        expectedEventPresent: true,
        innerFailureSignalled: true,
      }).state,
    ).toBe('REVERTED');
  });

  it('refuses to confirm a successful receipt whose expected event is missing', () => {
    expect(
      classifyChainEvidence({ ...base, receiptStatus: '0x1', expectedEventPresent: false }).state,
    ).toBe('RECONCILIATION_REQUIRED');
  });

  it('classifies a reverted receipt as REVERTED', () => {
    expect(classifyChainEvidence({ ...base, receiptStatus: '0x0' }).state).toBe('REVERTED');
  });

  it('does not promote an absent receipt before the settlement window', () => {
    expect(classifyChainEvidence({ ...base, settlementWindowElapsed: false }).state).toBe(
      'RECONCILIATION_REQUIRED',
    );
  });

  it('proves nothing was broadcast once the window has elapsed with no effect', () => {
    expect(classifyChainEvidence({ ...base, settlementWindowElapsed: true }).state).toBe(
      'PROVEN_NOT_BROADCAST',
    );
  });

  it('keeps reconciling when an effect exists but its receipt has not been read', () => {
    expect(
      classifyChainEvidence({
        ...base,
        attributableEffectFound: true,
        settlementWindowElapsed: true,
      }).state,
    ).toBe('RECONCILIATION_REQUIRED');
  });
});

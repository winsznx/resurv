import { describe, expect, it } from 'vitest';
import {
  allCovenantStatusNames,
  allowedTransitions,
  CovenantStatus,
  canTransition,
  covenantStatusName,
  isTerminalStatus,
} from '../src/covenant-status.ts';
import {
  isTerminalOrchestrationState,
  ORCHESTRATION_STATES,
  requiresIdempotentRecovery,
} from '../src/orchestration-state.ts';

describe('CovenantStatus ordinals', () => {
  it('starts at NONE = 0 so an unset struct decodes as NONE, not DRAFT', () => {
    expect(CovenantStatus.NONE).toBe(0);
  });

  it('is contiguous and gap-free, matching Solidity enum encoding', () => {
    const values = allCovenantStatusNames().map((name) => CovenantStatus[name]);
    expect(values).toStrictEqual(values.map((_, index) => index));
  });

  it('round-trips every ordinal through covenantStatusName', () => {
    for (const name of allCovenantStatusNames()) {
      expect(covenantStatusName(CovenantStatus[name])).toBe(name);
    }
  });

  it('rejects an out-of-range ordinal instead of guessing', () => {
    expect(() => covenantStatusName(99)).toThrow(RangeError);
    expect(() => covenantStatusName(-1)).toThrow(RangeError);
  });
});

describe('covenant transitions', () => {
  it('permits exactly the PRD 9.1 happy path', () => {
    expect(canTransition('NONE', 'DRAFT')).toBe(true);
    expect(canTransition('DRAFT', 'ARMED')).toBe(true);
    expect(canTransition('ARMED', 'TRIGGERED')).toBe(true);
    expect(canTransition('TRIGGERED', 'EXECUTING')).toBe(true);
    expect(canTransition('EXECUTING', 'SATISFIED')).toBe(true);
  });

  it('allows TRIGGERED to reach SATISFIED directly, since a single atomic attempt settles', () => {
    expect(canTransition('TRIGGERED', 'SATISFIED')).toBe(true);
  });

  it('never leaves a terminal state', () => {
    for (const name of allCovenantStatusNames()) {
      if (!isTerminalStatus(name)) continue;
      expect(allowedTransitions(name)).toStrictEqual([]);
    }
  });

  it('treats SATISFIED, EXPIRED and CANCELLED as the only terminal states', () => {
    const terminal = allCovenantStatusNames().filter(isTerminalStatus);
    expect(terminal).toStrictEqual(['SATISFIED', 'EXPIRED', 'CANCELLED']);
  });

  it('forbids cancelling once triggered', () => {
    expect(canTransition('TRIGGERED', 'CANCELLED')).toBe(false);
    expect(canTransition('EXECUTING', 'CANCELLED')).toBe(false);
  });

  it('forbids resurrecting a satisfied covenant, which would re-release the fee', () => {
    expect(canTransition('SATISFIED', 'TRIGGERED')).toBe(false);
    expect(canTransition('SATISFIED', 'EXECUTING')).toBe(false);
    expect(canTransition('SATISFIED', 'ARMED')).toBe(false);
  });

  it('forbids arming a cancelled or expired covenant', () => {
    expect(canTransition('CANCELLED', 'ARMED')).toBe(false);
    expect(canTransition('EXPIRED', 'ARMED')).toBe(false);
  });

  it('forbids skipping the trigger, so an attempt cannot run on an unarmed covenant', () => {
    expect(canTransition('ARMED', 'EXECUTING')).toBe(false);
    expect(canTransition('ARMED', 'SATISFIED')).toBe(false);
    expect(canTransition('DRAFT', 'TRIGGERED')).toBe(false);
  });

  it('rejects self-transitions for every state', () => {
    for (const name of allCovenantStatusNames()) {
      expect(canTransition(name, name)).toBe(false);
    }
  });

  it('never lists a transition into NONE', () => {
    for (const name of allCovenantStatusNames()) {
      expect(allowedTransitions(name)).not.toContain('NONE');
    }
  });
});

describe('orchestration state', () => {
  it('marks every non-progressing state terminal', () => {
    const terminal = ORCHESTRATION_STATES.filter(isTerminalOrchestrationState);
    expect(terminal).toStrictEqual([
      'SATISFIED',
      'EXHAUSTED',
      'EXPIRED',
      'ESCALATED',
      'FAILED_INTERNAL',
    ]);
  });

  it('flags the three states where a broadcast may already be in flight', () => {
    const inFlight = ORCHESTRATION_STATES.filter(requiresIdempotentRecovery);
    expect(inFlight).toStrictEqual(['SUBMITTING', 'AWAITING_KEEPERHUB', 'AWAITING_CONFIRMATIONS']);
  });

  it('never treats an in-flight state as terminal, which would strand a live execution', () => {
    for (const state of ORCHESTRATION_STATES) {
      if (!requiresIdempotentRecovery(state)) continue;
      expect(isTerminalOrchestrationState(state)).toBe(false);
    }
  });
});

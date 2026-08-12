/**
 * The attempt lifecycle, as measured.
 *
 * This is not the lifecycle RESURV was designed against. The Phase 0.5 seam probe measured
 * KeeperHub live on 2026-08-12 and falsified three of the previous model's entry conditions:
 * `ACCEPTED` was entered by "a 2xx carrying an executionId", which a refused attempt that never
 * reached the chain also satisfies; `PENDING` assumed an asynchronous POST that is in fact
 * synchronous; and `ACCEPTED -> REVERTED` was unreachable because a call whose gas estimation
 * reverts is refused before broadcast.
 *
 * The states and transitions below are transcribed from
 * `docs/phase-logs/PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md` section 8, and the advancement
 * rule from section 9. ADR-013 records the decision.
 *
 * One sentence governs everything here:
 *
 *   An HTTP status never advances a covenant. Chain evidence does.
 */

export const ATTEMPT_STATES = [
  /** A semantic attempt id, a canonical body and its hash exist. Nothing has been sent. */
  'PLANNED',
  /** Refused before a socket opened. Terminal, and nothing external happened. */
  'REJECTED_LOCALLY',
  /** HTTP 400 carrying `wouldRevert: true`. Nothing was broadcast. */
  'SIMULATION_REJECTED',
  /** HTTP 200 carrying `wouldRevert: false`. Nothing was broadcast. */
  'SIMULATED_OK',
  /**
   * The idempotency key and canonical body hash are durably written and the request may or may
   * not have been sent. This is the state a crash lands in, and it is the reason the durable
   * write happens first.
   */
  'KEY_COMMITTED',
  /**
   * A response whose body `status` is `failed`, whose `transactionHash` is null and whose
   * `receipts` array is empty, confirmed by a chain read that finds no effect. Measured as the
   * *common* outcome for a refused action rather than an edge case.
   */
  'EXECUTED_NO_EFFECT',
  /**
   * Anything else. No response, a 409, a timeout, an unrecognized status, or a `completed` not
   * yet confirmed on chain. The definition is the absence of evidence, which is why nothing
   * promotes an attempt out of it on elapsed time.
   */
  'RECONCILIATION_REQUIRED',
  /** Chain receipt `0x1`, expected event present, no inner-failure signal, two origins agreeing. */
  'CONFIRMED',
  /** Chain receipt `0x0`, or an inner-failure signal on a receipt that otherwise succeeded. */
  'REVERTED',
  /** The key replay reports no prior commit and no effect exists after the settlement window. */
  'PROVEN_NOT_BROADCAST',
] as const;

export type AttemptState = (typeof ATTEMPT_STATES)[number];

/**
 * Terminal states. Every one of them was entered on chain evidence or on the proven absence of
 * an effect, except the two that never reached a socket.
 */
const TERMINAL: ReadonlySet<AttemptState> = new Set<AttemptState>([
  'REJECTED_LOCALLY',
  'SIMULATION_REJECTED',
  'EXECUTED_NO_EFFECT',
  'CONFIRMED',
  'REVERTED',
  'PROVEN_NOT_BROADCAST',
]);

/**
 * States in which an economic effect may still be produced by a request already in flight.
 * From either of these RESURV may only repeat the same idempotency key with the same body.
 */
const AMBIGUOUS: ReadonlySet<AttemptState> = new Set<AttemptState>([
  'KEY_COMMITTED',
  'RECONCILIATION_REQUIRED',
]);

/**
 * Legal transitions. `RECONCILIATION_REQUIRED -> RECONCILIATION_REQUIRED` is deliberate and is
 * the one self-transition in either RESURV state machine: a reconciliation round that resolves
 * nothing leaves the attempt exactly where it was, and modelling that as "no transition" would
 * hide the bounded retry loop from every test that walks the graph.
 */
const TRANSITIONS: Readonly<Record<AttemptState, readonly AttemptState[]>> = {
  PLANNED: ['REJECTED_LOCALLY', 'SIMULATION_REJECTED', 'SIMULATED_OK'],
  REJECTED_LOCALLY: [],
  SIMULATION_REJECTED: [],
  SIMULATED_OK: ['KEY_COMMITTED'],
  KEY_COMMITTED: ['EXECUTED_NO_EFFECT', 'RECONCILIATION_REQUIRED'],
  EXECUTED_NO_EFFECT: [],
  RECONCILIATION_REQUIRED: [
    'CONFIRMED',
    'REVERTED',
    'PROVEN_NOT_BROADCAST',
    'RECONCILIATION_REQUIRED',
  ],
  CONFIRMED: [],
  REVERTED: [],
  PROVEN_NOT_BROADCAST: [],
};

export function isTerminalAttemptState(state: AttemptState): boolean {
  return TERMINAL.has(state);
}

export function canTransitionAttempt(from: AttemptState, to: AttemptState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedAttemptTransitions(from: AttemptState): readonly AttemptState[] {
  return TRANSITIONS[from];
}

/**
 * The advancement rule, PHASE_00_5 section 9.
 *
 * > RESURV may begin another semantic recovery action only when the previous attempt is in
 * > `REJECTED_LOCALLY`, `SIMULATION_REJECTED`, `EXECUTED_NO_EFFECT`, `CONFIRMED`, `REVERTED` or
 * > `PROVEN_NOT_BROADCAST`.
 *
 * `PLANNED` and `SIMULATED_OK` also permit it, because nothing has been sent in either: the
 * measured hazard begins at the durable key commit, not at the plan.
 */
export function mayStartAnotherSemanticAction(state: AttemptState): boolean {
  return !AMBIGUOUS.has(state);
}

/**
 * The complement, stated positively because it is the rule that costs money when it is broken:
 * from here the only legal external act is replaying the *same* idempotency key with a
 * byte-identical body. Not a new key, not a different action, and never a promotion on a timer.
 */
export function mustReplaySameIdempotencyKey(state: AttemptState): boolean {
  return AMBIGUOUS.has(state);
}

export function allAttemptStates(): readonly AttemptState[] {
  return ATTEMPT_STATES;
}

/**
 * What a broadcast response can establish on its own, which is less than it looks.
 *
 * Measured (`P05` against `P09`): HTTP 202 with an `executionId` is returned both by an
 * execution that landed and by one that never reached the chain. So this classifier reads the
 * body, never the status code, and its most positive answer is still a candidate that a chain
 * read has to confirm.
 */
export interface BroadcastResponseFacts {
  /** Undefined when no HTTP response arrived at all. Not merged with a 5xx. */
  readonly httpStatus: number | undefined;
  /** The body's own `status` field, lowercased by the caller. Undefined when unparseable. */
  readonly bodyStatus: string | undefined;
  readonly transactionHash: string | null | undefined;
  /** Length of the response's `receipts` array. Undefined when the field was absent. */
  readonly receiptCount: number | undefined;
  readonly transportError: string | undefined;
}

export interface BroadcastClassification {
  /**
   * The state this response points at. `EXECUTED_NO_EFFECT` still requires the chain read named
   * in `requiresChainConfirmation` before an attempt may be moved into it.
   */
  readonly candidate: Extract<AttemptState, 'EXECUTED_NO_EFFECT' | 'RECONCILIATION_REQUIRED'>;
  readonly requiresChainConfirmation: boolean;
  readonly reason: string;
}

export function classifyBroadcastResponse(facts: BroadcastResponseFacts): BroadcastClassification {
  if (facts.transportError !== undefined || facts.httpStatus === undefined) {
    return {
      candidate: 'RECONCILIATION_REQUIRED',
      requiresChainConfirmation: true,
      reason: 'no HTTP response arrived; the request may or may not have committed',
    };
  }

  const noEffectShape =
    facts.bodyStatus === 'failed' &&
    (facts.transactionHash === null || facts.transactionHash === undefined) &&
    facts.receiptCount === 0;

  if (noEffectShape) {
    return {
      candidate: 'EXECUTED_NO_EFFECT',
      requiresChainConfirmation: true,
      reason:
        'body status failed, null transaction hash and no receipts; confirm no effect on chain before believing it',
    };
  }

  return {
    candidate: 'RECONCILIATION_REQUIRED',
    requiresChainConfirmation: true,
    reason: `HTTP ${facts.httpStatus} with body status ${facts.bodyStatus ?? 'absent'} establishes nothing on its own`,
  };
}

/**
 * What the chain establishes. This is the only function in RESURV allowed to produce a terminal
 * attempt state that involves an onchain effect.
 *
 * Every field is a fact somebody had to go and get. `originsAgreed` is a projection comparison,
 * not a byte comparison: OP-stack nodes differ on optional L1-fee fields, key order and hex
 * casing, and a check that cries wolf on every reconciliation is worse than no check.
 * See PHASE_00_5 section 4.
 */
export interface ChainEvidence {
  /** False when the two pinned RPC origins materially disagree about the receipt. */
  readonly originsAgreed: boolean;
  /** `0x1`, `0x0`, or undefined when no receipt exists at either origin. */
  readonly receiptStatus: '0x1' | '0x0' | undefined;
  /** The RESURV event the attempt was supposed to emit was found in the receipt's logs. */
  readonly expectedEventPresent: boolean;
  /**
   * KeeperHub's own inner-failure signal: `result.executedCall.reverted === true`, or a
   * `receipts[].receiptStatus` of `safe_inner_failure`. Never the outer receipt status.
   * Documented, never observed by this project. `docs/THREAT_MODEL.md` T15.
   */
  readonly innerFailureSignalled: boolean;
  /** An effect attributable to this semantic attempt was found by searching chain logs. */
  readonly attributableEffectFound: boolean;
  /** Whether enough blocks have passed that absence is evidence rather than impatience. */
  readonly settlementWindowElapsed: boolean;
}

export interface ChainClassification {
  readonly state: Extract<
    AttemptState,
    'CONFIRMED' | 'REVERTED' | 'PROVEN_NOT_BROADCAST' | 'RECONCILIATION_REQUIRED'
  >;
  readonly reason: string;
}

export function classifyChainEvidence(evidence: ChainEvidence): ChainClassification {
  if (!evidence.originsAgreed) {
    return {
      state: 'RECONCILIATION_REQUIRED',
      reason: 'two RPC origins materially disagree; a disagreement is not a tie to break',
    };
  }

  if (evidence.receiptStatus === '0x0') {
    return { state: 'REVERTED', reason: 'receipt status 0x0' };
  }

  if (evidence.receiptStatus === '0x1') {
    if (evidence.innerFailureSignalled) {
      return {
        state: 'REVERTED',
        reason: 'outer transaction succeeded and the inner call did not (T15)',
      };
    }
    if (!evidence.expectedEventPresent) {
      return {
        state: 'RECONCILIATION_REQUIRED',
        reason: 'receipt succeeded but the expected RESURV event is absent from its logs',
      };
    }
    return {
      state: 'CONFIRMED',
      reason: 'receipt 0x1 at two agreeing origins, expected event present, no inner failure',
    };
  }

  if (evidence.attributableEffectFound) {
    return {
      state: 'RECONCILIATION_REQUIRED',
      reason: 'an effect exists on chain but its receipt has not been read yet',
    };
  }

  if (evidence.settlementWindowElapsed) {
    return {
      state: 'PROVEN_NOT_BROADCAST',
      reason: 'no receipt and no attributable effect after the settlement window',
    };
  }

  return {
    state: 'RECONCILIATION_REQUIRED',
    reason: 'no receipt yet, and the settlement window has not elapsed; absence is not evidence',
  };
}

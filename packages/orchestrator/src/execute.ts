/**
 * One semantic attempt, executed against the measured seam.
 *
 * The write order is the whole design and it is not negotiable:
 *
 *   derive the semantic attempt id
 *   -> persist the canonical body and the idempotency key durably
 *   -> commit
 *   -> send to KeeperHub
 *   -> persist the response
 *   -> reconcile independently against chain
 *   -> only then transition
 *
 * The inverse order, send and then try to remember what was sent, is unrecoverable: the 202
 * carries no transaction hash, there is no list-executions endpoint, and a lost response is
 * indistinguishable from a lost request without the stored key.
 */

import type { RpcOptions, RpcReceipt } from '@resurv/chain';
import { getBlockNumber, getLogs, getReceipt, SETTLEMENT_WINDOW_MS } from '@resurv/chain';
import {
  type AttemptState,
  classifyBroadcastResponse,
  classifyChainEvidence,
  mustReplaySameIdempotencyKey,
} from '@resurv/domain';
import {
  IDEMPOTENCY_CONFLICT,
  IDEMPOTENCY_IN_PROGRESS,
  type KeeperhubClient,
  type KeeperhubExchange,
  readBodyStatus,
  readExecutionId,
  readGasUsed,
  readInnerFailure,
  readReceipts,
  readSponsored,
  readTransactionHash,
  readTransactionLink,
} from '@resurv/keeperhub-client';
import type { AttemptRecord, AttemptStore } from './store.ts';

/**
 * The onchain marker this attempt is supposed to leave.
 *
 * It does two jobs, and the second is the one that matters. It confirms a receipt genuinely
 * contains the attempt's effect, so a transaction that succeeded for some other reason cannot be
 * read as success. And it is searchable, so an attempt whose response was lost can be found on
 * chain by its own marker rather than by an execution id nobody received. `P11` recovered
 * exactly that way in Phase 0.5, from `eth_getLogs` alone.
 */
export interface ExpectedEffect {
  /** The contract expected to emit. Omitted means any address. */
  readonly address?: string | undefined;
  /** Topic filter, `null` for a wildcard position, as `eth_getLogs` takes it. */
  readonly topics: readonly (string | null)[];
  /** Extra check against a candidate log, for anything topics cannot express. */
  readonly matches?: ((log: { topics: readonly string[]; data: string }) => boolean) | undefined;
}

export interface AttemptPlan {
  readonly semanticAttemptId: string;
  readonly covenantId: string;
  readonly actionIndex: number;
  readonly attemptSequence: number;
  readonly expectedStateHash: string | undefined;
  /** Byte-exact request body. Stored before sending and replayed verbatim. */
  readonly canonicalBody: string;
  readonly canonicalBodyHash: string;
  readonly idempotencyKey: string;
  readonly expectedEffect: ExpectedEffect;
  /** Block height before anything was sent, so a log search has a floor. */
  readonly fromBlock: number;
}

export interface AttemptOutcome {
  readonly state: AttemptState;
  readonly record: AttemptRecord;
  readonly transactionHash: string | undefined;
  readonly transactionLink: string | undefined;
  readonly executionId: string | undefined;
  readonly receipt: RpcReceipt | null | undefined;
  readonly originsAgreed: boolean;
  readonly sponsored: boolean | undefined;
  readonly gasUsed: string | undefined;
  readonly innerFailureSignalled: boolean;
  readonly exchanges: readonly KeeperhubExchange[];
  readonly reason: string;
}

export interface ExecuteOptions {
  readonly store: AttemptStore;
  readonly keeperhub: KeeperhubClient;
  readonly rpc?: RpcOptions;
  /** Bounded. The loop leaves on evidence; this only stops it running forever. */
  readonly maxReconciliationRounds?: number;
  readonly settlementWindowMs?: number;
  readonly waitMs?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly log?: (message: string) => void;
}

const DEFAULT_MAX_ROUNDS = 12;
const DEFAULT_ROUND_DELAY_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute one semantic attempt and return the state the evidence supports.
 *
 * Never throws for a KeeperHub outcome. The only exceptions that escape are programming errors
 * and a store that cannot write, and the second one is fatal on purpose: an attempt whose key
 * could not be persisted must not be sent.
 */
export async function executeSemanticAttempt(
  plan: AttemptPlan,
  options: ExecuteOptions,
): Promise<AttemptOutcome> {
  const log = options.log ?? (() => {});
  const wait = options.waitMs ?? sleep;
  const now = options.now ?? (() => Date.now());
  const exchanges: KeeperhubExchange[] = [];
  const record = (exchange: KeeperhubExchange): void => {
    exchanges.push(exchange);
  };

  // 1. Durable claim, before anything leaves the process.
  const timestamp = new Date().toISOString();
  const reserved = await options.store.reserve({
    semanticAttemptId: plan.semanticAttemptId,
    covenantId: plan.covenantId,
    actionIndex: plan.actionIndex,
    attemptSequence: plan.attemptSequence,
    expectedStateHash: plan.expectedStateHash,
    canonicalBody: plan.canonicalBody,
    canonicalBodyHash: plan.canonicalBodyHash,
    idempotencyKey: plan.idempotencyKey,
    fromBlock: plan.fromBlock,
    state: 'KEY_COMMITTED',
    executionId: undefined,
    transactionHash: undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
    reconciliationRounds: 0,
    note: undefined,
  });

  if (!reserved.created) {
    // Somebody already claimed this attempt. Whether it was a previous run of this process or
    // another worker, the only legal move is to reconcile the existing one. Sending again under
    // a fresh key would buy a second economic effect: measured, `P08`.
    log(`attempt ${plan.semanticAttemptId} already claimed in state ${reserved.record.state}`);
    if (!mustReplaySameIdempotencyKey(reserved.record.state)) {
      return finish(reserved.record, reserved.record.state, exchanges, 'already terminal', {
        originsAgreed: true,
      });
    }
  }

  // 2. Send. A replay of an existing claim sends the stored body, not a re-serialization.
  const bodyToSend = reserved.created ? plan.canonicalBody : reserved.record.canonicalBody;
  const keyToSend = reserved.created ? plan.idempotencyKey : reserved.record.idempotencyKey;

  const response = await options.keeperhub.execute(bodyToSend, keyToSend, plan.canonicalBodyHash);
  record(response);

  const executionId = readExecutionId(response.body);
  if (executionId !== undefined) {
    await options.store.update(plan.semanticAttemptId, { executionId });
  }

  // 3. Classify the response. Its most positive answer is still a candidate.
  const classification = classifyBroadcastResponse({
    httpStatus: response.httpStatus,
    bodyStatus: readBodyStatus(response.body),
    transactionHash: readTransactionHash(response.body),
    receiptCount: readReceipts(response.body)?.length,
    transportError: response.transportError,
  });
  log(`broadcast classified ${classification.candidate}: ${classification.reason}`);

  // 4. Reconcile against chain. Even the no-effect candidate goes through here, because the
  //    only thing that may confirm "nothing happened" is the chain saying so.
  //
  //    Both anchors come from the durable record rather than from this invocation. The
  //    settlement window measures time since the key was committed, so a resumed process does
  //    not restart the clock and can actually reach `PROVEN_NOT_BROADCAST`; and the log search
  //    starts at the head this attempt started from, so a resumed process cannot skip over the
  //    block its own transaction landed in.
  const committedAt = Date.parse(reserved.record.createdAt);
  return reconcile(plan, options, {
    exchanges,
    executionId,
    hintedTransactionHash: readTransactionHash(response.body) ?? undefined,
    candidate: classification.candidate,
    inFlightReported: false,
    start: Number.isFinite(committedAt) ? committedAt : now(),
    searchFromBlock: reserved.record.fromBlock,
    wait,
    log,
  });
}

interface ReconcileContext {
  readonly exchanges: KeeperhubExchange[];
  executionId: string | undefined;
  hintedTransactionHash: string | undefined;
  readonly candidate: AttemptState;
  /**
   * Set when KeeperHub answered 409 `idempotency_in_progress`. That is positive evidence that
   * an execution may still land, so the absence of an effect on chain cannot be read as proof
   * that nothing was broadcast, however long the settlement window has been open.
   */
  inFlightReported: boolean;
  /** Milliseconds since the epoch at which this attempt's key was durably committed. */
  readonly start: number;
  /** The chain head at that moment, taken from the durable record and never recomputed. */
  readonly searchFromBlock: number;
  readonly wait: (ms: number) => Promise<void>;
  readonly log: (message: string) => void;
}

/**
 * The reconciliation algorithm from PHASE_00_5 section 8, in order. Every step is a measured
 * behavior rather than a guess, and the loop never leaves on a timer.
 */
async function reconcile(
  plan: AttemptPlan,
  options: ExecuteOptions,
  context: ReconcileContext,
): Promise<AttemptOutcome> {
  const maxRounds = options.maxReconciliationRounds ?? DEFAULT_MAX_ROUNDS;
  const settlementWindowMs = options.settlementWindowMs ?? SETTLEMENT_WINDOW_MS;
  const now = options.now ?? (() => Date.now());

  let sponsored: boolean | undefined;
  let gasUsed: string | undefined;
  let transactionLink: string | undefined;
  let innerFailure = false;
  let receipt: RpcReceipt | null | undefined;
  let originsAgreed = true;
  let lastReason = 'not reconciled';

  for (let round = 1; round <= maxRounds; round += 1) {
    await options.store.update(plan.semanticAttemptId, { reconciliationRounds: round });

    // Step 1: replay the key, byte-identical, when no execution id is known yet.
    if (context.executionId === undefined) {
      const replay = await options.keeperhub.execute(
        plan.canonicalBody,
        plan.idempotencyKey,
        plan.canonicalBodyHash,
      );
      context.exchanges.push(replay);

      const code = replay.error?.code;
      if (code === IDEMPOTENCY_IN_PROGRESS) {
        // Still running. Repeat this key later and never rotate it, but do not stop here: the
        // chain search below is the route that answered in Phase 0.5's P11, where the replay
        // reported only that something was running and `eth_getLogs` found the transaction.
        context.inFlightReported = true;
        context.log(
          'key replay: still running; the same key will be repeated, and the chain asked now',
        );
      } else if (code === IDEMPOTENCY_CONFLICT) {
        // The stored body is not what was sent, which is a programming error. The response
        // sometimes names the execution the key already created, and that is the only handle
        // available. Never rotate the key.
        context.executionId = replay.error?.originalExecutionId ?? undefined;
        context.log(`key replay: conflict; originalExecutionId ${context.executionId ?? 'absent'}`);
      } else {
        context.executionId = readExecutionId(replay.body) ?? context.executionId;
        context.hintedTransactionHash =
          readTransactionHash(replay.body) ?? context.hintedTransactionHash;
      }
      if (context.executionId !== undefined) {
        await options.store.update(plan.semanticAttemptId, { executionId: context.executionId });
      }
    }

    // Step 3: the status endpoint, for the transaction hash. A body saying `failed` with a null
    // hash and no receipts still has to go through step 2 before it is believed.
    if (context.executionId !== undefined && context.hintedTransactionHash === undefined) {
      const status = await options.keeperhub.executionStatus(context.executionId);
      context.exchanges.push(status);
      context.hintedTransactionHash = readTransactionHash(status.body) ?? undefined;
      transactionLink = readTransactionLink(status.body) ?? transactionLink;
      sponsored = readSponsored(status.body) ?? sponsored;
      gasUsed = readGasUsed(status.body) ?? gasUsed;
      innerFailure = innerFailure || readInnerFailure(status.body);
    }

    // Step 2: ask the chain. This is the only route that survives an API change, and the only
    // one that can prove an absence.
    if (context.hintedTransactionHash === null || context.hintedTransactionHash === undefined) {
      const found = await findEffectOnChain(plan, options, context.searchFromBlock);
      if (found !== undefined) {
        context.hintedTransactionHash = found;
        context.log(`recovered transaction ${found} from chain logs alone`);
      }
    }

    // Step 4: the receipt, from two origins, classified on chain evidence.
    if (context.hintedTransactionHash !== undefined && context.hintedTransactionHash !== null) {
      const quorum = await getReceipt(context.hintedTransactionHash, options.rpc ?? {});
      originsAgreed = quorum.agreed;
      receipt = quorum.value;

      const evidence = classifyChainEvidence({
        originsAgreed: quorum.agreed,
        receiptStatus: normalizeReceiptStatus(quorum.value?.status),
        expectedEventPresent: receiptCarriesEffect(quorum.value, plan.expectedEffect),
        innerFailureSignalled: innerFailure,
        attributableEffectFound: true,
        settlementWindowElapsed: now() - context.start >= settlementWindowMs,
      });
      lastReason = evidence.reason;
      if (evidence.state !== 'RECONCILIATION_REQUIRED') {
        const updated = await options.store.update(plan.semanticAttemptId, {
          state: evidence.state,
          transactionHash: context.hintedTransactionHash,
          note: evidence.reason,
        });
        return finish(updated, evidence.state, context.exchanges, evidence.reason, {
          originsAgreed,
          receipt,
          transactionLink,
          sponsored,
          gasUsed,
          innerFailure,
          executionId: context.executionId,
        });
      }
      context.log(`round ${round}: ${evidence.reason}`);
      await context.wait(DEFAULT_ROUND_DELAY_MS);
      continue;
    }

    // No hash and no effect. Only the settlement window turns that into proof.
    const evidence = classifyChainEvidence({
      originsAgreed: true,
      receiptStatus: undefined,
      expectedEventPresent: false,
      innerFailureSignalled: innerFailure,
      attributableEffectFound: false,
      settlementWindowElapsed:
        !context.inFlightReported && now() - context.start >= settlementWindowMs,
    });
    lastReason = evidence.reason;
    if (evidence.state === 'PROVEN_NOT_BROADCAST') {
      // The candidate from the response decides between the two ways of having no effect: a
      // KeeperHub refusal that reported itself, and a request nobody can account for.
      const finalState: AttemptState =
        context.candidate === 'EXECUTED_NO_EFFECT' ? 'EXECUTED_NO_EFFECT' : 'PROVEN_NOT_BROADCAST';
      const updated = await options.store.update(plan.semanticAttemptId, {
        state: finalState,
        note: evidence.reason,
      });
      return finish(updated, finalState, context.exchanges, evidence.reason, {
        originsAgreed: true,
        executionId: context.executionId,
        sponsored,
        gasUsed,
      });
    }
    context.log(`round ${round}: ${evidence.reason}`);
    await context.wait(DEFAULT_ROUND_DELAY_MS);
  }

  // Exhausted. The attempt stays ambiguous and the covenant does not advance. There is no
  // timeout that promotes an attempt to a terminal state, because a timeout is not evidence.
  const updated = await options.store.update(plan.semanticAttemptId, {
    state: 'RECONCILIATION_REQUIRED',
    note: `reconciliation exhausted after ${maxRounds} rounds: ${lastReason}`,
  });
  return finish(
    updated,
    'RECONCILIATION_REQUIRED',
    context.exchanges,
    `reconciliation exhausted after ${maxRounds} rounds: ${lastReason}`,
    {
      originsAgreed,
      receipt,
      transactionLink,
      sponsored,
      gasUsed,
      innerFailure,
      executionId: context.executionId,
    },
  );
}

function normalizeReceiptStatus(status: string | undefined): '0x1' | '0x0' | undefined {
  if (status === undefined) return undefined;
  const value = status.toLowerCase();
  if (value === '0x1') return '0x1';
  if (value === '0x0') return '0x0';
  return undefined;
}

/** Does this receipt actually contain the effect the attempt promised? */
export function receiptCarriesEffect(
  receipt: RpcReceipt | null | undefined,
  expected: ExpectedEffect,
): boolean {
  if (receipt === null || receipt === undefined) return false;
  return receipt.logs.some((entry) => {
    if (
      expected.address !== undefined &&
      entry.address.toLowerCase() !== expected.address.toLowerCase()
    ) {
      return false;
    }
    for (const [index, topic] of expected.topics.entries()) {
      if (topic === null) continue;
      if (entry.topics[index]?.toLowerCase() !== topic.toLowerCase()) return false;
    }
    return expected.matches === undefined ? true : expected.matches(entry);
  });
}

/** Search the chain for this attempt's own marker. The recovery route that survives an outage. */
async function findEffectOnChain(
  plan: AttemptPlan,
  options: ExecuteOptions,
  fromBlock: number,
): Promise<string | undefined> {
  const head = await getBlockNumber(options.rpc ?? {});
  const query = {
    ...(plan.expectedEffect.address === undefined ? {} : { address: plan.expectedEffect.address }),
    topics: plan.expectedEffect.topics,
    // The durable floor, never a freshly read head. See `AttemptRecord.fromBlock`.
    fromBlock,
    toBlock: (head ?? 'latest') as number | 'latest',
  };
  const logs = await getLogs(query, options.rpc ?? {});
  const match = (logs.value ?? []).find((entry) =>
    plan.expectedEffect.matches === undefined ? true : plan.expectedEffect.matches(entry),
  );
  return match?.transactionHash;
}

function finish(
  record: AttemptRecord,
  state: AttemptState,
  exchanges: readonly KeeperhubExchange[],
  reason: string,
  extras: {
    originsAgreed: boolean;
    receipt?: RpcReceipt | null | undefined;
    transactionLink?: string | undefined;
    sponsored?: boolean | undefined;
    gasUsed?: string | undefined;
    innerFailure?: boolean;
    executionId?: string | undefined;
  },
): AttemptOutcome {
  return {
    state,
    record,
    transactionHash: record.transactionHash,
    transactionLink: extras.transactionLink,
    executionId: record.executionId ?? extras.executionId,
    receipt: extras.receipt,
    originsAgreed: extras.originsAgreed,
    sponsored: extras.sponsored,
    gasUsed: extras.gasUsed,
    innerFailureSignalled: extras.innerFailure ?? false,
    exchanges,
    reason,
  };
}

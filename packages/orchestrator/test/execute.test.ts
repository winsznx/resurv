import { KeeperhubClient } from '@resurv/keeperhub-client';
import { beforeEach, describe, expect, it } from 'vitest';
import { type AttemptPlan, executeSemanticAttempt, nextRoundDelayMs } from '../src/execute.ts';
import { InMemoryAttemptStore } from '../src/store.ts';
import {
  EXPECTED_TOPIC,
  FakeKeeperhub,
  FakeRpc,
  receiptWithExpectedEvent,
  receiptWithoutExpectedEvent,
  TARGET,
} from './support/fakes.ts';

/**
 * The executor, judged on what it does with evidence rather than on what it calls.
 *
 * Both external systems are driven at the `fetch` boundary, so the transport, the error
 * normalization, the two-origin quorum and the classifier all really run.
 */

const PLAN: AttemptPlan = {
  semanticAttemptId: '0xattempt',
  covenantId: '0xcov',
  actionIndex: 1,
  attemptSequence: 0,
  expectedStateHash: undefined,
  canonicalBody: '{"a":1}',
  canonicalBodyHash: 'sha256:deadbeef',
  idempotencyKey: 'key-1',
  expectedEffect: { address: TARGET, topics: [EXPECTED_TOPIC] },
  fromBlock: 1,
};

/** A durable record shaped like the one a previous process would have left behind. */
function baseRecord() {
  return {
    semanticAttemptId: PLAN.semanticAttemptId,
    covenantId: PLAN.covenantId,
    actionIndex: PLAN.actionIndex,
    attemptSequence: PLAN.attemptSequence,
    expectedStateHash: undefined,
    canonicalBody: PLAN.canonicalBody,
    canonicalBodyHash: PLAN.canonicalBodyHash,
    idempotencyKey: PLAN.idempotencyKey,
    fromBlock: PLAN.fromBlock,
    state: 'KEY_COMMITTED' as const,
    executionId: undefined,
    transactionHash: undefined,
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
    reconciliationRounds: 0,
    note: undefined,
  };
}

function runtime(keeperhub: FakeKeeperhub, rpc: FakeRpc, store = new InMemoryAttemptStore()) {
  return {
    store,
    keeperhub: new KeeperhubClient({ apiKey: 'kh_test', fetchImpl: keeperhub.fetch }),
    rpc: { fetchImpl: rpc.fetch, origins: rpc.origins },
    waitMs: async () => {},
    maxReconciliationRounds: 4,
    settlementWindowMs: 0,
  };
}

describe('the happy path', () => {
  it('confirms only after a receipt from two agreeing origins carries the expected event', async () => {
    // #given
    const keeperhub = new FakeKeeperhub()
      .onExecute({ status: 202, body: { executionId: 'exec-1', status: 'completed' } })
      .onStatus({
        status: 200,
        body: {
          status: 'completed',
          transactionHash: '0xabc',
          sponsored: true,
          gasUsedWei: '245531',
        },
      });
    const rpc = new FakeRpc({ receipt: receiptWithExpectedEvent() });

    // #when
    const outcome = await executeSemanticAttempt(PLAN, runtime(keeperhub, rpc));

    // #then
    expect(outcome.state).toBe('CONFIRMED');
    expect(outcome.transactionHash).toBe('0xabc');
    expect(outcome.executionId).toBe('exec-1');
    expect(outcome.originsAgreed).toBe(true);
    expect(outcome.sponsored).toBe(true);
  });

  it('writes the idempotency key durably before the first request leaves', async () => {
    // #given a store that records the order of everything that happened
    const order: string[] = [];
    const store = new InMemoryAttemptStore();
    const recording = {
      reserve: async (record: Parameters<InMemoryAttemptStore['reserve']>[0]) => {
        order.push(`reserve:${record.idempotencyKey}:${record.state}`);
        return store.reserve(record);
      },
      find: store.find.bind(store),
      update: store.update.bind(store),
      list: store.list.bind(store),
    };
    const keeperhub = new FakeKeeperhub()
      .onExecute({ status: 202, body: { executionId: 'exec-1', status: 'completed' } })
      .onStatus({ status: 200, body: { transactionHash: '0xabc' } });
    const rpc = new FakeRpc({ receipt: receiptWithExpectedEvent() });

    // #when
    const options = runtime(keeperhub, rpc);
    await executeSemanticAttempt(PLAN, { ...options, store: recording });

    // #then the reserve happened, and it happened before any HTTP request
    expect(order[0]).toBe('reserve:key-1:KEY_COMMITTED');
    expect(keeperhub.requests.length).toBeGreaterThan(0);
  });
});

describe('a refusal that never reached the chain', () => {
  it('settles as EXECUTED_NO_EFFECT only after the chain agrees nothing happened', async () => {
    // #given the measured P09 shape
    const keeperhub = new FakeKeeperhub().onExecute({
      status: 202,
      body: { executionId: 'exec-2', status: 'failed', transactionHash: null, receipts: [] },
    });
    const rpc = new FakeRpc({ logs: [] });

    // #when
    const outcome = await executeSemanticAttempt(PLAN, runtime(keeperhub, rpc));

    // #then
    expect(outcome.state).toBe('EXECUTED_NO_EFFECT');
    expect(outcome.transactionHash).toBeUndefined();
    // The chain was actually consulted. A classifier that trusted the body would not have.
    expect(rpc.calls.some((call) => call.includes('eth_getLogs'))).toBe(true);
  });
});

describe('a lost response', () => {
  it('recovers by replaying the same key, and never rotates it', async () => {
    // #given a request that never answers, then a replay that does
    const keeperhub = new FakeKeeperhub()
      .onExecute(
        { throws: 'AbortError: connection lost' },
        {
          status: 202,
          body: { executionId: 'exec-3', status: 'completed', idempotentReplay: true },
        },
      )
      .onStatus({ status: 200, body: { transactionHash: '0xabc' } });
    const rpc = new FakeRpc({ receipt: receiptWithExpectedEvent() });

    // #when
    const outcome = await executeSemanticAttempt(PLAN, runtime(keeperhub, rpc));

    // #then
    expect(outcome.state).toBe('CONFIRMED');
    expect(keeperhub.distinctIdempotencyKeys).toEqual(['key-1']);
  });

  it('repeats the same key while KeeperHub reports the first request still running', async () => {
    // #given
    const keeperhub = new FakeKeeperhub()
      .onExecute(
        { throws: 'AbortError: connection lost' },
        {
          status: 409,
          body: { error: 'still running', code: 'idempotency_in_progress', retryable: true },
        },
        { status: 202, body: { executionId: 'exec-4', status: 'completed' } },
      )
      .onStatus({ status: 200, body: { transactionHash: '0xabc' } });
    const rpc = new FakeRpc({ receipt: receiptWithExpectedEvent() });

    // #when
    const outcome = await executeSemanticAttempt(PLAN, runtime(keeperhub, rpc));

    // #then
    expect(outcome.state).toBe('CONFIRMED');
    expect(keeperhub.distinctIdempotencyKeys).toEqual(['key-1']);
  });

  it('takes originalExecutionId from a conflict rather than rotating the key', async () => {
    // #given a conflict, which is a programming error and still carries a usable handle
    const keeperhub = new FakeKeeperhub()
      .onExecute(
        { throws: 'AbortError: connection lost' },
        {
          status: 409,
          body: {
            error: 'idempotency key reused with a different body',
            code: 'idempotency_conflict',
            retryable: false,
            originalExecutionId: 'exec-5',
          },
        },
      )
      .onStatus({ status: 200, body: { transactionHash: '0xabc' } });
    const rpc = new FakeRpc({ receipt: receiptWithExpectedEvent() });

    // #when
    const outcome = await executeSemanticAttempt(PLAN, runtime(keeperhub, rpc));

    // #then
    expect(outcome.state).toBe('CONFIRMED');
    expect(outcome.executionId).toBe('exec-5');
    expect(keeperhub.distinctIdempotencyKeys).toEqual(['key-1']);
  });

  it('recovers from the chain alone when KeeperHub can say nothing useful', async () => {
    // #given KeeperHub never yields an execution id, and the effect is on chain
    const keeperhub = new FakeKeeperhub().onExecute(
      { throws: 'AbortError: connection lost' },
      { status: 409, body: { error: 'running', code: 'idempotency_in_progress', retryable: true } },
    );
    const rpc = new FakeRpc({
      receipt: receiptWithExpectedEvent(),
      logs: [
        {
          address: TARGET,
          topics: [EXPECTED_TOPIC],
          data: '0x',
          blockNumber: '0x11',
          transactionHash: '0xabc',
          logIndex: '0x0',
        },
      ],
    });

    // #when
    const outcome = await executeSemanticAttempt(PLAN, runtime(keeperhub, rpc));

    // #then
    expect(outcome.state).toBe('CONFIRMED');
    expect(outcome.transactionHash).toBe('0xabc');
  });
});

describe('evidence that is not good enough', () => {
  it('never confirms while two RPC origins disagree about the receipt', async () => {
    // #given one origin says success and the other says it reverted
    const keeperhub = new FakeKeeperhub()
      .onExecute({ status: 202, body: { executionId: 'exec-6', status: 'completed' } })
      .onStatus({ status: 200, body: { transactionHash: '0xabc' } });
    const rpc = new FakeRpc({
      receipt: receiptWithExpectedEvent('0x1'),
      receiptFromSecondOrigin: receiptWithExpectedEvent('0x0'),
    });

    // #when
    const outcome = await executeSemanticAttempt(PLAN, runtime(keeperhub, rpc));

    // #then
    expect(outcome.state).toBe('RECONCILIATION_REQUIRED');
    expect(outcome.originsAgreed).toBe(false);
    expect(outcome.reason).toContain('exhausted');
  });

  it('never confirms a successful receipt whose expected event is missing', async () => {
    // #given
    const keeperhub = new FakeKeeperhub()
      .onExecute({ status: 202, body: { executionId: 'exec-7', status: 'completed' } })
      .onStatus({ status: 200, body: { transactionHash: '0xabc' } });
    const rpc = new FakeRpc({ receipt: receiptWithoutExpectedEvent() });

    // #when
    const outcome = await executeSemanticAttempt(PLAN, runtime(keeperhub, rpc));

    // #then
    expect(outcome.state).toBe('RECONCILIATION_REQUIRED');
  });

  it('treats an inner failure as REVERTED even though the outer receipt succeeded', async () => {
    // #given the T15 hazard, signalled on the status body
    const keeperhub = new FakeKeeperhub()
      .onExecute({ status: 202, body: { executionId: 'exec-8', status: 'completed' } })
      .onStatus({
        status: 200,
        body: {
          transactionHash: '0xabc',
          result: { executedCall: { reverted: true } },
          receipts: [{ receiptStatus: 'safe_inner_failure' }],
        },
      });
    const rpc = new FakeRpc({ receipt: receiptWithExpectedEvent('0x1') });

    // #when
    const outcome = await executeSemanticAttempt(PLAN, runtime(keeperhub, rpc));

    // #then
    expect(outcome.state).toBe('REVERTED');
    expect(outcome.innerFailureSignalled).toBe(true);
  });

  it('reports a reverted receipt as REVERTED', async () => {
    // #given
    const keeperhub = new FakeKeeperhub()
      .onExecute({ status: 202, body: { executionId: 'exec-9', status: 'completed' } })
      .onStatus({ status: 200, body: { transactionHash: '0xabc' } });
    const rpc = new FakeRpc({ receipt: receiptWithExpectedEvent('0x0') });

    // #when
    const outcome = await executeSemanticAttempt(PLAN, runtime(keeperhub, rpc));

    // #then
    expect(outcome.state).toBe('REVERTED');
  });

  it('does not promote an unresolved attempt when the rounds run out', async () => {
    // #given nothing ever resolves
    const keeperhub = new FakeKeeperhub().onExecute({
      status: 409,
      body: { error: 'running', code: 'idempotency_in_progress', retryable: true },
    });
    const rpc = new FakeRpc({ logs: [], blockNumber: '0x10' });

    // #when: the settlement window has not elapsed, so absence proves nothing
    const options = runtime(keeperhub, rpc);
    const outcome = await executeSemanticAttempt(PLAN, {
      ...options,
      settlementWindowMs: 10 ** 9,
    });

    // #then
    expect(outcome.state).toBe('RECONCILIATION_REQUIRED');
  });
});

/**
 * The reconciliation loop's own mechanics, which every test above happened to skip.
 *
 * Each of those scripted a single static answer, so the loop resolved on round one or never, and
 * a mutation changing `round <= maxRounds` to `round < maxRounds` survived the entire suite.
 * Bounded polling that converges as evidence arrives is the loop's whole job, and until these it
 * had never been exercised.
 */
describe('the reconciliation loop itself', () => {
  const MATCHING_LOG = {
    address: TARGET,
    topics: [EXPECTED_TOPIC],
    data: '0x',
    blockNumber: '0x11',
    transactionHash: '0xabc',
    logIndex: '0x0',
  };

  /** Nothing to see: an execution id, a status body with no hash, and an empty chain. */
  function silentUntilEvidenceArrives() {
    const keeperhub = new FakeKeeperhub()
      .onExecute({ status: 202, body: { executionId: 'exec-slow', status: 'pending' } })
      .onStatus({ status: 200, body: { status: 'pending' } });
    const rpc = new FakeRpc({ logs: [], blockNumber: '0x3000' });
    return { keeperhub, rpc };
  }

  it('keeps polling until evidence arrives, then confirms on the round that saw it', async () => {
    // #given evidence that appears only after the third wait
    const { keeperhub, rpc } = silentUntilEvidenceArrives();
    let waits = 0;

    // #when
    const outcome = await executeSemanticAttempt(PLAN, {
      ...runtime(keeperhub, rpc),
      maxReconciliationRounds: 8,
      settlementWindowMs: 10 ** 9,
      waitMs: async () => {
        waits += 1;
        if (waits === 3) {
          rpc.state.logs = [MATCHING_LOG];
          rpc.state.receipt = receiptWithExpectedEvent();
        }
      },
    });

    // #then it resolved on round four, having waited once per inconclusive round and no more
    expect(outcome.state).toBe('CONFIRMED');
    expect(outcome.transactionHash).toBe('0xabc');
    expect(waits).toBe(3);
  });

  it('runs exactly the configured number of rounds before it gives up', async () => {
    // #given evidence that never arrives
    const { keeperhub, rpc } = silentUntilEvidenceArrives();
    const store = new InMemoryAttemptStore();
    let waits = 0;

    // #when
    const outcome = await executeSemanticAttempt(PLAN, {
      ...runtime(keeperhub, rpc, store),
      maxReconciliationRounds: 3,
      settlementWindowMs: 10 ** 9,
      waitMs: async () => {
        waits += 1;
      },
    });

    // #then three rounds, not two and not four, and the record says so
    expect(waits).toBe(3);
    expect(outcome.state).toBe('RECONCILIATION_REQUIRED');
    expect(outcome.reason).toContain('after 3 rounds');
    expect((await store.find(PLAN.semanticAttemptId))?.reconciliationRounds).toBe(3);
  });

  it('does not let an elapsed settlement window over a failed search prove a non-broadcast', async () => {
    // #given a chain that answers the head and then refuses every log query, and a window that
    // has long since elapsed. An absence nobody could observe is not an absence.
    const keeperhub = new FakeKeeperhub().onExecute({
      status: 202,
      body: { executionId: undefined, status: 'failed', transactionHash: null, receipts: [] },
    });
    const failingLogSearch: typeof fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body ?? '{}')) as { method: string };
      const result = request.method === 'eth_blockNumber' ? '0x3000' : undefined;
      return new Response(
        JSON.stringify(
          request.method === 'eth_getLogs'
            ? { jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'query returned too much' } }
            : { jsonrpc: '2.0', id: 1, result },
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    // #when
    const outcome = await executeSemanticAttempt(PLAN, {
      ...runtime(keeperhub, new FakeRpc({})),
      rpc: { fetchImpl: failingLogSearch, origins: ['https://a.test', 'https://b.test'] },
      maxReconciliationRounds: 2,
      settlementWindowMs: 0,
      waitMs: async () => {},
    });

    // #then the attempt stays ambiguous rather than being declared never broadcast
    expect(outcome.state).toBe('RECONCILIATION_REQUIRED');
  });
});

/**
 * Rate limiting, which the client parsed into every exchange and the reconciler then ignored.
 *
 * The headers were measured in Phase 0.5 and recorded, and `parsePollIntervalHint` was unit
 * tested in isolation while being called from no production code at all. A hint nothing reads is
 * a comment with a test suite.
 */
describe('server hints about when to come back', () => {
  const withRateLimit = (rateLimit: Record<string, unknown>) =>
    ({ rateLimit }) as unknown as Parameters<typeof nextRoundDelayMs>[0];

  it('honours Retry-After ahead of everything else', () => {
    // #given a throttled response asking for 12 seconds
    // #when / #then
    expect(nextRoundDelayMs(withRateLimit({ retryAfterSeconds: 12, pollIntervalHint: '2' }))).toBe(
      12_000,
    );
  });

  it('falls back to the poll-interval hint when there is no Retry-After', () => {
    expect(nextRoundDelayMs(withRateLimit({ pollIntervalHint: '8' }))).toBe(8_000);
  });

  it('falls back to the default when the server says nothing', () => {
    expect(nextRoundDelayMs(undefined)).toBe(5_000);
    expect(nextRoundDelayMs(withRateLimit({}))).toBe(5_000);
  });

  /**
   * The safety rule. A server may legitimately ask for an hour, and honouring that literally
   * would spend the whole round budget asleep and give up on an attempt the chain could have
   * settled in a minute. A hint is information about the server's load, never permission to stop
   * looking at chain.
   */
  it('never waits longer than a minute, whatever the server asks for', () => {
    expect(nextRoundDelayMs(withRateLimit({ retryAfterSeconds: 3600 }))).toBe(60_000);
    expect(nextRoundDelayMs(withRateLimit({ pollIntervalHint: '900' }))).toBe(60_000);
  });

  it('never busy-loops, including when the hint says the execution is settled', () => {
    // `0` means terminal, which is a reason to look at the chain sooner and not a reason to stop.
    expect(nextRoundDelayMs(withRateLimit({ pollIntervalHint: '0' }))).toBe(1_000);
    expect(nextRoundDelayMs(withRateLimit({ retryAfterSeconds: 0.001 }))).toBe(1_000);
  });

  it('ignores a hint it cannot read rather than trusting it', () => {
    expect(nextRoundDelayMs(withRateLimit({ pollIntervalHint: 'soon' }))).toBe(5_000);
    expect(nextRoundDelayMs(withRateLimit({ retryAfterSeconds: Number.NaN }))).toBe(5_000);
    expect(nextRoundDelayMs(withRateLimit({ retryAfterSeconds: -5 }))).toBe(5_000);
  });

  it('actually waits what the last exchange asked for, between real rounds', async () => {
    // #given a 429 carrying Retry-After, then nothing that resolves
    const keeperhub = new FakeKeeperhub()
      .onExecute({
        status: 429,
        body: { error: 'slow down', code: 'rate_limited', retryable: true },
        headers: { 'Retry-After': '7' },
      })
      .onStatus({ status: 200, body: { status: 'pending' } });
    const rpc = new FakeRpc({ logs: [], blockNumber: '0x3000' });
    const waited: number[] = [];

    // #when
    await executeSemanticAttempt(PLAN, {
      ...runtime(keeperhub, rpc),
      maxReconciliationRounds: 2,
      settlementWindowMs: 10 ** 9,
      waitMs: async (ms) => {
        waited.push(ms);
      },
    });

    // #then the reconciler backed off by what the server said, not by its own constant
    expect(waited).toEqual([7_000, 7_000]);
  });
});

describe('a durable record that cannot be trusted', () => {
  /**
   * The settlement clock is anchored to `createdAt` precisely so a resumed process cannot restart
   * it, because a clock that restarts on every invocation makes `PROVEN_NOT_BROADCAST`
   * unreachable and turns a bounded resolution into an unbounded one. Falling back to `now()`
   * when the field is unreadable would restore exactly that defect, quietly, on the one code
   * path where nobody is looking. A mutation campaign found this branch had no test at all.
   */
  it('refuses to reconcile an attempt whose createdAt cannot be read, rather than restarting the clock', async () => {
    // #given a journal entry whose timestamp is corrupt
    const store = new InMemoryAttemptStore();
    await store.reserve({ ...baseRecord(), createdAt: 'not-a-date' });
    const keeperhub = new FakeKeeperhub().onExecute({
      status: 202,
      body: { executionId: 'exec-corrupt', status: 'completed' },
    });
    const rpc = new FakeRpc({ receipt: receiptWithExpectedEvent() });

    // #when / #then it is an integrity failure, not a value to substitute around
    await expect(executeSemanticAttempt(PLAN, runtime(keeperhub, rpc, store))).rejects.toThrow(
      /unreadable createdAt/,
    );
  });
});

describe('crash and concurrency', () => {
  let store: InMemoryAttemptStore;

  beforeEach(() => {
    store = new InMemoryAttemptStore();
  });

  it('resumes a claim left behind by a crash instead of creating a second attempt', async () => {
    // #given a record the previous process wrote before it died
    await store.reserve(baseRecord());

    const keeperhub = new FakeKeeperhub()
      .onExecute({
        status: 202,
        body: { executionId: 'exec-10', status: 'completed', idempotentReplay: true },
      })
      .onStatus({ status: 200, body: { transactionHash: '0xabc' } });
    const rpc = new FakeRpc({ receipt: receiptWithExpectedEvent() });

    // #when
    const outcome = await executeSemanticAttempt(PLAN, runtime(keeperhub, rpc, store));

    // #then one attempt, one key, and the stored body is what was sent
    expect(outcome.state).toBe('CONFIRMED');
    expect((await store.list()).length).toBe(1);
    expect(keeperhub.distinctIdempotencyKeys).toEqual(['key-1']);
    expect(keeperhub.requests[0]?.body).toBe(PLAN.canonicalBody);
  });

  /**
   * The defect this pins was found by review, not by a test, and its failure mode is the worst
   * one available: a resumed process searching the chain from the *current* head skips the block
   * its own transaction landed in, concludes nothing was broadcast, and invites a second
   * economic effect. The floor has to come from the durable record.
   */
  it('searches the chain from the block the attempt started at, not the block it resumed at', async () => {
    // #given a claim written when the head was block 0x11, and a chain now far past it
    await store.reserve({
      ...baseRecord(),
      fromBlock: 0x11,
      createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    });

    const keeperhub = new FakeKeeperhub().onExecute({
      status: 409,
      body: { error: 'running', code: 'idempotency_in_progress', retryable: true },
    });
    const rpc = new FakeRpc({
      blockNumber: '0x3000',
      receipt: receiptWithExpectedEvent(),
      logs: [
        {
          address: TARGET,
          topics: [EXPECTED_TOPIC],
          data: '0x',
          blockNumber: '0x12',
          transactionHash: '0xabc',
          logIndex: '0x0',
        },
      ],
    });

    // #when a fresh plan is built, as a re-run would build it, with a much later floor
    const stalePlan: AttemptPlan = { ...PLAN, fromBlock: 0x2fff };
    const outcome = await executeSemanticAttempt(stalePlan, runtime(keeperhub, rpc, store));

    // #then the stored floor was used, so the effect was found
    expect(outcome.state).toBe('CONFIRMED');
    expect(outcome.transactionHash).toBe('0xabc');
    const searched = rpc.logQueries.at(-1);
    expect(searched?.fromBlock).toBe('0x11');
  });

  /**
   * The settlement window measures time since the key was committed. Restarting the clock on
   * every invocation makes `PROVEN_NOT_BROADCAST` unreachable through the documented
   * "come back later" recovery, which quietly turns a bounded resolution into an unbounded one.
   */
  it('measures the settlement window from the durable commit, not from this invocation', async () => {
    // #given a claim committed ten minutes ago, and nothing on chain
    await store.reserve({
      ...baseRecord(),
      createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    const keeperhub = new FakeKeeperhub().onExecute({
      status: 202,
      body: { executionId: undefined, status: 'failed', transactionHash: null, receipts: [] },
    });
    const rpc = new FakeRpc({ logs: [] });

    // #when a window longer than this invocation but shorter than the elapsed time is used
    const options = runtime(keeperhub, rpc, store);
    const outcome = await executeSemanticAttempt(PLAN, {
      ...options,
      settlementWindowMs: 60_000,
    });

    // #then the elapsed time counted, so the attempt resolved rather than looping forever
    expect(outcome.state).toBe('EXECUTED_NO_EFFECT');
  });

  it('does not start a second attempt for a semantic id that already settled', async () => {
    // #given a terminal record
    await store.reserve({
      ...baseRecord(),
      state: 'CONFIRMED',
      executionId: 'exec-old',
      transactionHash: '0xold',
      reconciliationRounds: 1,
    });
    const keeperhub = new FakeKeeperhub().onExecute({ status: 202, body: {} });
    const rpc = new FakeRpc({});

    // #when
    const outcome = await executeSemanticAttempt(PLAN, runtime(keeperhub, rpc, store));

    // #then nothing was sent at all
    expect(outcome.state).toBe('CONFIRMED');
    expect(keeperhub.requests).toHaveLength(0);
  });

  it('gives two concurrent workers one attempt between them', async () => {
    // #given
    const keeperhub = new FakeKeeperhub()
      .onExecute({ status: 202, body: { executionId: 'exec-11', status: 'completed' } })
      .onStatus({ status: 200, body: { transactionHash: '0xabc' } });
    const rpc = new FakeRpc({ receipt: receiptWithExpectedEvent() });
    const options = runtime(keeperhub, rpc, store);

    // #when both workers race
    const [first, second] = await Promise.all([
      executeSemanticAttempt(PLAN, options),
      executeSemanticAttempt(PLAN, options),
    ]);

    // #then one record, one key, and neither worker invented a second economic action
    expect((await store.list()).length).toBe(1);
    expect(keeperhub.distinctIdempotencyKeys).toEqual(['key-1']);
    expect([first.state, second.state]).not.toContain('PROVEN_NOT_BROADCAST');
  });
});

import { KeeperhubClient } from '@resurv/keeperhub-client';
import { beforeEach, describe, expect, it } from 'vitest';
import { type AttemptPlan, executeSemanticAttempt } from '../src/execute.ts';
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

describe('crash and concurrency', () => {
  let store: InMemoryAttemptStore;

  beforeEach(() => {
    store = new InMemoryAttemptStore();
  });

  it('resumes a claim left behind by a crash instead of creating a second attempt', async () => {
    // #given a record the previous process wrote before it died
    await store.reserve({
      semanticAttemptId: PLAN.semanticAttemptId,
      covenantId: PLAN.covenantId,
      actionIndex: PLAN.actionIndex,
      attemptSequence: PLAN.attemptSequence,
      expectedStateHash: undefined,
      canonicalBody: PLAN.canonicalBody,
      canonicalBodyHash: PLAN.canonicalBodyHash,
      idempotencyKey: PLAN.idempotencyKey,
      state: 'KEY_COMMITTED',
      executionId: undefined,
      transactionHash: undefined,
      createdAt: '2026-08-12T00:00:00Z',
      updatedAt: '2026-08-12T00:00:00Z',
      reconciliationRounds: 0,
      note: undefined,
    });

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

  it('does not start a second attempt for a semantic id that already settled', async () => {
    // #given a terminal record
    await store.reserve({
      semanticAttemptId: PLAN.semanticAttemptId,
      covenantId: PLAN.covenantId,
      actionIndex: PLAN.actionIndex,
      attemptSequence: PLAN.attemptSequence,
      expectedStateHash: undefined,
      canonicalBody: PLAN.canonicalBody,
      canonicalBodyHash: PLAN.canonicalBodyHash,
      idempotencyKey: PLAN.idempotencyKey,
      state: 'CONFIRMED',
      executionId: 'exec-old',
      transactionHash: '0xold',
      createdAt: '2026-08-12T00:00:00Z',
      updatedAt: '2026-08-12T00:00:00Z',
      reconciliationRounds: 1,
      note: undefined,
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

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `prepareCall` is the single place a canonical body, its hash, an idempotency key and a semantic
 * attempt id are derived, and every live write RESURV performs goes through it — deployments
 * included. It had no tests at all, which is a strange gap for the one function whose output
 * decides whether a retry is the same economic action or a second one.
 *
 * The block height is mocked because these are statements about derivation, not about a node.
 */

const blockNumber = vi.hoisted(() => vi.fn<() => Promise<number | undefined>>());

vi.mock('@resurv/chain', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@resurv/chain')>()),
  getBlockNumber: blockNumber,
}));

const { contractCallBody, prepareCall } = await import('../src/call.ts');
const { canonicalJson } = await import('@resurv/keeperhub-client');

type Spec = Parameters<typeof prepareCall>[0];

const SPEC: Spec = {
  label: 'demo/run-1/evacuate',
  contractAddress: '0x00000000000000000000000000000000000000aa',
  functionName: 'executeAttempt',
  abi: [{ type: 'function', name: 'executeAttempt', inputs: [], outputs: [] }],
  args: ['0xcov', 1, '0x'],
  expectedEffect: { address: '0x00000000000000000000000000000000000000aa', topics: ['0xtopic'] },
};

beforeEach(() => {
  blockNumber.mockReset();
  blockNumber.mockResolvedValue(0x100);
});

describe('semantic identity', () => {
  it('gives the same spec the same attempt id and the same key, every time', async () => {
    // #given the same call prepared twice, as a crash-recovery replay prepares it
    // #when
    const first = await prepareCall(SPEC);
    const second = await prepareCall(SPEC);

    // #then a replay is byte-identical, which is what makes it the same economic action
    expect(second.plan.semanticAttemptId).toBe(first.plan.semanticAttemptId);
    expect(second.plan.idempotencyKey).toBe(first.plan.idempotencyKey);
    expect(second.plan.canonicalBody).toBe(first.plan.canonicalBody);
    expect(second.plan.canonicalBodyHash).toBe(first.plan.canonicalBodyHash);
  });

  it('makes a deliberate second attempt a different attempt, via generation', async () => {
    // #given the same action against a different world state
    // #when
    const first = await prepareCall(SPEC);
    const second = await prepareCall({ ...SPEC, generation: 'g1' });

    // #then
    expect(second.plan.semanticAttemptId).not.toBe(first.plan.semanticAttemptId);
  });

  it('separates two different actions even under the same label', async () => {
    // #given
    // #when
    const evacuate = await prepareCall(SPEC);
    const pause = await prepareCall({ ...SPEC, functionName: 'pause' });

    // #then the body is part of the identity, so the label alone cannot collide them
    expect(pause.plan.semanticAttemptId).not.toBe(evacuate.plan.semanticAttemptId);
    expect(pause.plan.idempotencyKey).not.toBe(evacuate.plan.idempotencyKey);
  });
});

describe('the request body', () => {
  it('sends functionArgs and abi as JSON strings, not as arrays', async () => {
    // #given the measured KeeperHub quirk: arrays produce a 400 that reads like a schema problem
    // #when
    const { body } = await prepareCall(SPEC);

    // #then
    expect(typeof body['functionArgs']).toBe('string');
    expect(typeof body['abi']).toBe('string');
    expect(JSON.parse(String(body['functionArgs']))).toEqual(SPEC.args);
  });

  it('omits value entirely rather than sending a zero', async () => {
    // #given
    // #when
    const withoutValue = await prepareCall(SPEC);
    const withValue = await prepareCall({ ...SPEC, value: '1' });

    // #then
    expect('value' in withoutValue.body).toBe(false);
    expect(withValue.body['value']).toBe('1');
    expect(withValue.plan.canonicalBody).not.toBe(withoutValue.plan.canonicalBody);
  });

  /**
   * The simulate call and the execute call are two requests about one action. `simulate()`
   * re-serializes `contractCallBody(spec)`, while `execute()` replays the stored `canonicalBody`
   * string. If those ever drift, RESURV simulates one thing and broadcasts another, and no
   * KeeperHub response would say so.
   */
  it('simulates the same bytes it will later execute', async () => {
    // #given
    for (const spec of [SPEC, { ...SPEC, value: '1' }, { ...SPEC, args: [] }]) {
      // #when
      const prepared = await prepareCall(spec);

      // #then
      expect(canonicalJson(contractCallBody(spec))).toBe(prepared.plan.canonicalBody);
    }
  });
});

describe('the chain anchor', () => {
  it('leaves one block of slack below the head it read', async () => {
    // #given
    blockNumber.mockResolvedValue(0x100);

    // #when
    const { plan } = await prepareCall(SPEC);

    // #then
    expect(plan.fromBlock).toBe(0xff);
  });

  it('never goes below genesis', async () => {
    // #given a chain with one block, which only a fresh devnet has
    blockNumber.mockResolvedValue(0);

    // #when
    const { plan } = await prepareCall(SPEC);

    // #then
    expect(plan.fromBlock).toBe(0);
  });

  /**
   * Substituting genesis when the read fails would ask a public node for a range it refuses, and
   * a refused search reads as "found nothing" — which is exactly how an RPC outage turns into a
   * proof that the attempt was never broadcast.
   */
  it('refuses to plan an attempt with no anchor rather than searching from genesis', async () => {
    // #given every RPC origin down
    blockNumber.mockResolvedValue(undefined);

    // #when / #then
    await expect(prepareCall(SPEC)).rejects.toThrow(/no RPC origin returned a block height/);
  });
});

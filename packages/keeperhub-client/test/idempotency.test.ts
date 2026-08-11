import { describe, expect, it } from 'vitest';
import {
  type ContractCallIdentity,
  canonicalBodyHash,
  canonicalJson,
  deriveIdempotencyKey,
  idempotencyPreimage,
} from '../src/idempotency.ts';

const identity: ContractCallIdentity = {
  chainId: 84532,
  contractAddress: '0x2A6FC8182Bf9928Ef7517dA980dC79e8107c555A',
  functionName: 'executeAttempt',
  functionArgs: '["0xabc","0xdef"]',
  value: '0',
  semanticAttemptId: 'covenant-1:action-0:attempt-1',
};

describe('idempotency key derivation', () => {
  it('is deterministic across calls', async () => {
    const a = await deriveIdempotencyKey(identity);
    const b = await deriveIdempotencyKey(identity);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores address checksum casing, so a replay reproduces the key', async () => {
    const lower = await deriveIdempotencyKey({
      ...identity,
      contractAddress: identity.contractAddress.toLowerCase(),
    });
    expect(lower).toBe(await deriveIdempotencyKey(identity));
  });

  it('changes when any economically material field changes', async () => {
    const base = await deriveIdempotencyKey(identity);
    const mutations: ContractCallIdentity[] = [
      { ...identity, chainId: 8453 },
      {
        ...identity,
        contractAddress: '0x0000000000000000000000000000000000000001',
      },
      { ...identity, functionName: 'cancel' },
      { ...identity, functionArgs: '["0xabc","0x000"]' },
      { ...identity, value: '1' },
      { ...identity, semanticAttemptId: 'covenant-1:action-0:attempt-2' },
    ];
    for (const mutated of mutations) {
      expect(await deriveIdempotencyKey(mutated)).not.toBe(base);
    }
  });

  it('namespaces the preimage so an unrelated project cannot collide with our key', () => {
    expect(idempotencyPreimage(identity).startsWith('resurv/v1|')).toBe(true);
  });

  it('rejects a field containing the separator instead of producing an ambiguous preimage', () => {
    expect(() => idempotencyPreimage({ ...identity, semanticAttemptId: 'a|b' })).toThrow(
      /separator/,
    );
  });
});

describe('canonical body serialization', () => {
  it('produces identical output regardless of key insertion order', () => {
    const a = canonicalJson({
      chainId: 84532,
      contractAddress: '0xabc',
      simulate: true,
    });
    const b = canonicalJson({
      simulate: true,
      contractAddress: '0xabc',
      chainId: 84532,
    });
    expect(a).toBe(b);
  });

  it('sorts nested objects too', () => {
    const a = canonicalJson({ outer: { b: 1, a: 2 } });
    const b = canonicalJson({ outer: { a: 2, b: 1 } });
    expect(a).toBe(b);
  });

  it('preserves array order, which is semantically meaningful in functionArgs', () => {
    expect(canonicalJson(['b', 'a'])).toBe('["b","a"]');
    expect(canonicalJson(['b', 'a'])).not.toBe(canonicalJson(['a', 'b']));
  });

  it('hashes to a stable prefixed digest', async () => {
    const hash = await canonicalBodyHash({ b: 1, a: 2 });
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hash).toBe(await canonicalBodyHash({ a: 2, b: 1 }));
  });
});

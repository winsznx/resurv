import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { challengeFor, prepareContractCall, semanticAttemptId } from '../../src/attempt.ts';
import { CredentialLeakError, EVIDENCE_DIR, writeEvidence } from '../../src/evidence.ts';
import { ABSENT_FUNCTION_ABI, PING_ABI } from '../../src/fixture.ts';
import { describeCredential, REPO_ROOT } from '../../src/local-env.ts';
import { isCredentialHeader, REDACTED, sanitize, sanitizeString } from '../../src/sanitize.ts';

/**
 * The sanitizer exists because `@resurv/config`'s redactor is correct for a log line and wrong
 * for a proof artifact. Both halves of that trade are pinned here: a credential never survives,
 * a transaction hash always does. A future change that "hardens" this by adding the 32-byte hex
 * rule back fails the second group, which is the point.
 */

const FAKE_ORG_KEY = 'kh_ZmFrZVNlYW1Qcm9iZUtleU5vdFJlYWwwMDAwMDAwMA';
const FAKE_WEBHOOK_KEY = 'wfb_ZmFrZVdlYmhvb2tLZXlOb3RSZWFsMDAwMDAwMDA';
const REAL_TX_HASH = '0x9c1f36b1d2c1a1a7f8e3b5d4c7a09e2f1b3d5c7a9e0f2b4d6c8a0e2f4b6d8c0a2';

describe('credentials never survive sanitization', () => {
  it.each([
    ['a bare organization key', FAKE_ORG_KEY],
    ['a webhook key', FAKE_WEBHOOK_KEY],
    ['a bearer header value', `Bearer ${FAKE_ORG_KEY}`],
    ['a key inside a sentence', `auth failed for ${FAKE_ORG_KEY}, retry`],
    ['a Supabase key', 'sb_secret_abcdefghijklmnop'],
    ['a JWT', 'eyJhbGciOi.eyJzdWIi.c2lnbmF0dXJl'],
    ['a connection string', 'postgres://user:hunter2@db.example.invalid:5432/app'],
  ])('removes %s', (_label, value) => {
    expect(sanitizeString(value)).not.toContain(value.replace('Bearer ', ''));
    expect(sanitizeString(value)).toContain(REDACTED);
  });

  it('removes the exact loaded credential even when its shape is unremarkable', () => {
    const odd = 'thisisnotaprefixedkeybutitisthesecret';
    expect(sanitizeString(`token=${odd}`, [odd])).toBe(`token=${REDACTED}`);
  });

  it('removes a credential nested in an object, an array and a Map-shaped record', () => {
    const nested = sanitize(
      { outer: { list: [{ Authorization: `Bearer ${FAKE_ORG_KEY}` }] }, note: FAKE_ORG_KEY },
      [FAKE_ORG_KEY],
    );
    expect(JSON.stringify(nested)).not.toContain('kh_');
  });

  it('redacts by key name even when the value shape is innocent', () => {
    const result = sanitize({ authorization: 'anything', apiKey: 'x', cookie: 'y' }) as Record<
      string,
      unknown
    >;
    expect(result['authorization']).toBe(REDACTED);
    expect(result['apiKey']).toBe(REDACTED);
    expect(result['cookie']).toBe(REDACTED);
  });

  it.each(['Authorization', 'authorization', 'Cookie', 'X-API-Key'])(
    'treats %s as a credential header',
    (name) => {
      expect(isCredentialHeader(name)).toBe(true);
    },
  );

  it('does not treat an ordinary response header as a credential', () => {
    for (const name of ['content-type', 'x-ratelimit-remaining', 'x-poll-interval-hint']) {
      expect(isCredentialHeader(name)).toBe(false);
    }
  });

  it('survives a cycle without throwing', () => {
    const cyclic: Record<string, unknown> = { key: FAKE_ORG_KEY };
    cyclic['self'] = cyclic;
    expect(JSON.stringify(sanitize(cyclic))).not.toContain('kh_');
  });
});

describe('chain evidence always survives sanitization', () => {
  it.each([
    ['a transaction hash', REAL_TX_HASH],
    ['an address', '0x2A6FC8182Bf9928Ef7517dA980dC79e8107c555A'],
    ['an indexed topic', '0x4947ef22330e8e81cdedf82c33d366e9c942511f5edf79140686b33af9de7f33'],
    ['calldata', '0x33d425c40000000000000000000000000000000000000000000000000000000000000001'],
  ])('keeps %s', (_label, value) => {
    expect(sanitizeString(value)).toBe(value);
  });

  it('keeps a receipt intact while removing the credential beside it', () => {
    const result = sanitize(
      { transactionHash: REAL_TX_HASH, blockNumber: 12345, authorization: FAKE_ORG_KEY },
      [FAKE_ORG_KEY],
    ) as Record<string, unknown>;
    expect(result['transactionHash']).toBe(REAL_TX_HASH);
    expect(result['blockNumber']).toBe(12345);
    expect(result['authorization']).toBe(REDACTED);
  });
});

describe('the evidence writer fails closed', () => {
  /**
   * `sanitize` walks values. A credential that arrives as an object *key* is copied to the
   * output verbatim, because the key-name rules decide whether to redact the value, not
   * whether to keep the name. That is the one shape the walker does not cover, and it is a
   * realistic one: KeeperHub error bodies are records and a malformed one could key on the
   * credential it rejected. The writer's post-serialization scan is what closes it.
   */
  it('refuses to write a record where a credential survived as an object key', () => {
    const evidence = {
      id: 'leak-fixture',
      question: 'does the writer fail closed',
      semanticAttemptId: undefined,
      challenge: undefined,
      idempotencyKey: undefined,
      requestBodyHash: undefined,
      requestBody: { [FAKE_ORG_KEY]: 'rejected' },
      transport: [],
      executionId: undefined,
      statusTransitions: [],
      chain: undefined,
      onchainEffectCount: undefined,
      observation: 'fixture',
    };
    expect(JSON.stringify(sanitize(evidence, [FAKE_ORG_KEY]))).toContain('kh_');
    expect(() => writeEvidence(evidence, [FAKE_ORG_KEY])).toThrow(CredentialLeakError);
  });

  /**
   * Ordering, not politeness. An earlier draft of the fixture above was sanitized cleanly, so
   * the guard did not fire and the writer left a file behind in a committed docs directory.
   * Validation happening before the first filesystem call is what keeps a refused write from
   * being a partial write.
   */
  it('creates no file when it refuses', () => {
    const id = 'leak-fixture';
    const evidence = {
      id,
      question: 'does a refused write leave anything behind',
      semanticAttemptId: undefined,
      challenge: undefined,
      idempotencyKey: undefined,
      requestBodyHash: undefined,
      requestBody: { [FAKE_ORG_KEY]: 'rejected' },
      transport: [],
      executionId: undefined,
      statusTransitions: [],
      chain: undefined,
      onchainEffectCount: undefined,
      observation: 'fixture',
    };
    expect(() => writeEvidence(evidence, [FAKE_ORG_KEY])).toThrow(CredentialLeakError);
    expect(existsSync(join(REPO_ROOT, EVIDENCE_DIR, `${id}.json`))).toBe(false);
  });
});

describe('semantic attempt identity', () => {
  it('is stable for the same scenario and run, and different across scenarios', async () => {
    const a = await semanticAttemptId('success', 'run-1');
    const again = await semanticAttemptId('success', 'run-1');
    const other = await semanticAttemptId('revert', 'run-1');
    const laterRun = await semanticAttemptId('success', 'run-2');
    expect(a).toBe(again);
    expect(a).not.toBe(other);
    expect(a).not.toBe(laterRun);
  });

  it('derives a bytes32 challenge from the attempt id', async () => {
    const challenge = await challengeFor(await semanticAttemptId('success', 'run-1'));
    expect(challenge).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('gives a transport retry the same key and a new economic action a different one', async () => {
    const first = await semanticAttemptId('success', 'run-1');
    const second = await semanticAttemptId('success-again', 'run-1');
    const challenge = await challengeFor(first);

    const retry = await prepareContractCall({
      semanticAttemptId: first,
      functionName: 'ping',
      abi: PING_ABI,
      challenge,
    });
    const sameAgain = await prepareContractCall({
      semanticAttemptId: first,
      functionName: 'ping',
      abi: PING_ABI,
      challenge,
    });
    const newAction = await prepareContractCall({
      semanticAttemptId: second,
      functionName: 'ping',
      abi: PING_ABI,
      challenge,
    });

    expect(retry.idempotencyKey).toBe(sameAgain.idempotencyKey);
    expect(retry.bodyText).toBe(sameAgain.bodyText);
    expect(newAction.idempotencyKey).not.toBe(retry.idempotencyKey);
  });

  it('serializes the body with sorted keys so a replay is byte-identical', async () => {
    const prepared = await prepareContractCall({
      semanticAttemptId: 'x',
      functionName: 'ping',
      abi: PING_ABI,
      challenge: `0x${'11'.repeat(32)}`,
      simulate: true,
    });
    const keys = Object.keys(JSON.parse(prepared.bodyText) as Record<string, unknown>);
    expect(keys).toStrictEqual([...keys].sort());
    expect(prepared.bodyHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('builds the absent-function call the revert case needs', async () => {
    const prepared = await prepareContractCall({
      semanticAttemptId: 'x',
      functionName: 'resurvSeamAbsentFunction',
      abi: ABSENT_FUNCTION_ABI,
      challenge: `0x${'22'.repeat(32)}`,
    });
    expect(prepared.body.functionName).toBe('resurvSeamAbsentFunction');
    expect(prepared.body.abi).toContain('resurvSeamAbsentFunction');
  });
});

describe('credential fingerprinting', () => {
  it('reports the prefix and the length and nothing else', () => {
    expect(describeCredential(FAKE_ORG_KEY)).toBe(`kh_…(${FAKE_ORG_KEY.length} chars)`);
    expect(describeCredential(FAKE_ORG_KEY)).not.toContain(FAKE_ORG_KEY.slice(3, 12));
  });
});

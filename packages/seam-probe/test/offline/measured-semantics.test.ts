/**
 * The Phase 0.5 findings, asserted against the committed evidence.
 *
 * `docs/phase-logs/PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md` makes claims about KeeperHub, and
 * `docs/CLAIMS.md` promotes rows on their strength. This file is what stops those from drifting
 * into prose nobody checks: every load-bearing sentence in the report is a `expect` here,
 * reading the JSON the probe wrote.
 *
 * It makes no network call and runs in `pnpm gate`. It cannot detect a KeeperHub behavior
 * change; only re-running the live probe does that. What it detects is a claim that stopped
 * matching its own evidence, which is the failure this repository has already had once.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVIDENCE_DIR } from '../../src/evidence.ts';
import { CANARY_ADDRESS } from '../../src/fixture.ts';
import { REPO_ROOT } from '../../src/local-env.ts';

const ORG_WALLET = '0xfd35ae935de7be93ffd585d6627268d833ed834c';

interface Transport {
  readonly method: string;
  readonly path: string;
  readonly sentAt: string;
  readonly httpStatus: number | null;
  readonly responseBody: Record<string, unknown> | null;
  readonly responseHeaders: Record<string, string>;
  readonly transportError: string | null;
  readonly idempotencyKey: string | null;
}

interface Evidence {
  readonly id: string;
  readonly challenge: string | null;
  readonly idempotencyKey: string | null;
  readonly executionId: string | null;
  readonly transport: readonly Transport[];
  readonly statusTransitions: readonly {
    readonly status: string | null;
    readonly transactionHash: string | null;
    readonly receiptStatus: string | null;
    readonly pollIntervalHint: string | null;
    readonly body: Record<string, unknown>;
  }[];
  readonly chain: {
    readonly receiptVerdict: string;
    readonly gasLimit: string | null;
    readonly receiptStatusHex: string | null;
    readonly decodedSenderTopic: string | null;
    readonly decodedChallengeTopic: string | null;
    readonly originsAgreed: boolean;
    readonly blockNumber: number | null;
    readonly transactionHash: string | null;
  } | null;
  readonly onchainEffectCount: number | null;
  readonly observation: string;
}

function evidence(id: string): Evidence {
  return JSON.parse(readFileSync(join(REPO_ROOT, EVIDENCE_DIR, `${id}.json`), 'utf8')) as Evidence;
}

const posts = (record: Evidence): Transport[] =>
  record.transport.filter((entry) => entry.method === 'POST');

describe('the evidence set is complete', () => {
  it.each([
    'P00-preflight',
    'P01-local-rejection',
    'P02-auth-failure',
    'P03-simulation-accepted',
    'P04-simulation-rejected',
    'P05-broadcast-confirmed',
    'P06-transport-retry',
    'P07-idempotency-conflict',
    'P08-semantic-replay',
    'P09-broadcast-absent-selector',
    'P10-broadcast-reverted',
    'P11-transport-abort',
    'P12-unknown-execution',
    'P13-deferred-replay',
    'P14-would-revert-broadcast-repeat',
    'P15-conflict-recovery-channel',
  ])('%s was recorded', (id) => {
    expect(evidence(id).observation.length).toBeGreaterThan(0);
  });

  it('carries no credential-shaped value anywhere', () => {
    const index = readFileSync(join(REPO_ROOT, EVIDENCE_DIR, 'index.json'), 'utf8');
    expect(/\b(kh|wfb)_[A-Za-z0-9_-]{4,}/.test(index)).toBe(false);
  });
});

describe('HTTP 202 does not mean broadcast', () => {
  /** The single most expensive misreading available at this seam. */
  it('a would-revert call answers 202 while the body says failed and nothing reaches chain', () => {
    const record = evidence('P09-broadcast-absent-selector');
    const post = posts(record)[0];
    expect(post?.httpStatus).toBe(202);
    expect(post?.responseBody?.['status']).toBe('failed');
    expect(record.statusTransitions[0]?.transactionHash).toBeNull();
    expect(record.statusTransitions[0]?.body['receipts']).toStrictEqual([]);
    expect(record.chain?.receiptVerdict).toBe('absent');
    expect(record.onchainEffectCount).toBe(0);
  });

  it('is deterministic across repeated attempts', () => {
    const record = evidence('P14-would-revert-broadcast-repeat');
    expect(record.onchainEffectCount).toBe(0);
    for (const post of posts(record)) {
      expect(post.httpStatus).toBe(202);
      expect(post.responseBody?.['status']).toBe('failed');
    }
  });

  it('reports the refusal as a balance shortfall, not as a revert', () => {
    // Recorded because it is misleading and a caller must not act on it: the same wallet, with
    // the same zero balance, executes the valid call sponsored in the same run.
    const record = evidence('P14-would-revert-broadcast-repeat');
    expect(record.observation).toContain('sponsored=false');
    expect(record.observation).toContain('Insufficient BASE balance');
    expect(evidence('P05-broadcast-confirmed').statusTransitions[0]?.body['sponsored']).toBe(true);
  });
});

describe('a confirmed attempt is confirmed by chain, not by KeeperHub', () => {
  const record = evidence('P05-broadcast-confirmed');

  it('returns only executionId and status in the 202, never a transaction hash', () => {
    const body = posts(record)[0]?.responseBody ?? {};
    expect(Object.keys(body).sort()).toStrictEqual(['executionId', 'status']);
  });

  it('supplies the hash on the status endpoint, with a terminal poll hint', () => {
    const first = record.statusTransitions[0];
    expect(first?.status).toBe('completed');
    expect(first?.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(first?.receiptStatus).toBe('success');
    expect(first?.pollIntervalHint).toBe('0');
  });

  it('is corroborated by two independent RPC origins that agree', () => {
    expect(record.chain?.receiptStatusHex).toBe('0x1');
    expect(record.chain?.originsAgreed).toBe(true);
  });

  it('puts the organization wallet in the event even though it is neither sender nor payer', () => {
    // The receipt's `from` is a relayer and its `to` is a router. Access control at the target
    // keys on the org wallet, which appears only in the decoded log.
    expect(record.chain?.decodedSenderTopic).toBe(`0x${'0'.repeat(24)}${ORG_WALLET.slice(2)}`);
    expect(record.statusTransitions[0]?.body['sponsored']).toBe(true);
  });

  it('produces exactly one economic effect', () => {
    expect(record.onchainEffectCount).toBe(1);
  });
});

describe('idempotency bounds effects per key, not per action', () => {
  it('replaying the same key returns the same execution and adds no effect', () => {
    const record = evidence('P06-transport-retry');
    const body = posts(record)[0]?.responseBody ?? {};
    expect(body['idempotentReplay']).toBe(true);
    expect(body['executionId']).toBe(evidence('P05-broadcast-confirmed').executionId);
    expect(record.onchainEffectCount).toBe(1);
  });

  it('a new key for the same economic action executes it a second time', () => {
    // The whole reason RESURV needs an onchain attempt id. Transport idempotency is not
    // semantic idempotency and this is the measurement that says so.
    const record = evidence('P08-semantic-replay');
    expect(record.onchainEffectCount).toBe(2);
    expect(record.executionId).not.toBe(evidence('P05-broadcast-confirmed').executionId);
  });

  it('the same key with a different body is refused and executes nothing', () => {
    const record = evidence('P07-idempotency-conflict');
    const body = posts(record)[0]?.responseBody ?? {};
    expect(posts(record)[0]?.httpStatus).toBe(409);
    expect(body['code']).toBe('idempotency_conflict');
    expect(body['retryable']).toBe(false);
    expect(record.onchainEffectCount).toBe(0);
  });
});

describe('a lost response is resolvable, and the ambiguity is real', () => {
  it('the client is left with no HTTP status at all', () => {
    const aborted = posts(evidence('P11-transport-abort'))[0];
    expect(aborted?.httpStatus).toBeNull();
    expect(aborted?.transportError).toContain('probe-abort');
  });

  it('no list endpoint exists for direct executions, confirmed by a live 404', () => {
    // The load-bearing premise of ADR-004, previously DOCUMENTED and never probed.
    const record = evidence('P11-transport-abort');
    const lists = record.transport.filter((entry) => entry.method === 'GET');
    expect(lists.map((entry) => entry.path).sort()).toStrictEqual([
      '/api/execute',
      '/api/executions',
    ]);
    for (const entry of lists) {
      expect(entry.httpStatus).toBe(404);
      expect(entry.responseBody?.['error']).toBe('not_found');
      expect(entry.responseBody?.['request_id']).toEqual(expect.any(String));
    }
  });

  /**
   * Which side of the race an abort lands on is not reproducible, so asserting that `P11`
   * committed and `P13` did not would be a flaky test dressed as a finding. What *is* an
   * invariant is the rule connecting the marker to the timing: `idempotentReplay: true` means
   * an earlier request created the execution, and its absence means the replay did. That holds
   * whichever way the race falls, and it is the rule the recovery algorithm depends on.
   */
  it.each(['P11-transport-abort', 'P13-deferred-replay'])(
    'in %s the replay marker agrees with when the execution was created',
    (id) => {
      const record = evidence(id);
      const replay = posts(record).at(-1);
      const createdAt = record.statusTransitions[0]?.body['createdAt'];
      if (replay === undefined || typeof createdAt !== 'string') return;

      const replayedAt = Date.parse(replay.sentAt);
      const created = Date.parse(createdAt);
      if (replay.responseBody?.['idempotentReplay'] === true) {
        expect(
          created,
          'a replayed response must name an execution that already existed',
        ).toBeLessThan(replayedAt);
      } else {
        expect(
          created,
          'without the marker, this request is the one that committed the key',
        ).toBeGreaterThan(replayedAt);
      }
    },
  );

  /**
   * The invariant, and the only thing a recovery may rely on: **at most one economic effect per
   * idempotency key**. Whether a given abort committed is a race and varies run to run; that it
   * never produced two is what makes replaying a key safe.
   */
  it.each(['P11-transport-abort', 'P13-deferred-replay', 'P15-conflict-recovery-channel'])(
    '%s produced at most one economic effect despite the lost response',
    (id) => {
      expect(evidence(id).onchainEffectCount ?? 0).toBeLessThanOrEqual(1);
    },
  );

  /**
   * A 409 conflict is always a refusal to execute the new body, and it *sometimes* names the
   * execution the key already created. Both branches have been observed: the run of
   * 2026-08-12T15-35 named `0uudacxzflm0nf2k9p92t`, and the run of 2026-08-12T16-18 named
   * nothing because the aborted request had registered the key without creating an execution.
   *
   * So key registration and execution creation are separate events, and a client must treat
   * `originalExecutionId` as a bonus rather than as the recovery route. That is why the chain
   * read is step 2 of the algorithm and not step 4.
   */
  it('a 409 conflict refuses the new body, and names the original execution when there is one', () => {
    const record = evidence('P15-conflict-recovery-channel');
    const conflict = posts(record)[1];
    expect(conflict?.httpStatus).toBe(409);
    expect(conflict?.responseBody?.['code']).toBe('idempotency_conflict');
    expect(conflict?.responseBody?.['retryable']).toBe(false);
    expect(record.observation).toContain('effects for the conflicting body=0');

    // Absent fields serialize as `null` in the evidence, so the guard is on the type.
    const named = conflict?.responseBody?.['originalExecutionId'];
    if (typeof named === 'string') {
      expect(record.executionId).toBe(named);
    }
  });

  it('chain answers even when KeeperHub supplies no hash', () => {
    const record = evidence('P11-transport-abort');
    expect(record.chain?.receiptVerdict).toBe('success');
    expect(record.chain?.decodedChallengeTopic).toBe(record.challenge);
    expect(record.chain?.originsAgreed).toBe(true);
  });
});

describe('simulation', () => {
  it('answers a would-revert call with 400 and creates no execution', () => {
    const record = evidence('P04-simulation-rejected');
    const body = posts(record)[0]?.responseBody ?? {};
    expect(posts(record)[0]?.httpStatus).toBe(400);
    expect(body['wouldRevert']).toBe(true);
    expect(body['failureKind']).toBe('revert');
    expect(body['executionId']).toBeUndefined();
  });

  it('runs as the organization wallet and touches nothing', () => {
    const record = evidence('P03-simulation-accepted');
    const body = posts(record)[0]?.responseBody ?? {};
    expect(body['from']).toBe(ORG_WALLET);
    expect(body['to']).toBe(CANARY_ADDRESS);
    expect(body['wouldRevert']).toBe(false);
    expect(record.onchainEffectCount).toBe(0);
  });
});

describe('transport facts a client has to honor', () => {
  it('the direct execution rate limit really is 60 per minute', () => {
    // Two official pages disagreed, 60 and 100. The header settles it.
    const headers = posts(evidence('P05-broadcast-confirmed'))[0]?.responseHeaders ?? {};
    expect(headers['x-ratelimit-limit']).toBe('60');
    expect(headers['x-ratelimit-remaining']).toEqual(expect.any(String));
  });

  it('an unknown execution id answers 404 with a bare error and no request_id', () => {
    const record = evidence('P12-unknown-execution');
    for (const entry of record.transport) {
      expect(entry.httpStatus).toBe(404);
      expect(Object.keys(entry.responseBody ?? {})).toStrictEqual(['error']);
    }
  });

  it('gasLimitMultiplier below 1.0 was sent and did not reduce the gas limit', () => {
    /**
     * The gas-starvation route to an onchain revert. It did not work.
     *
     * The comparison is on the gas *limit*, which is what a multiplier would move, and it is a
     * ratio rather than an equality: two runs of the identical call differ by a few dozen gas,
     * so an earlier version of this test asserting byte-equality passed once by luck and failed
     * on the next run. A multiplier of 0.951 would show as a 4.9% reduction. The observed
     * difference is under 1%.
     */
    const starved = evidence('P10-broadcast-reverted');
    const plain = evidence('P05-broadcast-confirmed');
    expect(starved.observation).toContain('multiplier=0.951');
    expect(starved.chain?.receiptVerdict).toBe('success');

    const starvedLimit = Number.parseInt(starved.chain?.gasLimit ?? '0x0', 16);
    const plainLimit = Number.parseInt(plain.chain?.gasLimit ?? '0x0', 16);
    expect(starvedLimit).toBeGreaterThan(0);
    expect(starvedLimit / plainLimit).toBeGreaterThan(0.99);
  });
});

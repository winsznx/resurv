import { describe, expect, it } from 'vitest';
import worker from '../../src/index.ts';

/**
 * The public proof surface, exercised end to end through the Worker's own fetch handler.
 *
 * These are the first specs in this harness. Until now `pnpm test:integration` ran with
 * `--passWithNoTests` against a directory holding a README, which `docs/BUILD_STATE.md` listed
 * as a known defect rather than as coverage.
 *
 * What they hold up: a judge with no credential can reach every fact the page claims, and the
 * Worker cannot leak one, because it never receives one. Every route below is served with an
 * empty binding object.
 */

const NO_BINDINGS = {};
const ctx = {} as ExecutionContext;
const get = (path: string) =>
  worker.fetch(new Request(`https://resurv.test${path}`), NO_BINDINGS, ctx);

describe('the proof surface needs no credential', () => {
  it('serves the receipt with no bindings configured at all', async () => {
    // #when
    const response = await get('/api/proof');

    // #then
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, Record<string, unknown>>;
    expect(body['covenant']?.['covenantId']).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body['outcome']?.['satisfied']).toBe(true);
  });

  it('serves the deployment manifest', async () => {
    // #when
    const response = await get('/api/deployment');

    // #then
    expect(response.status).toBe(200);
    const body = (await response.json()) as { chainId: number; contracts: Record<string, unknown> };
    expect(body.chainId).toBe(84532);
    expect(Object.keys(body.contracts)).toContain('ResurvCovenantManager');
  });

  it('answers every summary check affirmatively for the covenant that ran', async () => {
    // #when
    const response = await get('/api/proof/summary');

    // #then: this is the endpoint an independent verifier is expected to disagree with
    const body = (await response.json()) as { checks: Record<string, boolean> };
    for (const [name, value] of Object.entries(body.checks)) {
      expect(value, `${name} is false`).toBe(true);
    }
  });

  it('links the success transaction to an explorer', async () => {
    // #when
    const response = await get('/api/proof');

    // #then
    const body = (await response.json()) as { successTransaction: { link: string; hash: string } };
    expect(body.successTransaction.link).toContain('sepolia.basescan.org/tx/');
    expect(body.successTransaction.link).toContain(body.successTransaction.hash);
  });

  it('never serves a credential-shaped value on any public route', async () => {
    // #when
    const bodies = await Promise.all(
      ['/api/proof', '/api/deployment', '/api/proof/summary'].map(async (path) =>
        (await get(path)).text(),
      ),
    );

    // #then
    for (const body of bodies) {
      expect(body).not.toMatch(/\b(kh|wfb)_[A-Za-z0-9_-]{4,}/);
      expect(body).not.toMatch(/\bsb[a-z]?_[A-Za-z0-9_-]{8,}/);
    }
  });

  it('answers an unknown route with a typed 404 rather than a stack trace', async () => {
    // #when
    const response = await get('/api/nonexistent');

    // #then
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string; detail: string };
    expect(body.error).toBe('not_found');
    expect(body.detail).toContain('/api/nonexistent');
  });
});

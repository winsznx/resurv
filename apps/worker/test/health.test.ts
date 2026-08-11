import { describe, expect, it } from 'vitest';
import worker from '../src/index.ts';

const request = (path: string) => new Request(`https://resurv.test${path}`);

const validEnv = { KEEPERHUB_API_KEY: 'kh_test_key' };

// The Worker's fetch handler is a plain function, so it can be exercised directly without
// booting workerd. Bindings-dependent tests belong in test/integration under the Workers pool.
const ctx = {} as ExecutionContext;

describe('GET /api/health', () => {
  it('reports ok and the target chain when configuration is valid', async () => {
    const response = await worker.fetch(request('/api/health'), validEnv, ctx);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body['status']).toBe('ok');
    expect(body['chainId']).toBe(84532);
    expect(body['chainName']).toBe('Base Sepolia');
  });

  it('returns 503 and names the missing variables when configuration is invalid', async () => {
    const response = await worker.fetch(request('/api/health'), {}, ctx);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues.join(' ')).toContain('KEEPERHUB_API_KEY');
  });

  it('never echoes a secret value in the health response', async () => {
    const response = await worker.fetch(request('/api/health'), validEnv, ctx);
    expect(await response.text()).not.toContain('kh_test_key');
  });

  it('rejects a webhook key at the health check rather than at first execution', async () => {
    const response = await worker.fetch(
      request('/api/health'),
      { KEEPERHUB_API_KEY: 'wfb_test_key' },
      ctx,
    );
    expect(response.status).toBe(503);
  });
});

describe('unknown routes', () => {
  it('returns a structured 404 rather than an empty body', async () => {
    const response = await worker.fetch(request('/api/nope'), validEnv, ctx);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe('not_found');
  });
});

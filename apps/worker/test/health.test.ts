import { afterEach, describe, expect, it, vi } from 'vitest';
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

/**
 * The error path is the one place an arbitrary string reaches a log line. A binding object
 * that throws while being read produces a plain Error carrying whatever the thrower put in
 * it, which is the realistic shape of a leak: an upstream message quoted into our logs.
 */
describe('the unhandled error path', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const hostileEnv = new Proxy(
    {},
    {
      get() {
        throw new Error('binding read failed for key kh_TEST_SECRET_VALUE');
      },
    },
  );

  it('answers 500 without a detail body', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await worker.fetch(request('/api/health'), hostileEnv, ctx);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('kh_TEST_SECRET_VALUE');
  });

  it('redacts the secret out of the log line rather than printing the error raw', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await worker.fetch(request('/api/health'), hostileEnv, ctx);
    expect(logged).toHaveBeenCalled();
    const line = logged.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(line).not.toContain('kh_TEST_SECRET_VALUE');
    expect(line).toContain('[redacted]');
  });
});

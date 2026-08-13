import { describe, expect, it } from 'vitest';
import { ConfigError, parseWorkerEnv, redactEnv } from '../src/index.ts';

const valid = {
  KEEPERHUB_API_KEY: 'kh_live_example',
};

describe('parseWorkerEnv', () => {
  it('applies Base Sepolia defaults when only the key is supplied', () => {
    const env = parseWorkerEnv(valid);
    expect(env.CHAIN_ID).toBe(84532);
    expect(env.ENVIRONMENT).toBe('development');
    expect(env.RPC_URL_PRIMARY).toBe('https://sepolia.base.org');
  });

  it('rejects a webhook key by name rather than failing later with a 401', () => {
    expect(() => parseWorkerEnv({ KEEPERHUB_API_KEY: 'wfb_example' })).toThrow(ConfigError);
    try {
      parseWorkerEnv({ KEEPERHUB_API_KEY: 'wfb_example' });
    } catch (error) {
      expect((error as ConfigError).message).toContain('kh_');
    }
  });

  it('reports every problem at once instead of one per run', () => {
    try {
      parseWorkerEnv({ KEEPERHUB_API_KEY: '', RPC_URL_PRIMARY: 'not-a-url' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ConfigError).issues.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('does not require a KeeperHub credential, because nothing the Worker serves executes', () => {
    const env = parseWorkerEnv({ ENVIRONMENT: 'production' });
    expect(env.KEEPERHUB_API_KEY).toBeUndefined();
    expect(env.CHAIN_ID).toBe(84532);
  });

  it('rejects a malformed contract address', () => {
    expect(() => parseWorkerEnv({ ...valid, RESURV_CONTRACT_ADDRESS: '0x1234' })).toThrow(
      ConfigError,
    );
  });
});

describe('redactEnv', () => {
  it('redacts every declared secret and leaves runtime config readable', () => {
    const redacted = redactEnv({
      KEEPERHUB_API_KEY: 'kh_live_secret',
      SUPABASE_SERVICE_ROLE_KEY: 'service_role_secret',
      CHAIN_ID: 84532,
    });
    expect(redacted['KEEPERHUB_API_KEY']).toBe('[redacted]');
    expect(redacted['SUPABASE_SERVICE_ROLE_KEY']).toBe('[redacted]');
    expect(redacted['CHAIN_ID']).toBe(84532);
  });

  it('does not invent a redacted marker for an absent secret', () => {
    expect(redactEnv({ CHAIN_ID: 1 })['KEEPERHUB_API_KEY']).toBeUndefined();
  });

  it('never leaks a secret substring', () => {
    const serialized = JSON.stringify(redactEnv({ KEEPERHUB_API_KEY: 'kh_live_secret' }));
    expect(serialized).not.toContain('kh_live_secret');
  });
});

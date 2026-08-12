import { describe, expect, it } from 'vitest';
import { knownSecretValues, redact, redactEnv, redactedJson, redactString } from '../src/index.ts';

/**
 * Adversarial redaction tests. Every value below is a deterministic fake with TEST in it, so
 * a real credential never enters this repository, and every assertion is made against the
 * serialized output rather than the shape of the returned object: what matters is that the
 * bytes cannot reach a log.
 *
 * The nested cases are the Phase 0 defect. `redactEnv({ inner: { KEEPERHUB_API_KEY: ... } })`
 * and `redactEnv({ list: [...] })` both returned the secret verbatim.
 */

const FAKE = {
  keeperhubOrgKey: 'kh_TEST_SECRET',
  keeperhubWebhookKey: 'wfb_TEST_SECRET',
  supabaseServiceRole: 'eyJhbGciOiJIUzI1NiJ9.TEST_PAYLOAD_NOT_REAL.TEST_SIGNATURE_NOT_REAL',
  supabaseSecretKey: 'sb_secret_TESTTESTTESTTEST',
  cloudflareToken: 'CfTESTtoken0123456789abcdefghijABCDEFGHI',
  privateKey: `0x${'ab'.repeat(32)}`,
  databaseUrl: 'postgresql://resurv:TESTpassword@db.example.invalid:5432/resurv',
  pem: '-----BEGIN EC PRIVATE KEY-----\nTESTKEYMATERIAL\n-----END EC PRIVATE KEY-----',
} as const;

const ALL_FAKES = Object.values(FAKE);

function assertNothingSurvives(value: unknown, options?: Parameters<typeof redact>[1]): void {
  const serialized = redactedJson(value, options);
  for (const secret of ALL_FAKES) {
    expect(serialized, `leaked ${secret.slice(0, 12)}…`).not.toContain(secret);
  }
}

describe('the fixtures themselves', () => {
  it('are the shapes the patterns claim to cover', () => {
    expect(FAKE.cloudflareToken).toHaveLength(40);
    expect(FAKE.privateKey).toHaveLength(66);
    expect(FAKE.supabaseServiceRole.split('.')).toHaveLength(3);
  });
});

describe('shape-based redaction, whatever the key is called', () => {
  it.each(Object.entries(FAKE))('redacts a %s hidden under an innocuous key', (_label, secret) => {
    expect(redactString(`value=${secret}`)).not.toContain(secret);
    assertNothingSurvives({ note: `value=${secret}` });
    assertNothingSurvives({ harmlessLookingField: secret });
  });
});

describe('structures the Phase 0 implementation could not reach', () => {
  it('redacts a secret nested one level down', () => {
    assertNothingSurvives({ inner: { KEEPERHUB_API_KEY: FAKE.keeperhubOrgKey } });
  });

  it('redacts a secret inside an array', () => {
    assertNothingSurvives({ list: [FAKE.keeperhubOrgKey] });
  });

  it('redacts a secret inside nested arrays', () => {
    assertNothingSurvives({ list: [[[FAKE.supabaseServiceRole]]] });
  });

  it('redacts a secret inside an object inside an array', () => {
    assertNothingSurvives([{ config: { SUPABASE_SERVICE_ROLE_KEY: FAKE.supabaseServiceRole } }]);
  });

  it('redacts a secret inside a Map and a Set', () => {
    assertNothingSurvives({
      byName: new Map([['KEEPERHUB_API_KEY', FAKE.keeperhubOrgKey]]),
      seen: new Set([FAKE.privateKey]),
    });
  });

  it('redacts a secret carried on an Error message and stack', () => {
    const error = new Error(`request failed with Authorization: Bearer ${FAKE.keeperhubOrgKey}`);
    assertNothingSurvives({ cause: error });
    assertNothingSurvives(error);
  });

  it('survives a cycle instead of hanging or throwing', () => {
    const node: Record<string, unknown> = { KEEPERHUB_API_KEY: FAKE.keeperhubOrgKey };
    node['self'] = node;
    node['children'] = [node, { deep: node }];
    assertNothingSurvives(node);
    expect(redactedJson(node)).toContain('[circular]');
  });

  it('stops at a depth bound rather than recursing without limit', () => {
    let deep: Record<string, unknown> = { KEEPERHUB_API_KEY: FAKE.keeperhubOrgKey };
    for (let i = 0; i < 200; i += 1) deep = { level: deep };
    assertNothingSurvives(deep);
    expect(redactedJson(deep)).toContain('[max-depth]');
  });

  it('handles null, undefined and primitives without inventing values', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(10n)).toBe('10');
    expect(redact({ present: null, missing: undefined })).toStrictEqual({
      present: null,
      missing: undefined,
    });
  });
});

describe('values known from parsed configuration', () => {
  const env = {
    KEEPERHUB_API_KEY: FAKE.keeperhubOrgKey,
    DATABASE_URL: FAKE.databaseUrl,
    CHAIN_ID: 84532,
  };

  it('collects the declared secret values', () => {
    expect(knownSecretValues(env)).toStrictEqual([FAKE.keeperhubOrgKey, FAKE.databaseUrl]);
    expect(knownSecretValues(null)).toStrictEqual([]);
  });

  it('redacts a known value quoted back under a harmless key', () => {
    const known = knownSecretValues(env);
    assertNothingSurvives(
      { upstreamMessage: `unauthorized key ${FAKE.keeperhubOrgKey}` },
      {
        knownSecrets: known,
      },
    );
    assertNothingSurvives({ trace: { url: FAKE.databaseUrl } }, { knownSecrets: known });
  });
});

describe('redactEnv keeps its contract', () => {
  it('redacts every declared secret and leaves runtime config readable', () => {
    const redacted = redactEnv({
      KEEPERHUB_API_KEY: FAKE.keeperhubOrgKey,
      SUPABASE_SERVICE_ROLE_KEY: FAKE.supabaseServiceRole,
      DATABASE_URL: FAKE.databaseUrl,
      CHAIN_ID: 84532,
      RPC_URL_PRIMARY: 'https://sepolia.base.org',
    });
    expect(redacted['KEEPERHUB_API_KEY']).toBe('[redacted]');
    expect(redacted['SUPABASE_SERVICE_ROLE_KEY']).toBe('[redacted]');
    expect(redacted['DATABASE_URL']).toBe('[redacted]');
    expect(redacted['CHAIN_ID']).toBe(84532);
    expect(redacted['RPC_URL_PRIMARY']).toBe('https://sepolia.base.org');
  });

  it('does not invent a redacted marker for an absent secret', () => {
    expect(redactEnv({ CHAIN_ID: 1 })['KEEPERHUB_API_KEY']).toBeUndefined();
  });

  it('redacts a declared secret at any depth, not only at the top level', () => {
    assertNothingSurvives(
      redactEnv({ bindings: { worker: { KEEPERHUB_API_KEY: FAKE.keeperhubOrgKey } } }),
    );
    assertNothingSurvives(redactEnv({ candidates: [FAKE.keeperhubOrgKey] }));
  });
});

describe('deliberate over-redaction, recorded rather than discovered later', () => {
  it('redacts a transaction hash, because it is the same shape as a private key', () => {
    const transactionHash = `0x${'12'.repeat(32)}`;
    expect(redactString(transactionHash)).toBe('[redacted]');
  });

  it('leaves a short lowercase hex string such as a commit sha alone', () => {
    expect(redactString('bae51c3')).toBe('bae51c3');
  });

  it('leaves ordinary prose alone', () => {
    const message = 'covenant 42 moved from ARMED to TRIGGERED on chain 84532';
    expect(redactString(message)).toBe(message);
  });
});

describe('diagnostics never become the failure', () => {
  /**
   * N6 from the Phase 0 remediation review. `knownSecretValues` guarded property access from
   * the start, with the stated reason that a Worker binding can be a proxy that throws. The
   * walker did not, so `onError` calling `redactedJson` on a value with a throwing getter
   * would have thrown inside the handler whose whole job is to keep the Worker up.
   */
  it('survives a throwing property getter', () => {
    const hostile = {
      ok: 'plain',
      get boom(): string {
        throw new Error('property access denied');
      },
    };
    expect(() => redactedJson(hostile)).not.toThrow();
    expect(redactedJson(hostile)).toContain('[unreadable]');
    expect(redactedJson(hostile)).toContain('plain');
  });

  it('survives a throwing getter nested inside a structure', () => {
    const hostile = {
      level: {
        list: [
          {
            get token(): string {
              throw new Error('property access denied');
            },
          },
        ],
      },
    };
    expect(() => redactedJson(hostile)).not.toThrow();
  });

  it('survives an Error whose message getter throws', () => {
    const hostile = new Error('placeholder');
    Object.defineProperty(hostile, 'message', {
      get(): string {
        throw new Error('property access denied');
      },
      enumerable: false,
      configurable: true,
    });
    expect(() => redactedJson(hostile)).not.toThrow();
    expect(redactedJson(hostile)).toContain('[unreadable]');
  });

  it('survives a proxy that throws on every read, in redact and in knownSecretValues alike', () => {
    const hostile = new Proxy(
      {},
      {
        get(): never {
          throw new Error('binding unavailable');
        },
        ownKeys(): string[] {
          return ['KEEPERHUB_API_KEY'];
        },
        getOwnPropertyDescriptor(): PropertyDescriptor {
          return { enumerable: true, configurable: true };
        },
      },
    );
    expect(knownSecretValues(hostile)).toStrictEqual([]);
    expect(() => redactedJson(hostile)).not.toThrow();
  });

  it('still drops a symbol-keyed or non-enumerable secret rather than serializing it', () => {
    const marker = Symbol('KEEPERHUB_API_KEY');
    const value: Record<string | symbol, unknown> = { [marker]: FAKE.keeperhubOrgKey };
    Object.defineProperty(value, 'hidden', {
      value: FAKE.keeperhubOrgKey,
      enumerable: false,
    });
    assertNothingSurvives(redact(value));
  });
});

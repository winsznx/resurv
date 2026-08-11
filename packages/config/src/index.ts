import { z } from 'zod';
import { type RedactionOptions, redact } from './redact.ts';

export * from './redact.ts';

/**
 * Environment validation. Every process validates at startup and refuses to run on a
 * partial configuration, because a missing secret discovered mid-attempt is far more
 * expensive than a missing secret discovered at boot.
 *
 * Nothing here reads process.env directly. Callers pass the environment in, which is what
 * makes this usable from a Cloudflare Worker where bindings arrive per request.
 */

const hexAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 20-byte hex address');

const secret = z.string().min(1, 'must not be empty');

/**
 * Secrets. Never logged, never returned by an API, never rendered in the browser bundle.
 */
export const serverSecretsSchema = z.object({
  KEEPERHUB_API_KEY: secret.refine(
    (value) => value.startsWith('kh_'),
    'must be an organization key starting with kh_ (a wfb_ webhook key cannot execute)',
  ),
  DATABASE_URL: secret.optional(),
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: secret.optional(),
});

/**
 * Non-secret runtime configuration. Safe to log and safe to commit as defaults.
 */
export const runtimeConfigSchema = z.object({
  ENVIRONMENT: z.enum(['development', 'preview', 'production']).default('development'),
  CHAIN_ID: z.coerce.number().int().positive().default(84532),
  RPC_URL_PRIMARY: z.url().default('https://sepolia.base.org'),
  RPC_URL_SECONDARY: z.url().default('https://base-sepolia-rpc.publicnode.com'),
  RESURV_CONTRACT_ADDRESS: hexAddress.optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const workerEnvSchema = serverSecretsSchema.extend(runtimeConfigSchema.shape);

export type ServerSecrets = z.infer<typeof serverSecretsSchema>;
export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`invalid configuration:\n  ${issues.join('\n  ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/**
 * Throws a ConfigError naming every missing or malformed variable at once. Reporting one
 * at a time turns first-run setup into a guessing loop.
 */
export function parseWorkerEnv(source: unknown): WorkerEnv {
  const result = workerEnvSchema.safeParse(source);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}

/**
 * Redaction for logs and error reports. Secrets must never reach a log line, a receipt, a
 * screenshot, or a phase summary. The mechanism lives in `./redact.ts`; what this file adds
 * is knowledge of which keys this project declares as secret.
 */
export const DECLARED_SECRET_KEYS: readonly string[] = Object.keys(serverSecretsSchema.shape);

/**
 * The secret values present in a raw environment, so they can be redacted out of a message
 * that happens to quote one under an innocuous key.
 */
export function knownSecretValues(source: unknown): string[] {
  if (typeof source !== 'object' || source === null) return [];
  const record = source as Record<string, unknown>;
  return DECLARED_SECRET_KEYS.map((key) => readStringOrNothing(record, key)).filter(
    (value): value is string => value !== undefined,
  );
}

/**
 * A Worker binding object can be a proxy that throws on property access. Diagnostics must
 * never be the thing that takes the Worker down, so an unreadable key is one fewer known
 * secret rather than an exception.
 */
function readStringOrNothing(record: Record<string, unknown>, key: string): string | undefined {
  try {
    const value = record[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Recursive, cycle-safe. Nested objects and arrays are redacted to the same standard as the
 * top level, which the Phase 0 implementation did not do.
 */
export function redactEnv(
  source: Record<string, unknown>,
  options: RedactionOptions = {},
): Record<string, unknown> {
  return redact(source, {
    ...options,
    additionalSecretKeys: [...DECLARED_SECRET_KEYS, ...(options.additionalSecretKeys ?? [])],
    knownSecrets: [...knownSecretValues(source), ...(options.knownSecrets ?? [])],
  }) as Record<string, unknown>;
}

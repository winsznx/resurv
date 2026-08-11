import { z } from 'zod';

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
 * screenshot, or a phase summary.
 */
const SECRET_KEYS: ReadonlySet<string> = new Set(Object.keys(serverSecretsSchema.shape));

export function redactEnv(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = SECRET_KEYS.has(key) && value !== undefined ? '[redacted]' : value;
  }
  return out;
}

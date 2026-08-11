/**
 * Redaction for anything that might be logged, returned in an error, or pasted into a phase
 * summary.
 *
 * The Phase 0 version walked one level of `Object.entries` and matched exactly the declared
 * secret key names. The independent review demonstrated the consequence in one line:
 *
 *   redactEnv({ inner: { KEEPERHUB_API_KEY: 'kh_LEAK' } })  ->  the key survived verbatim
 *   redactEnv({ list: ['kh_LEAK'] })                        ->  the key survived verbatim
 *
 * This version recurses through objects, arrays, maps, sets and errors, is safe against
 * cycles, and redacts on three independent grounds:
 *
 *   1. the key name looks secret-bearing, declared or not,
 *   2. the value has the shape of a credential, whatever the key is called,
 *   3. the value is a known secret pulled out of the parsed configuration.
 *
 * It fails closed. A transaction hash and a 32-byte private key are the same 66 characters,
 * so both are redacted; public chain data belongs in a proof serializer, not in a diagnostic
 * logger. `test/redact.test.ts` records that decision as a test rather than a comment.
 */

export const REDACTED = '[redacted]';
const CIRCULAR = '[circular]';
const TRUNCATED = '[max-depth]';

const DEFAULT_MAX_DEPTH = 12;

/**
 * Key names that make a value secret-bearing. Broader than the declared environment schema,
 * because diagnostics carry request headers, database URLs and third-party payloads too.
 */
const SECRET_KEY_PATTERNS: readonly RegExp[] = [
  /secret/i,
  /token/i,
  /password/i,
  /passphrase/i,
  /credential/i,
  /api[-_]?key/i,
  /private[-_]?key/i,
  /mnemonic/i,
  /seed[-_]?phrase/i,
  /authorization/i,
  /^auth$/i,
  /cookie/i,
  /session/i,
  /service[-_]?role/i,
  /signature/i,
  /_key$/i,
  /^key$/i,
];

/**
 * Value shapes that are credentials wherever they appear. Each pattern is here because a
 * real system emits that shape, not because it looked plausible.
 */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  // KeeperHub organization and webhook keys.
  /\b(kh|wfb)_[A-Za-z0-9_-]{4,}/g,
  // Supabase publishable and secret keys.
  /\bsb[a-z]?_[A-Za-z0-9_-]{8,}/g,
  // JWT, which is how a Supabase service-role key arrives.
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g,
  // 32 bytes of hex: an EVM private key. Also a transaction hash. See the note above.
  /\b0x[0-9a-fA-F]{64}\b/g,
  // PEM key material.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // A connection string carrying a password.
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@[^\s]+/g,
  // Cloudflare API token: 40 characters of base62 with mixed case.
  /\b(?=[A-Za-z0-9_-]{40}\b)(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]{40}\b/g,
];

export interface RedactionOptions {
  /** Values pulled from parsed configuration. Redacted wherever they appear, in any key. */
  readonly knownSecrets?: Iterable<string>;
  /** Exact key names to treat as secret-bearing, on top of the shape rules. */
  readonly additionalSecretKeys?: Iterable<string>;
  readonly maxDepth?: number;
}

function isSecretKey(key: string, options: RedactionOptions): boolean {
  for (const declared of options.additionalSecretKeys ?? []) {
    if (declared === key) return true;
  }
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Short values are not distinctive enough to search for without shredding ordinary text. */
const MIN_KNOWN_SECRET_LENGTH = 6;

export function redactString(value: string, options: RedactionOptions = {}): string {
  let out = value;
  for (const secret of options.knownSecrets ?? []) {
    if (secret.length < MIN_KNOWN_SECRET_LENGTH) continue;
    out = out.replaceAll(new RegExp(escapeRegExp(secret), 'g'), REDACTED);
  }
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

function redactValue(
  value: unknown,
  options: RedactionOptions,
  seen: Set<object>,
  depth: number,
): unknown {
  if (value === null || value === undefined) return value;

  switch (typeof value) {
    case 'string':
      return redactString(value, options);
    case 'number':
    case 'boolean':
      return value;
    case 'bigint':
      return `${value}`;
    case 'function':
      return '[function]';
    case 'symbol':
      return '[symbol]';
    default:
      break;
  }

  const object = value as object;
  if (seen.has(object)) return CIRCULAR;
  if (depth >= (options.maxDepth ?? DEFAULT_MAX_DEPTH)) return TRUNCATED;

  seen.add(object);
  try {
    return redactContainer(object, options, seen, depth);
  } finally {
    seen.delete(object);
  }
}

function redactContainer(
  value: object,
  options: RedactionOptions,
  seen: Set<object>,
  depth: number,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, options, seen, depth + 1));
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message, options),
      ...(value.stack === undefined ? {} : { stack: redactString(value.stack, options) }),
    };
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Map) {
    return redactEntries([...value.entries()], options, seen, depth);
  }
  if (value instanceof Set) {
    return [...value].map((entry) => redactValue(entry, options, seen, depth + 1));
  }
  return redactEntries(Object.entries(value), options, seen, depth);
}

function redactEntries(
  entries: readonly [unknown, unknown][],
  options: RedactionOptions,
  seen: Set<object>,
  depth: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [rawKey, entryValue] of entries) {
    const key = typeof rawKey === 'string' ? rawKey : String(rawKey);
    out[key] =
      isSecretKey(key, options) && entryValue !== undefined && entryValue !== null
        ? REDACTED
        : redactValue(entryValue, options, seen, depth + 1);
  }
  return out;
}

/** Recursive, cycle-safe redaction of an arbitrary diagnostic structure. */
export function redact(value: unknown, options: RedactionOptions = {}): unknown {
  return redactValue(value, options, new Set(), 0);
}

/** Serialize for a log line. Never call `JSON.stringify` on raw diagnostics instead. */
export function redactedJson(value: unknown, options: RedactionOptions = {}): string {
  return JSON.stringify(redact(value, options)) ?? 'null';
}

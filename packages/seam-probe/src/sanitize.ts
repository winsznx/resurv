/**
 * Evidence sanitization.
 *
 * `@resurv/config`'s `redact` is the right tool for a log line and the wrong tool for a proof
 * artifact: it fails closed on `0x` followed by 64 hex characters, because an EVM private key
 * and a transaction hash are the same 66 characters. A seam report whose transaction hashes
 * are all `[redacted]` proves nothing, and its own source file says public chain data belongs
 * in a proof serializer instead. This is that serializer.
 *
 * What it removes: credential-shaped values wherever they appear, the exact credential this
 * process loaded, and every authorization-bearing header by name. What it keeps: transaction
 * hashes, addresses, block numbers, calldata and revert data, which are the evidence.
 *
 * The asymmetry is deliberate and `test/offline/sanitize.test.ts` pins both halves.
 */

export const REDACTED = '[redacted]';

/**
 * Credential shapes. Every entry is here because a real system emits it. The 32-byte hex rule
 * from `@resurv/config` is deliberately absent, and nothing in this repository may add it back
 * without also deciding where transaction hashes are supposed to come from.
 */
const CREDENTIAL_VALUE_PATTERNS: readonly RegExp[] = [
  /\b(kh|wfb)_[A-Za-z0-9_-]{4,}/g,
  /\bsb[a-z]?_[A-Za-z0-9_-]{8,}/g,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@[^\s]+/g,
  // Not a credential, but `GET /api/keys` and `GET /api/user` return the operator's address
  // and this evidence is committed. The organization wallet address stays, because it is
  // public onchain data and is the thing `msg.sender` has to match.
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
];

/** Header names whose value is a credential regardless of its shape. */
const CREDENTIAL_HEADERS: readonly RegExp[] = [
  /^authorization$/i,
  /^proxy-authorization$/i,
  /^cookie$/i,
  /^set-cookie$/i,
  /^x-api-key$/i,
];

const SECRET_KEY_PATTERNS: readonly RegExp[] = [
  /secret/i,
  /password/i,
  /passphrase/i,
  /credential/i,
  /api[-_]?key/i,
  /private[-_]?key/i,
  /mnemonic/i,
  /^auth$/i,
  /authorization/i,
  /cookie/i,
];

/** Below this length a value is not distinctive enough to search for. */
const MIN_KNOWN_SECRET_LENGTH = 8;

export function isCredentialHeader(name: string): boolean {
  return CREDENTIAL_HEADERS.some((pattern) => pattern.test(name));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sanitizeString(value: string, knownSecrets: readonly string[] = []): string {
  let out = value;
  for (const secret of knownSecrets) {
    if (secret.length < MIN_KNOWN_SECRET_LENGTH) continue;
    out = out.replaceAll(new RegExp(escapeRegExp(secret), 'g'), REDACTED);
  }
  for (const pattern of CREDENTIAL_VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Recursive and cycle-safe. Anything that is not a plain container is stringified rather than
 * skipped, so an unexpected shape cannot smuggle a value past the string rules.
 */
export function sanitize(value: unknown, knownSecrets: readonly string[] = []): unknown {
  return walk(value, knownSecrets, new Set(), 0);
}

const MAX_DEPTH = 16;

/** Anything that is not an object. Unexpected primitives are stringified, never passed through. */
function walkScalar(value: unknown, knownSecrets: readonly string[]): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return sanitizeString(value, knownSecrets);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return sanitizeString(String(value), knownSecrets);
}

function walkContainer(
  object: object,
  knownSecrets: readonly string[],
  seen: Set<object>,
  depth: number,
): unknown {
  if (Array.isArray(object)) {
    return object.map((entry) => walk(entry, knownSecrets, seen, depth + 1));
  }
  if (object instanceof Error) {
    return { name: object.name, message: sanitizeString(object.message, knownSecrets) };
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(object as Record<string, unknown>)) {
    const secretKey = isSecretKey(key) && entry !== undefined && entry !== null;
    out[key] = secretKey ? REDACTED : walk(entry, knownSecrets, seen, depth + 1);
  }
  return out;
}

function walk(
  value: unknown,
  knownSecrets: readonly string[],
  seen: Set<object>,
  depth: number,
): unknown {
  if (typeof value !== 'object' || value === null) return walkScalar(value, knownSecrets);

  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[max-depth]';
  seen.add(value);
  try {
    return walkContainer(value, knownSecrets, seen, depth);
  } finally {
    seen.delete(value);
  }
}

export function sanitizeHeaders(
  headers: Headers,
  knownSecrets: readonly string[] = [],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    out[name] = isCredentialHeader(name) ? REDACTED : sanitizeString(value, knownSecrets);
  }
  return out;
}

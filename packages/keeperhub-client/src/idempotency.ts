/**
 * Idempotency key derivation for `/api/execute/contract-call`.
 *
 * KeeperHub publishes a canonical key recipe for `/transfer` only. For `/contract-call`
 * there is no published field list, so anyone deriving a stable key is guessing. We fix a
 * recipe here, document it, and test it, so a replay after a crash reproduces the same key.
 *
 * Scope note: KeeperHub idempotency is per organization and per endpoint. Other projects
 * may share this organization's key, so every RESURV key is namespaced to keep an unrelated
 * run from colliding with ours and returning 409 mid-demo.
 */

export const RESURV_IDEMPOTENCY_NAMESPACE = 'resurv/v1';

export interface ContractCallIdentity {
  readonly chainId: number;
  readonly contractAddress: string;
  readonly functionName: string;
  /** The exact string sent as `functionArgs`, which the API expects JSON-encoded. */
  readonly functionArgs: string;
  readonly value: string;
  /**
   * RESURV's semantic attempt id. Including it means a deliberate retry of a *different*
   * economic attempt gets a different key, while a crash-recovery replay of the *same*
   * attempt reuses it.
   */
  readonly semanticAttemptId: string;
}

function assertNoSeparator(field: string, value: string): void {
  if (value.includes('|')) {
    throw new Error(`idempotency field ${field} must not contain the "|" separator`);
  }
}

/**
 * Pipe-joined preimage. Address is lowercased because KeeperHub returns addresses
 * lowercased and a checksum difference must not produce a different key for the same call.
 */
export function idempotencyPreimage(identity: ContractCallIdentity): string {
  const fields: ReadonlyArray<[string, string]> = [
    ['namespace', RESURV_IDEMPOTENCY_NAMESPACE],
    ['semanticAttemptId', identity.semanticAttemptId],
    ['chainId', String(identity.chainId)],
    ['contractAddress', identity.contractAddress.toLowerCase()],
    ['functionName', identity.functionName],
    ['functionArgs', identity.functionArgs],
    ['value', identity.value],
  ];
  for (const [name, value] of fields) {
    assertNoSeparator(name, value);
  }
  return fields.map(([, value]) => value).join('|');
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function deriveIdempotencyKey(identity: ContractCallIdentity): Promise<string> {
  return sha256Hex(idempotencyPreimage(identity));
}

/**
 * Deterministic JSON serialization with sorted keys.
 *
 * A replay must send a byte-value-identical body or KeeperHub answers 409
 * `idempotency_conflict`. `JSON.stringify` preserves insertion order, so a body rebuilt in a
 * different code path can serialize differently while being semantically equal. Everything
 * we send and hash goes through this.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const out: Record<string, unknown> = {};
    for (const [key, nested] of entries) {
      out[key] = sortValue(nested);
    }
    return out;
  }
  return value;
}

export async function canonicalBodyHash(body: unknown): Promise<string> {
  return `sha256:${await sha256Hex(canonicalJson(body))}`;
}

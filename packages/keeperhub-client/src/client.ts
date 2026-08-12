/**
 * The production KeeperHub transport.
 *
 * Everything here follows the Phase 0.5 measurements rather than the documentation, and where
 * the two disagree the measurement wins. Three rules shape the whole file:
 *
 *   1. **This module never decides what a response means.** It parses, records and hands back.
 *      Classification lives in `@resurv/domain`, because the difference between "the API said
 *      202" and "the covenant may advance" is the difference this product exists to make.
 *   2. **Nothing is thrown for an HTTP status.** A 400 carrying `wouldRevert: true` is an
 *      answer, not a failure, and a wrapper that treats every non-2xx as a transport error
 *      discards the most useful diagnostic in the funnel.
 *   3. **A lost response is a distinct outcome**, never merged with a 5xx. The caller has to be
 *      able to tell "KeeperHub said no" from "nobody said anything", because only the second
 *      one may have produced an economic effect.
 */

import { KEEPERHUB_API_ORIGIN, KEEPERHUB_ENDPOINTS, RATE_LIMIT_HEADERS } from './constants.ts';
import {
  type NormalizedKeeperhubError,
  normalizeErrorBody,
  readIdempotentReplay,
} from './errors.ts';
import { canonicalJson } from './idempotency.ts';

/** The `/api/execute/contract-call` request body. PRD 12.4 and Snapshot S1. */
export interface ContractCallRequest {
  readonly contractAddress: string;
  readonly chainId: number;
  readonly functionName: string;
  /** A JSON-encoded string, not an array. Measured, and documented. */
  readonly functionArgs: string;
  /** A JSON-encoded string. */
  readonly abi: string;
  readonly value?: string;
  readonly gasLimitMultiplier?: string;
  readonly simulate?: boolean;
}

export interface RateLimitSnapshot {
  readonly limit: number | undefined;
  readonly remaining: number | undefined;
  readonly reset: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly pollIntervalHint: string | undefined;
}

/**
 * One HTTP exchange, recorded whole. This is what the orchestrator persists and what the public
 * proof surface quotes, so it holds the request identity as well as the response.
 */
export interface KeeperhubExchange {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly sentAt: string;
  readonly elapsedMs: number;
  readonly idempotencyKey: string | undefined;
  readonly requestBodyHash: string | undefined;
  /** Undefined when no HTTP response arrived at all. Never conflated with a 5xx. */
  readonly httpStatus: number | undefined;
  readonly body: unknown;
  readonly rateLimit: RateLimitSnapshot;
  readonly error: NormalizedKeeperhubError | undefined;
  /** Tri-state. Absence of the field is evidence: it marks the request that committed the key. */
  readonly idempotentReplay: boolean | undefined;
  /** Set only when the request never produced a response. */
  readonly transportError: string | undefined;
}

export interface KeeperhubClientOptions {
  readonly apiKey: string;
  readonly origin?: string;
  readonly timeoutMs?: number;
  /** Injected in tests. Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Called with every exchange, for durable recording. Must not throw. */
  readonly onExchange?: (exchange: KeeperhubExchange) => void;
}

const DEFAULT_TIMEOUT_MS = 120_000;

function readNumberHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function rateLimitOf(headers: Headers): RateLimitSnapshot {
  return {
    limit: readNumberHeader(headers, RATE_LIMIT_HEADERS.limit),
    remaining: readNumberHeader(headers, RATE_LIMIT_HEADERS.remaining),
    reset: headers.get(RATE_LIMIT_HEADERS.reset) ?? undefined,
    retryAfterSeconds: readNumberHeader(headers, RATE_LIMIT_HEADERS.retryAfter),
    pollIntervalHint: headers.get(RATE_LIMIT_HEADERS.pollIntervalHint) ?? undefined,
  };
}

const EMPTY_RATE_LIMIT: RateLimitSnapshot = {
  limit: undefined,
  remaining: undefined,
  reset: undefined,
  retryAfterSeconds: undefined,
  pollIntervalHint: undefined,
};

function describeTransportError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` cause=${error.cause.name}` : '';
    return `${error.name}: ${error.message}${cause}`;
  }
  return String(error);
}

function parseJson(text: string): unknown {
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { unparseable: text.slice(0, 500) };
  }
}

export class KeeperhubClient {
  readonly #apiKey: string;
  readonly #origin: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #onExchange: (exchange: KeeperhubExchange) => void;

  constructor(options: KeeperhubClientOptions) {
    this.#apiKey = options.apiKey;
    this.#origin = options.origin ?? KEEPERHUB_API_ORIGIN;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#onExchange = options.onExchange ?? (() => {});
  }

  /**
   * Simulate. Returns the exchange whatever the status: a 400 carrying `wouldRevert: true` is
   * the answer the caller asked for.
   */
  async simulate(request: ContractCallRequest): Promise<KeeperhubExchange> {
    return this.#send({
      method: 'POST',
      path: KEEPERHUB_ENDPOINTS.executeContractCall,
      bodyText: canonicalJson({ ...request, simulate: true }),
    });
  }

  /**
   * Broadcast, under an idempotency key the caller has already written durably.
   *
   * `bodyText` is passed rather than an object because a replay has to be byte-identical: the
   * caller stores the exact string it sent and replays that, not a re-serialization of an
   * equivalent object.
   */
  async execute(
    bodyText: string,
    idempotencyKey: string,
    requestBodyHash?: string,
  ): Promise<KeeperhubExchange> {
    return this.#send({
      method: 'POST',
      path: KEEPERHUB_ENDPOINTS.executeContractCall,
      bodyText,
      idempotencyKey,
      requestBodyHash,
    });
  }

  async executionStatus(executionId: string): Promise<KeeperhubExchange> {
    return this.#send({
      method: 'GET',
      path: KEEPERHUB_ENDPOINTS.executionStatus(executionId),
    });
  }

  async chains(): Promise<KeeperhubExchange> {
    return this.#send({ method: 'GET', path: KEEPERHUB_ENDPOINTS.chains });
  }

  /** The organization wallet address, which is `msg.sender` at the target under sponsorship. */
  async user(): Promise<KeeperhubExchange> {
    return this.#send({ method: 'GET', path: KEEPERHUB_ENDPOINTS.user });
  }

  async #send(options: {
    method: 'GET' | 'POST';
    path: string;
    bodyText?: string | undefined;
    idempotencyKey?: string | undefined;
    requestBodyHash?: string | undefined;
  }): Promise<KeeperhubExchange> {
    const headers = new Headers({
      Accept: 'application/json',
      Authorization: `Bearer ${this.#apiKey}`,
    });
    if (options.bodyText !== undefined) headers.set('Content-Type', 'application/json');
    if (options.idempotencyKey !== undefined) {
      headers.set('Idempotency-Key', options.idempotencyKey);
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error('keeperhub-timeout')),
      this.#timeoutMs,
    );
    const sentAt = new Date().toISOString();
    const started = Date.now();

    try {
      const response = await this.#fetch(`${this.#origin}${options.path}`, {
        method: options.method,
        headers,
        body: options.bodyText ?? null,
        signal: controller.signal,
      });
      const text = await response.text();
      const body = parseJson(text);
      const exchange: KeeperhubExchange = {
        method: options.method,
        path: options.path,
        sentAt,
        elapsedMs: Date.now() - started,
        idempotencyKey: options.idempotencyKey,
        requestBodyHash: options.requestBodyHash,
        httpStatus: response.status,
        body,
        rateLimit: rateLimitOf(response.headers),
        error: response.ok ? undefined : normalizeErrorBody(response.status, body),
        idempotentReplay: readIdempotentReplay(body),
        transportError: undefined,
      };
      this.#onExchange(exchange);
      return exchange;
    } catch (error) {
      // No HTTP response arrived. The request may or may not have committed, and nothing
      // available here distinguishes the two. Measured: the identical abort committed in one
      // run and not in another, decided by about nine milliseconds.
      const exchange: KeeperhubExchange = {
        method: options.method,
        path: options.path,
        sentAt,
        elapsedMs: Date.now() - started,
        idempotencyKey: options.idempotencyKey,
        requestBodyHash: options.requestBodyHash,
        httpStatus: undefined,
        body: undefined,
        rateLimit: EMPTY_RATE_LIMIT,
        error: undefined,
        idempotentReplay: undefined,
        transportError: describeTransportError(error),
      };
      this.#onExchange(exchange);
      return exchange;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ------------------------------------------------------------------------------------------
// Response readers. Deliberately total: every one answers `undefined` rather than throwing,
// because an unexpected shape from an external service must not be able to crash a reconciler.
// ------------------------------------------------------------------------------------------

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function readExecutionId(body: unknown): string | undefined {
  const value = record(body)?.['executionId'];
  return typeof value === 'string' ? value : undefined;
}

export function readBodyStatus(body: unknown): string | undefined {
  const value = record(body)?.['status'];
  return typeof value === 'string' ? value.trim().toLowerCase() : undefined;
}

export function readTransactionHash(body: unknown): string | null | undefined {
  const value = record(body)?.['transactionHash'];
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

export function readTransactionLink(body: unknown): string | undefined {
  const value = record(body)?.['transactionLink'];
  return typeof value === 'string' ? value : undefined;
}

export function readSponsored(body: unknown): boolean | undefined {
  const value = record(body)?.['sponsored'];
  return typeof value === 'boolean' ? value : undefined;
}

export interface KeeperhubReceipt {
  readonly hash: string | undefined;
  readonly verified: boolean | undefined;
  readonly receiptStatus: string | undefined;
  readonly blockNumber: number | undefined;
  readonly gasUsed: string | undefined;
}

export function readReceipts(body: unknown): readonly KeeperhubReceipt[] | undefined {
  const value = record(body)?.['receipts'];
  if (!Array.isArray(value)) return undefined;
  return value.map((entry) => {
    const item = record(entry) ?? {};
    return {
      hash: typeof item['hash'] === 'string' ? item['hash'] : undefined,
      verified: typeof item['verified'] === 'boolean' ? item['verified'] : undefined,
      receiptStatus: typeof item['receiptStatus'] === 'string' ? item['receiptStatus'] : undefined,
      blockNumber: typeof item['blockNumber'] === 'number' ? item['blockNumber'] : undefined,
      gasUsed: typeof item['gasUsed'] === 'string' ? item['gasUsed'] : undefined,
    };
  });
}

/**
 * KeeperHub's own inner-failure signal.
 *
 * `docs/THREAT_MODEL.md` T15: when execution routes through a Safe the outer transaction can
 * succeed while the inner call fails, and the outer receipt says `0x1` either way. Two surfaces
 * carry the truth and neither is the outer receipt status: `result.executedCall.reverted`, seen
 * as `false` on every successful Phase 0.5 execution, and a `receiptStatus` of
 * `safe_inner_failure`, which is documented and has never been observed by this project.
 *
 * Returns `true` only when a signal is positively present. An absent field is not a denial.
 */
export function readInnerFailure(body: unknown): boolean {
  const result = record(record(body)?.['result']);
  const executedCall = record(result?.['executedCall']);
  if (executedCall?.['reverted'] === true) return true;

  const receipts = readReceipts(body);
  return (receipts ?? []).some((receipt) => receipt.receiptStatus === 'safe_inner_failure');
}

export function readWouldRevert(body: unknown): boolean | undefined {
  const value = record(body)?.['wouldRevert'];
  return typeof value === 'boolean' ? value : undefined;
}

export function readRevertReason(body: unknown): string | undefined {
  const value = record(body)?.['revertReason'];
  // Measured: this leaks an ethers.js CALL_EXCEPTION string containing the whole transaction
  // object rather than a clean `Error(...)`. It is a diagnostic for a human and must never be
  // parsed for a decision.
  return typeof value === 'string' ? value.slice(0, 2000) : undefined;
}

export function readFailureKind(body: unknown): string | undefined {
  const value = record(body)?.['failureKind'];
  return typeof value === 'string' ? value : undefined;
}

export function readGasUsed(body: unknown): string | undefined {
  // Named `gasUsedWei` and measured to carry gas units, byte-identical to `receipts[].gasUsed`.
  const value = record(body)?.['gasUsedWei'];
  return typeof value === 'string' ? value : undefined;
}

export interface ChainEntry {
  readonly chainId: number;
  readonly name: string;
  readonly isEnabled: boolean;
  readonly isTestnet: boolean;
  readonly explorerUrl: string | undefined;
  readonly usePrivateMempoolRpc: boolean | undefined;
}

/** `GET /api/chains` answers a bare array, not an envelope. */
export function readChains(body: unknown): readonly ChainEntry[] | undefined {
  if (!Array.isArray(body)) return undefined;
  const entries: ChainEntry[] = [];
  for (const raw of body) {
    const item = record(raw);
    if (item === undefined || typeof item['chainId'] !== 'number') continue;
    entries.push({
      chainId: item['chainId'],
      name: typeof item['name'] === 'string' ? item['name'] : '',
      isEnabled: item['isEnabled'] === true,
      isTestnet: item['isTestnet'] === true,
      explorerUrl: typeof item['explorerUrl'] === 'string' ? item['explorerUrl'] : undefined,
      usePrivateMempoolRpc:
        typeof item['usePrivateMempoolRpc'] === 'boolean'
          ? item['usePrivateMempoolRpc']
          : undefined,
    });
  }
  return entries;
}

export function readWalletAddress(body: unknown): string | undefined {
  const value = record(body)?.['walletAddress'];
  return typeof value === 'string' ? value : undefined;
}

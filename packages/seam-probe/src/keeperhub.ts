/**
 * A minimal live KeeperHub transport, built for measurement rather than for production use.
 *
 * Every call records what was sent and what came back, including the wall-clock elapsed time,
 * the full response header set and the raw response text before parsing. Nothing here decides
 * what a response *means*: classification is what the probe is measuring, so a transport that
 * pre-classified would beg the question.
 */

import { KEEPERHUB_API_ORIGIN } from '@resurv/keeperhub-client';
import { sanitize, sanitizeHeaders, sanitizeString } from './sanitize.ts';

export interface TransportRecord {
  readonly method: string;
  readonly path: string;
  readonly sentAt: string;
  readonly elapsedMs: number;
  readonly requestBodyHash: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly httpStatus: number | undefined;
  readonly responseHeaders: Record<string, string>;
  readonly responseBody: unknown;
  readonly responseText: string | undefined;
  /** Set when no HTTP response was received at all. The two cases are never merged. */
  readonly transportError: string | undefined;
}

export interface CallOptions {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly body?: unknown;
  readonly bodyText?: string;
  readonly idempotencyKey?: string;
  readonly requestBodyHash?: string;
  /** Overrides the loaded credential. Used to measure the authentication-failure branch. */
  readonly authorizationOverride?: string | null;
  /** Aborts the client side of the request after this many milliseconds. */
  readonly abortAfterMs?: number;
  readonly requestId?: string;
}

export class KeeperhubProbeClient {
  readonly #credential: string;
  readonly #knownSecrets: readonly string[];
  #requests = 0;

  constructor(credential: string) {
    this.#credential = credential;
    this.#knownSecrets = [credential];
  }

  get requestCount(): number {
    return this.#requests;
  }

  get knownSecrets(): readonly string[] {
    return this.#knownSecrets;
  }

  async call(options: CallOptions): Promise<TransportRecord> {
    this.#requests += 1;

    const headers = new Headers({ Accept: 'application/json' });
    const authorization =
      options.authorizationOverride === undefined
        ? `Bearer ${this.#credential}`
        : options.authorizationOverride;
    if (authorization !== null) headers.set('Authorization', authorization);
    if (options.requestId !== undefined) headers.set('x-request-id', options.requestId);
    if (options.idempotencyKey !== undefined) {
      headers.set('Idempotency-Key', options.idempotencyKey);
    }

    const payload =
      options.bodyText ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    if (payload !== undefined) headers.set('Content-Type', 'application/json');

    const controller = new AbortController();
    const abortTimer =
      options.abortAfterMs === undefined
        ? undefined
        : setTimeout(() => controller.abort(new Error('probe-abort')), options.abortAfterMs);

    const sentAt = new Date().toISOString();
    const started = performance.now();
    try {
      const response = await fetch(`${KEEPERHUB_API_ORIGIN}${options.path}`, {
        method: options.method,
        headers,
        body: payload ?? null,
        signal: controller.signal,
      });
      const text = await response.text();
      const elapsedMs = Math.round(performance.now() - started);
      return {
        method: options.method,
        path: options.path,
        sentAt,
        elapsedMs,
        requestBodyHash: options.requestBodyHash,
        idempotencyKey: options.idempotencyKey,
        httpStatus: response.status,
        responseHeaders: sanitizeHeaders(response.headers, this.#knownSecrets),
        responseBody: sanitize(parseJson(text), this.#knownSecrets),
        responseText: sanitizeString(text.slice(0, 4000), this.#knownSecrets),
        transportError: undefined,
      };
    } catch (error) {
      const elapsedMs = Math.round(performance.now() - started);
      return {
        method: options.method,
        path: options.path,
        sentAt,
        elapsedMs,
        requestBodyHash: options.requestBodyHash,
        idempotencyKey: options.idempotencyKey,
        httpStatus: undefined,
        responseHeaders: {},
        responseBody: undefined,
        responseText: undefined,
        transportError: sanitizeString(describeError(error), this.#knownSecrets),
      };
    } finally {
      if (abortTimer !== undefined) clearTimeout(abortTimer);
    }
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { unparseable: text.slice(0, 500) };
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` cause=${error.cause.name}` : '';
    return `${error.name}: ${error.message}${cause}`;
  }
  return String(error);
}

export function readField(body: unknown, field: string): unknown {
  if (typeof body !== 'object' || body === null) return undefined;
  return (body as Record<string, unknown>)[field];
}

export function readStringField(body: unknown, field: string): string | undefined {
  const value = readField(body, field);
  return typeof value === 'string' ? value : undefined;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

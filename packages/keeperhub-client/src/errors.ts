import { z } from 'zod';
import { ORG_API_KEY_PREFIX, WEBHOOK_KEY_PREFIX } from './constants.ts';

/**
 * KeeperHub does not use one error envelope. Three distinct shapes were observed live on
 * 2026-08-12 by the Phase 0.5 seam probe, and the evidence for each is committed under
 * `docs/phase-logs/evidence/phase-00-5/`:
 *
 *   A  `{error}` alone.  401 on `/api/execute/contract-call`, and 404 from
 *      `/api/execute/{id}/status` for an id that does not exist. No `detail`, no `request_id`.
 *      The official reference says every error carries `request_id`. It does not.
 *
 *   B  `{error, detail, request_id}`.  404 for an unrouted path. `error` is the machine code
 *      (`not_found`) and `detail` is the sentence. This is the documented shape.
 *
 *   C  `{error, code, retryable, originalExecutionId?}`.  Both 409s. Here `error` is the
 *      *sentence* and `code` is the machine value, which is the opposite of shape B.
 *
 * So neither `error` nor `detail` can be trusted to be one thing. `code ?? error` picks the
 * machine value in all three, `detail ?? error` picks the human value in all three, and a body
 * that matches nothing still normalizes rather than throwing.
 *
 * `retryable` and `originalExecutionId` are parsed because both are load-bearing and neither is
 * documented: `retryable` separates a 409 you should repeat from a 409 you must never repeat,
 * and `originalExecutionId` names the execution a lost request created, which is the only
 * KeeperHub-side recovery channel for a response that never arrived.
 */
export const keeperhubErrorBodySchema = z.object({
  error: z.string().optional(),
  detail: z.string().optional(),
  code: z.string().optional(),
  request_id: z.string().optional(),
  hint: z.string().optional(),
  docs: z.string().optional(),
  retryable: z.boolean().optional(),
  originalExecutionId: z.string().optional(),
});

export interface NormalizedKeeperhubError {
  readonly httpStatus: number;
  readonly code: string;
  readonly message: string;
  /** Present only on some responses. Worth surfacing: support asks for it. */
  readonly requestId: string | undefined;
  /**
   * Observed on both 409s and nowhere else. `undefined` means the response did not say, which
   * is not the same as `false`, and a caller must not read it as permission to retry.
   */
  readonly retryable: boolean | undefined;
  /**
   * Observed on `idempotency_conflict`. Names the execution the first request under this key
   * created, which is how a client that lost its response finds out what it already did.
   */
  readonly originalExecutionId: string | undefined;
  readonly hint: string | undefined;
}

export function normalizeErrorBody(httpStatus: number, body: unknown): NormalizedKeeperhubError {
  const parsed = keeperhubErrorBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      httpStatus,
      code: `http_${httpStatus}`,
      message: 'unparseable error body',
      requestId: undefined,
      retryable: undefined,
      originalExecutionId: undefined,
      hint: undefined,
    };
  }
  const { error, detail, code, request_id, retryable, originalExecutionId, hint } = parsed.data;
  return {
    httpStatus,
    code: code ?? error ?? `http_${httpStatus}`,
    message: detail ?? error ?? `http_${httpStatus}`,
    requestId: request_id,
    retryable,
    originalExecutionId,
    hint,
  };
}

/**
 * The two 409 codes, observed live. They are not interchangeable and confusing them is the
 * most expensive mistake available at this seam:
 *
 * - `idempotency_in_progress` (`retryable: true`) means an earlier request under this key is
 *   still running. Repeat the *same* key. Rotating to a new one buys a second economic action.
 * - `idempotency_conflict` (`retryable: false`) means the key was reused with a different body.
 *   Never repeat it, and read `originalExecutionId` to find out what the key already did.
 */
export const IDEMPOTENCY_IN_PROGRESS = 'idempotency_in_progress';
export const IDEMPOTENCY_CONFLICT = 'idempotency_conflict';

/**
 * Whether a 202 body is KeeperHub replaying an earlier response rather than reporting a fresh
 * one. Measured on four responses across two runs: the flag is present exactly when a previous
 * request under the same idempotency key was accepted, and absent when the request being
 * answered is the one that committed the key. That makes its absence evidence too, which is
 * why this returns a tri-state rather than a boolean.
 */
export function readIdempotentReplay(body: unknown): boolean | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as { idempotentReplay?: unknown }).idempotentReplay;
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * A simulation that predicts a revert answers with HTTP 400 and a body carrying
 * `wouldRevert: true`. A wrapper that treats every non-2xx as a transport failure discards
 * the single most useful diagnostic in the funnel, so callers must branch on this before
 * classifying the status code.
 */
export function isSimulationAnswer(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'wouldRevert' in body &&
    typeof (body as { wouldRevert: unknown }).wouldRevert === 'boolean'
  );
}

export function isApiKeyShapeValid(key: string): {
  valid: boolean;
  reason?: string;
} {
  if (key.startsWith(WEBHOOK_KEY_PREFIX)) {
    return {
      valid: false,
      reason: `This is a webhook (user) key. The execution endpoints need an organization key starting with ${ORG_API_KEY_PREFIX}.`,
    };
  }
  if (!key.startsWith(ORG_API_KEY_PREFIX)) {
    return { valid: false, reason: `Organization API keys start with ${ORG_API_KEY_PREFIX}.` };
  }
  if (key.length <= ORG_API_KEY_PREFIX.length) {
    return { valid: false, reason: 'Key is only a prefix.' };
  }
  return { valid: true };
}

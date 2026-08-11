import { z } from 'zod';
import { ORG_API_KEY_PREFIX, WEBHOOK_KEY_PREFIX } from './constants.ts';

/**
 * KeeperHub does not use one error envelope. A 401 returns `{error}` with no detail and no
 * request id; a 404 returns `{error, detail, request_id}`. A client that assumes the richer
 * shape reads `undefined` on the most common first-run failure, which is the auth failure.
 * Both shapes are parsed and normalized here.
 */
export const keeperhubErrorBodySchema = z.object({
  error: z.string().optional(),
  detail: z.string().optional(),
  code: z.string().optional(),
  request_id: z.string().optional(),
});

export interface NormalizedKeeperhubError {
  readonly httpStatus: number;
  readonly code: string;
  readonly message: string;
  /** Present only on some responses. Worth surfacing: support asks for it. */
  readonly requestId: string | undefined;
}

export function normalizeErrorBody(httpStatus: number, body: unknown): NormalizedKeeperhubError {
  const parsed = keeperhubErrorBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      httpStatus,
      code: `http_${httpStatus}`,
      message: 'unparseable error body',
      requestId: undefined,
    };
  }
  const { error, detail, code, request_id } = parsed.data;
  return {
    httpStatus,
    code: code ?? error ?? `http_${httpStatus}`,
    message: detail ?? error ?? `http_${httpStatus}`,
    requestId: request_id,
  };
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

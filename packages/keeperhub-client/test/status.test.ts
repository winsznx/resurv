import { describe, expect, it } from 'vitest';
import {
  IDEMPOTENCY_CONFLICT,
  IDEMPOTENCY_IN_PROGRESS,
  isApiKeyShapeValid,
  isSimulationAnswer,
  normalizeErrorBody,
  readIdempotentReplay,
} from '../src/errors.ts';
import {
  classifyReceiptStatus,
  normalizeExecutionStatus,
  parsePollIntervalHint,
} from '../src/status.ts';

describe('normalizeExecutionStatus', () => {
  it('maps the four documented statuses', () => {
    expect(normalizeExecutionStatus('pending').state).toBe('PENDING');
    expect(normalizeExecutionStatus('running').state).toBe('PENDING');
    expect(normalizeExecutionStatus('completed').state).toBe('COMPLETED');
    expect(normalizeExecutionStatus('failed').state).toBe('FAILED');
  });

  it('treats `unconfirmed` as non-terminal, not as a failure', () => {
    const status = normalizeExecutionStatus('unconfirmed');
    expect(status.state).toBe('PENDING');
    expect(status.terminal).toBe(false);
    expect(status.recognized).toBe(true);
  });

  it('maps an unknown status to UNKNOWN and keeps polling', () => {
    const status = normalizeExecutionStatus('settling_v2');
    expect(status.state).toBe('UNKNOWN');
    expect(status.terminal).toBe(false);
    expect(status.recognized).toBe(false);
    expect(status.raw).toBe('settling_v2');
  });

  it('never reports an unrecognized status as FAILED', () => {
    for (const value of ['', '  ', 'queued', 'retrying', 'partial', 'null', 'undefined']) {
      expect(normalizeExecutionStatus(value).state).not.toBe('FAILED');
    }
  });

  it('only marks COMPLETED and FAILED terminal', () => {
    const terminal = ['pending', 'running', 'unconfirmed', 'completed', 'failed', 'weird'].filter(
      (value) => normalizeExecutionStatus(value).terminal,
    );
    expect(terminal).toStrictEqual(['completed', 'failed']);
  });

  it('is case and whitespace insensitive', () => {
    expect(normalizeExecutionStatus('  COMPLETED ').state).toBe('COMPLETED');
    expect(normalizeExecutionStatus('Unconfirmed').state).toBe('PENDING');
  });
});

describe('classifyReceiptStatus', () => {
  it('maps success to LANDED and reverted to REVERTED', () => {
    expect(classifyReceiptStatus('success')).toBe('LANDED');
    expect(classifyReceiptStatus('reverted')).toBe('REVERTED');
    expect(classifyReceiptStatus('safe_inner_failure')).toBe('REVERTED');
  });

  it('maps not_found and timeout to UNKNOWN, never to failure', () => {
    expect(classifyReceiptStatus('not_found')).toBe('UNKNOWN');
    expect(classifyReceiptStatus('timeout')).toBe('UNKNOWN');
  });

  it('maps an unrecognized receipt status to UNKNOWN', () => {
    expect(classifyReceiptStatus('dropped')).toBe('UNKNOWN');
  });
});

describe('parsePollIntervalHint', () => {
  it('reads a positive hint as seconds and non-terminal', () => {
    expect(parsePollIntervalHint('5', 2)).toStrictEqual({
      seconds: 5,
      terminal: false,
    });
  });

  it('reads 0 as terminal', () => {
    expect(parsePollIntervalHint('0', 2)).toStrictEqual({
      seconds: 0,
      terminal: true,
    });
  });

  it('falls back to the caller default rather than to 0 when the header is absent', () => {
    expect(parsePollIntervalHint(null, 3)).toStrictEqual({
      seconds: 3,
      terminal: false,
    });
    expect(parsePollIntervalHint(undefined, 3)).toStrictEqual({
      seconds: 3,
      terminal: false,
    });
    expect(parsePollIntervalHint('', 3)).toStrictEqual({
      seconds: 3,
      terminal: false,
    });
  });

  it('falls back on garbage instead of stopping the poll loop', () => {
    expect(parsePollIntervalHint('soon', 3)).toStrictEqual({
      seconds: 3,
      terminal: false,
    });
    expect(parsePollIntervalHint('-1', 3)).toStrictEqual({
      seconds: 3,
      terminal: false,
    });
    expect(parsePollIntervalHint('NaN', 3)).toStrictEqual({
      seconds: 3,
      terminal: false,
    });
  });
});

/**
 * Every body below was returned by the live API on 2026-08-12 and is committed verbatim under
 * `docs/phase-logs/evidence/phase-00-5/`. Three shapes, and `error` means something different
 * in two of them, which is why nothing here reads a single field and hopes.
 */
describe('error envelope normalization, against the three measured shapes', () => {
  it('shape A: the bare 401, which carries neither detail nor request_id', () => {
    // P02. The official reference says every error carries request_id. This one does not.
    const normalized = normalizeErrorBody(401, { error: 'Unauthorized' });
    expect(normalized.code).toBe('Unauthorized');
    expect(normalized.message).toBe('Unauthorized');
    expect(normalized.requestId).toBeUndefined();
  });

  it('shape A also covers a status lookup for an execution id that does not exist', () => {
    // P12. GET /api/execute/{unknown}/status.
    const normalized = normalizeErrorBody(404, { error: 'Execution not found' });
    expect(normalized.code).toBe('Execution not found');
    expect(normalized.requestId).toBeUndefined();
  });

  it('shape B: an unrouted path, where error is the code and detail is the sentence', () => {
    // P11. GET /api/execute and GET /api/executions both answer this way.
    const normalized = normalizeErrorBody(404, {
      error: 'not_found',
      detail: 'Route GET /api/execute not found',
      request_id: '9c544f40-f346-46a0-ad9c-0099f38f4bac',
    });
    expect(normalized.code).toBe('not_found');
    expect(normalized.message).toBe('Route GET /api/execute not found');
    expect(normalized.requestId).toBe('9c544f40-f346-46a0-ad9c-0099f38f4bac');
  });

  it('shape C: a 409, where error is the sentence and code is the machine value', () => {
    // P07. The opposite assignment from shape B, on the same API.
    const normalized = normalizeErrorBody(409, {
      error:
        'Idempotency-Key was reused with a different request payload. Use a new key for a different request.',
      code: IDEMPOTENCY_CONFLICT,
      originalExecutionId: 'e79eg87fs6kq1katpsgn6',
      retryable: false,
    });
    expect(normalized.code).toBe(IDEMPOTENCY_CONFLICT);
    expect(normalized.message).toContain('reused with a different request payload');
    expect(normalized.retryable).toBe(false);
    expect(normalized.originalExecutionId).toBe('e79eg87fs6kq1katpsgn6');
  });

  it('keeps the two 409 codes apart, because retrying the wrong one buys a second action', () => {
    // P11. In-progress is the one you repeat; conflict is the one you never repeat.
    const inProgress = normalizeErrorBody(409, {
      error:
        'A request with this Idempotency-Key is already being processed. Retry the same key shortly; do not rotate it.',
      code: IDEMPOTENCY_IN_PROGRESS,
      retryable: true,
    });
    expect(inProgress.code).toBe(IDEMPOTENCY_IN_PROGRESS);
    expect(inProgress.retryable).toBe(true);
    expect(inProgress.originalExecutionId).toBeUndefined();
  });

  it('reports an absent retryable as undefined, never as false', () => {
    // "The response did not say" is not "do not retry", and a caller must be able to tell.
    expect(normalizeErrorBody(401, { error: 'Unauthorized' }).retryable).toBeUndefined();
  });

  it('degrades to an http_ code rather than throwing on an unparseable body', () => {
    expect(normalizeErrorBody(502, 'gateway down').code).toBe('http_502');
    expect(normalizeErrorBody(502, null).code).toBe('http_502');
    expect(normalizeErrorBody(502, { error: 42 }).code).toBe('http_502');
  });

  it('preserves an unknown envelope safely instead of inventing a field', () => {
    const normalized = normalizeErrorBody(418, { message: 'teapot', field: 'spout' });
    expect(normalized.code).toBe('http_418');
    expect(normalized.retryable).toBeUndefined();
    expect(normalized.originalExecutionId).toBeUndefined();
  });
});

describe('idempotent replay marker', () => {
  /**
   * Measured on four responses across two runs: the flag is present exactly when an earlier
   * request under the same key was accepted, and absent when the response being read belongs
   * to the request that committed the key. So absence carries information and must not
   * collapse into `false`.
   */
  it('distinguishes present-true, absent, and a non-boolean', () => {
    expect(readIdempotentReplay({ status: 'completed', idempotentReplay: true })).toBe(true);
    expect(readIdempotentReplay({ status: 'completed', executionId: 'x' })).toBeUndefined();
    expect(readIdempotentReplay({ idempotentReplay: 'true' })).toBeUndefined();
    expect(readIdempotentReplay(null)).toBeUndefined();
  });
});

describe('simulation answers are not transport failures', () => {
  it('recognizes a would-revert 400 body as an answer', () => {
    expect(isSimulationAnswer({ success: false, wouldRevert: true })).toBe(true);
    expect(isSimulationAnswer({ success: true, wouldRevert: false })).toBe(true);
  });

  it('does not mistake a plain error body for a simulation answer', () => {
    expect(isSimulationAnswer({ error: 'Unauthorized' })).toBe(false);
    expect(isSimulationAnswer(null)).toBe(false);
    expect(isSimulationAnswer('nope')).toBe(false);
  });
});

describe('api key shape', () => {
  it('accepts an organization key', () => {
    expect(isApiKeyShapeValid('kh_abc123').valid).toBe(true);
  });

  it('names the webhook-key mistake instead of returning a bare failure', () => {
    const result = isApiKeyShapeValid('wfb_abc123');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('kh_');
  });

  it('rejects a bare prefix and an unrecognized prefix', () => {
    expect(isApiKeyShapeValid('kh_').valid).toBe(false);
    expect(isApiKeyShapeValid('sk_live_abc').valid).toBe(false);
  });
});

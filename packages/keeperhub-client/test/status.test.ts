import { describe, expect, it } from 'vitest';
import { isApiKeyShapeValid, isSimulationAnswer, normalizeErrorBody } from '../src/errors.ts';
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

describe('error envelope normalization', () => {
  it('handles the bare 401 shape that carries neither detail nor request_id', () => {
    const normalized = normalizeErrorBody(401, { error: 'Unauthorized' });
    expect(normalized.code).toBe('Unauthorized');
    expect(normalized.message).toBe('Unauthorized');
    expect(normalized.requestId).toBeUndefined();
  });

  it('handles the richer 404 shape and preserves request_id', () => {
    const normalized = normalizeErrorBody(404, {
      error: 'not_found',
      detail: 'Route GET /api/executions not found',
      request_id: '759d7d0c',
    });
    expect(normalized.code).toBe('not_found');
    expect(normalized.message).toBe('Route GET /api/executions not found');
    expect(normalized.requestId).toBe('759d7d0c');
  });

  it('degrades to an http_ code rather than throwing on an unparseable body', () => {
    expect(normalizeErrorBody(502, 'gateway down').code).toBe('http_502');
    expect(normalizeErrorBody(502, null).code).toBe('http_502');
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

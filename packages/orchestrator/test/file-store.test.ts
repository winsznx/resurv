import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileAttemptStore } from '../src/file-store.ts';
import type { AttemptRecord } from '../src/store.ts';

function record(id: string): AttemptRecord {
  return {
    semanticAttemptId: id,
    covenantId: '0xcov',
    actionIndex: 1,
    attemptSequence: 0,
    expectedStateHash: undefined,
    canonicalBody: '{"a":1}',
    canonicalBodyHash: 'sha256:beef',
    idempotencyKey: `key-${id}`,
    state: 'KEY_COMMITTED',
    executionId: undefined,
    transactionHash: undefined,
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
    reconciliationRounds: 0,
    note: undefined,
  };
}

function fresh(): string {
  return join(mkdtempSync(join(tmpdir(), 'resurv-store-')), 'attempts.jsonl');
}

describe('the durable journal', () => {
  it('survives the process that wrote it', async () => {
    // #given
    const path = fresh();
    const first = new FileAttemptStore(path);
    await first.reserve(record('a'));
    await first.update('a', { state: 'CONFIRMED', transactionHash: '0xabc' });

    // #when a new process opens the same journal
    const second = new FileAttemptStore(path);

    // #then
    const recovered = await second.find('a');
    expect(recovered?.state).toBe('CONFIRMED');
    expect(recovered?.transactionHash).toBe('0xabc');
    expect(recovered?.idempotencyKey).toBe('key-a');
    expect(recovered?.canonicalBody).toBe('{"a":1}');
  });

  it('writes the claim before returning from reserve', async () => {
    // #given
    const path = fresh();
    const store = new FileAttemptStore(path);

    // #when
    await store.reserve(record('b'));

    // #then the bytes are on disk already, which is the entire contract of this interface
    expect(readFileSync(path, 'utf8')).toContain('key-b');
  });

  it('refuses to claim the same semantic attempt twice', async () => {
    // #given
    const store = new FileAttemptStore(fresh());
    await store.reserve(record('c'));

    // #when
    const second = await store.reserve({ ...record('c'), idempotencyKey: 'key-different' });

    // #then the original wins, so a second worker replays rather than re-sends
    expect(second.created).toBe(false);
    expect(second.record.idempotencyKey).toBe('key-c');
  });

  it('reads a journal whose last line was torn by a crash, and keeps everything before it', async () => {
    // #given a complete record followed by a half-written line
    const path = fresh();
    const store = new FileAttemptStore(path);
    await store.reserve(record('d'));
    appendFileSync(path, '{"kind":"update","semanticAttemptId":"d","at":"2026');

    // #when
    const reopened = new FileAttemptStore(path);

    // #then
    expect((await reopened.find('d'))?.state).toBe('KEY_COMMITTED');
  });

  it('keeps separate attempts separate', async () => {
    // #given
    const store = new FileAttemptStore(fresh());
    await store.reserve(record('e'));
    await store.reserve(record('f'));

    // #when
    await store.update('e', { state: 'CONFIRMED' });

    // #then
    expect((await store.find('f'))?.state).toBe('KEY_COMMITTED');
    expect((await store.list()).length).toBe(2);
  });
});

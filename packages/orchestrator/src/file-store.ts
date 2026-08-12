/**
 * An append-only, fsync'd journal on the local filesystem.
 *
 * This is the durable store the live demo runner uses, and the choice is worth stating plainly
 * rather than leaving to be discovered.
 *
 * `docs/DECISIONS.md` ADR-004 requires that the idempotency key and canonical body reach stable
 * storage before the first POST, so that a process that dies mid-request can replay rather than
 * re-send. It names Supabase Postgres as the production store, and Supabase credentials are a
 * user-owned resource this build does not have. What the argument actually requires is
 * durability across a crash, and an `fsync`'d append satisfies that for a single-process runner
 * exactly as a committed row does for a service.
 *
 * What it does not satisfy: two processes sharing a store, which is why `SupabaseAttemptStore`
 * exists alongside it and why the conformance suite runs against both. The deployed Worker uses
 * Supabase. The CLI runner uses this. Neither is a mock.
 */

import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  AttemptNotFoundError,
  type AttemptRecord,
  type AttemptStore,
  type AttemptUpdate,
} from './store.ts';

interface JournalEntry {
  readonly kind: 'reserve' | 'update';
  readonly semanticAttemptId: string;
  readonly at: string;
  readonly record?: AttemptRecord;
  readonly update?: AttemptUpdate;
}

export class FileAttemptStore implements AttemptStore {
  readonly #path: string;
  readonly #records = new Map<string, AttemptRecord>();

  constructor(path: string) {
    this.#path = path;
    mkdirSync(dirname(path), { recursive: true });
    this.#replay();
  }

  get path(): string {
    return this.#path;
  }

  /** Rebuilds state from the journal, which is what makes a crash recoverable at all. */
  #replay(): void {
    let contents: string;
    try {
      contents = readFileSync(this.#path, 'utf8');
    } catch {
      return;
    }
    for (const line of contents.split('\n')) {
      if (line.trim() === '') continue;
      let entry: JournalEntry;
      try {
        entry = JSON.parse(line) as JournalEntry;
      } catch {
        // A torn final line is exactly what a crash mid-write looks like. Everything before it
        // is still valid, and stopping here is the honest reading of a truncated journal.
        break;
      }
      if (entry.kind === 'reserve' && entry.record !== undefined) {
        if (!this.#records.has(entry.semanticAttemptId)) {
          this.#records.set(entry.semanticAttemptId, entry.record);
        }
        continue;
      }
      const existing = this.#records.get(entry.semanticAttemptId);
      if (existing !== undefined && entry.update !== undefined) {
        this.#records.set(entry.semanticAttemptId, {
          ...existing,
          ...entry.update,
          updatedAt: entry.at,
        });
      }
    }
  }

  /** Append and fsync. Returns only once the bytes are on the device. */
  #append(entry: JournalEntry): void {
    const handle = openSync(this.#path, 'a');
    try {
      writeSync(handle, `${JSON.stringify(entry)}\n`);
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
  }

  async reserve(record: AttemptRecord): Promise<{ record: AttemptRecord; created: boolean }> {
    const existing = this.#records.get(record.semanticAttemptId);
    if (existing !== undefined) return { record: existing, created: false };
    this.#append({
      kind: 'reserve',
      semanticAttemptId: record.semanticAttemptId,
      at: record.createdAt,
      record,
    });
    this.#records.set(record.semanticAttemptId, record);
    return { record, created: true };
  }

  async find(semanticAttemptId: string): Promise<AttemptRecord | undefined> {
    return this.#records.get(semanticAttemptId);
  }

  async update(semanticAttemptId: string, update: AttemptUpdate): Promise<AttemptRecord> {
    const existing = this.#records.get(semanticAttemptId);
    if (existing === undefined) throw new AttemptNotFoundError(semanticAttemptId);
    const at = new Date().toISOString();
    this.#append({ kind: 'update', semanticAttemptId, at, update });
    const next: AttemptRecord = { ...existing, ...update, updatedAt: at };
    this.#records.set(semanticAttemptId, next);
    return next;
  }

  async list(): Promise<readonly AttemptRecord[]> {
    return [...this.#records.values()];
  }
}

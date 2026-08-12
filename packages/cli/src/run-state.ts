/**
 * Durable state for one demo run.
 *
 * Every semantic attempt id in the demo derives from the run label, and the trigger step's
 * request body carries a validity window and a signature. If a restart re-derived any of those,
 * `AttemptStore.reserve` would not find the previous claim, a fresh idempotency key would be
 * minted, and the crash-recovery guarantee the orchestrator exists to provide would be defeated
 * at its only caller. An audit found exactly that, so the run's identity is written down.
 *
 * The trigger authority's *private* key is deliberately not here and never will be. What is
 * persisted is the signature it produced, which is enough to replay the trigger and not enough
 * to author a different one.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '@resurv/node-runtime';

export interface TriggerRecord {
  readonly signalHash: string;
  readonly nonce: number;
  readonly validAfter: string;
  readonly validUntil: string;
  readonly signature: string;
  readonly authority: string;
}

export interface RunState {
  readonly runLabel: string;
  readonly resumed: boolean;
  readonly path: string;
  trigger: TriggerRecord | undefined;
  save(): void;
}

interface Persisted {
  runLabel: string;
  trigger?: TriggerRecord;
}

export function openRunState(dryRun: boolean): RunState {
  const directory = join(REPO_ROOT, '.resurv');
  const path = join(directory, dryRun ? 'demo-run-dry.json' : 'demo-run.json');
  mkdirSync(directory, { recursive: true });

  const wantsResume = process.argv.includes('--resume');
  let persisted: Persisted | undefined;
  if (wantsResume) {
    try {
      persisted = JSON.parse(readFileSync(path, 'utf8')) as Persisted;
    } catch {
      persisted = undefined;
    }
  }

  const state: Persisted = persisted ?? {
    runLabel: dryRun ? 'dry' : new Date().toISOString().replace(/[:.]/g, '-'),
  };

  return {
    runLabel: state.runLabel,
    resumed: persisted !== undefined,
    path,
    get trigger(): TriggerRecord | undefined {
      return state.trigger;
    },
    set trigger(value: TriggerRecord | undefined) {
      if (value === undefined) {
        delete state.trigger;
        return;
      }
      state.trigger = value;
    },
    save(): void {
      writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    },
  };
}

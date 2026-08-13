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
  let onDisk: Persisted | undefined;
  try {
    onDisk = JSON.parse(readFileSync(path, 'utf8')) as Persisted;
  } catch {
    onDisk = undefined;
  }

  // Starting fresh over an existing run is legitimate — a covenant is a one-shot object and a
  // second demo is a second covenant — but it is also exactly what a forgotten `--resume` looks
  // like, and the cost of the mistake is a half-funded covenant abandoned on chain. Say so
  // before spending anything, rather than after.
  if (onDisk !== undefined && !wantsResume) {
    process.stderr.write(
      [
        `note: ${path} already records run ${onDisk.runLabel}.`,
        '      Starting a NEW covenant with a new idempotency namespace. The recorded run is not',
        '      resumed and anything it left on chain stays there.',
        '      Pass --resume to continue that run instead.',
        '',
      ].join('\n'),
    );
  }

  const persisted = wantsResume ? onDisk : undefined;

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

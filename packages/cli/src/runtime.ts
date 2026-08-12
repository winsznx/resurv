/**
 * Shared setup for the live entry points: the credential, the client, the durable store, and a
 * console that never prints a secret.
 */

import { join } from 'node:path';
import { KeeperhubClient, type KeeperhubExchange } from '@resurv/keeperhub-client';
import {
  credentialShapedEnvNames,
  loadLocalEnv,
  REPO_ROOT,
  readKeeperhubCredential,
} from '@resurv/node-runtime';
import { FileAttemptStore } from '@resurv/orchestrator';

export const RUN_STATE_DIR = join(REPO_ROOT, '.resurv');

export class MissingCredentialError extends Error {
  constructor(reason: string, candidates: readonly string[], names: readonly string[]) {
    super(
      [
        'USER ACTION REQUIRED: no KeeperHub organization credential is available.',
        `  reason: ${reason}`,
        `  paths checked: ${candidates.join(', ')}`,
        `  credential-shaped variables present: ${names.length === 0 ? 'none' : names.join(', ')}`,
        '  fix: put an organization key beginning kh_ into the repository-root .env file.',
        '       See docs/RUNBOOKS.md. This is a human step by design.',
      ].join('\n'),
    );
    this.name = 'MissingCredentialError';
  }
}

export interface LiveRuntime {
  readonly keeperhub: KeeperhubClient;
  readonly store: FileAttemptStore;
  readonly exchanges: KeeperhubExchange[];
  readonly credentialFingerprint: string;
}

/**
 * Builds the live runtime, or throws a message that names paths and variable names and never a
 * value. The loader itself returns names only, so this cannot print a credential even by
 * accident.
 */
export function liveRuntime(journalName: string): LiveRuntime {
  const load = loadLocalEnv();
  const credential = readKeeperhubCredential();
  if (!credential.ok) {
    throw new MissingCredentialError(
      credential.reason,
      load.candidates.map((candidate) => candidate.path),
      credentialShapedEnvNames(),
    );
  }

  const exchanges: KeeperhubExchange[] = [];
  return {
    keeperhub: new KeeperhubClient({
      apiKey: credential.credential.value,
      onExchange: (exchange) => exchanges.push(exchange),
    }),
    store: new FileAttemptStore(join(RUN_STATE_DIR, `${journalName}.jsonl`)),
    exchanges,
    credentialFingerprint: credential.credential.fingerprint,
  };
}

export function step(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

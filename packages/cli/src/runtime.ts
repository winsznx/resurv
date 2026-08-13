/**
 * Shared setup for the live entry points: the credential, the client, the durable store, and a
 * console that never prints a secret.
 */

import { join } from 'node:path';
import {
  isApiKeyShapeValid,
  KeeperhubClient,
  type KeeperhubExchange,
} from '@resurv/keeperhub-client';
import {
  credentialShapedEnvNames,
  loadLocalEnv,
  REPO_ROOT,
  readKeeperhubCredential,
} from '@resurv/node-runtime';
import { FileAttemptStore } from '@resurv/orchestrator';

export const RUN_STATE_DIR = join(REPO_ROOT, '.resurv');

export class UnusableCredentialError extends Error {
  constructor(reason: string, fingerprint: string) {
    super(
      [
        'USER ACTION REQUIRED: the KeeperHub credential present cannot execute.',
        `  reason: ${reason}`,
        `  key: ${fingerprint}`,
        '  fix: use an organization key from the KeeperHub dashboard. A webhook key authenticates',
        '       and then fails every execution endpoint with a bare 401, which is a slow way to',
        '       learn you pasted the wrong one.',
      ].join('\n'),
    );
    this.name = 'UnusableCredentialError';
  }
}

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

  // Shape before use. The key is checked here rather than only in the Worker's health route,
  // because this is the process that actually spends it: a `wfb_` webhook key reaches the
  // execution endpoints and comes back a bare 401, which reads like an outage instead of a typo.
  // The fingerprint is prefix and length only, never the value.
  const shape = isApiKeyShapeValid(credential.credential.value);
  if (!shape.valid) {
    throw new UnusableCredentialError(
      shape.reason ?? 'unrecognized key shape',
      credential.credential.fingerprint,
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

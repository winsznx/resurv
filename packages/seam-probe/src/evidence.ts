/**
 * Evidence records.
 *
 * One JSON file per scenario, written under `docs/phase-logs/evidence/phase-00-5/`, committed,
 * and readable by someone who was not in the session. Everything passes through `sanitize`
 * before it is written, and the writer refuses to emit a file that still contains a
 * credential-shaped string.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TransportRecord } from './keeperhub.ts';
import { REPO_ROOT } from './local-env.ts';
import { sanitize } from './sanitize.ts';

export const EVIDENCE_DIR = join('docs', 'phase-logs', 'evidence', 'phase-00-5');

export interface StatusObservation {
  readonly atMs: number;
  readonly httpStatus: number | undefined;
  readonly status: string | undefined;
  readonly transactionHash: string | undefined;
  readonly receiptStatus: string | undefined;
  readonly pollIntervalHint: string | undefined;
  readonly body: unknown;
}

export interface ChainObservation {
  readonly transactionHash: string | undefined;
  readonly receiptStatusHex: string | undefined;
  readonly receiptVerdict: 'success' | 'reverted' | 'absent' | 'unknown';
  readonly blockNumber: number | undefined;
  readonly from: string | undefined;
  readonly to: string | undefined;
  readonly gasUsed: string | undefined;
  readonly gasLimit: string | undefined;
  readonly decodedSenderTopic: string | undefined;
  readonly decodedChallengeTopic: string | undefined;
  readonly originsAgreed: boolean;
  readonly originAnswers: unknown;
  readonly revertData: string | undefined;
}

export interface ScenarioEvidence {
  readonly id: string;
  readonly question: string;
  readonly semanticAttemptId: string | undefined;
  readonly challenge: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly requestBodyHash: string | undefined;
  readonly requestBody: unknown;
  readonly transport: readonly TransportRecord[];
  readonly executionId: string | undefined;
  readonly statusTransitions: readonly StatusObservation[];
  readonly chain: ChainObservation | undefined;
  /** Effects attributable to this scenario's challenge, counted from chain logs. */
  readonly onchainEffectCount: number | undefined;
  readonly observation: string;
}

const CREDENTIAL_SHAPES: readonly RegExp[] = [
  /\b(kh|wfb)_[A-Za-z0-9_-]{4,}/,
  /\bsb[a-z]?_[A-Za-z0-9_-]{8,}/,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/,
];

export class CredentialLeakError extends Error {
  constructor(id: string) {
    super(`refusing to write evidence for ${id}: a credential-shaped value survived sanitization`);
    this.name = 'CredentialLeakError';
  }
}

export function writeEvidence(evidence: ScenarioEvidence, knownSecrets: readonly string[]): string {
  const sanitized = sanitize(evidence, knownSecrets);
  const serialized = `${JSON.stringify(sanitized, null, 2)}\n`;
  for (const shape of CREDENTIAL_SHAPES) {
    if (shape.test(serialized)) throw new CredentialLeakError(evidence.id);
  }
  for (const secret of knownSecrets) {
    if (secret.length >= 8 && serialized.includes(secret)) {
      throw new CredentialLeakError(evidence.id);
    }
  }
  const directory = join(REPO_ROOT, EVIDENCE_DIR);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${evidence.id}.json`);
  writeFileSync(path, serialized, 'utf8');
  return path;
}

export function writeIndex(
  runLabel: string,
  entries: readonly { id: string; question: string; observation: string }[],
): string {
  const directory = join(REPO_ROOT, EVIDENCE_DIR);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'index.json');
  writeFileSync(path, `${JSON.stringify({ runLabel, entries }, null, 2)}\n`, 'utf8');
  return path;
}

/**
 * PHASE 0.5 seam recorder, second pass.
 *
 * Three questions the first pass raised and could not answer. Each one is here because the
 * measured evidence demanded it, not because it was planned:
 *
 *   P13  The first pass aborted a request, replayed the key 1.3 seconds later, and got
 *        409 `idempotency_in_progress` with no `executionId`. So the client learned that
 *        something was running and nothing else. Does replaying *again*, after the execution
 *        settles, hand back the original response? That single answer decides whether an
 *        ambiguous attempt can be resolved through KeeperHub at all, or only through chain.
 *
 *   P14  `P09` sent a call with no matching selector and got HTTP 202 carrying
 *        `status: "failed"`, `transactionHash: null`, `sponsored: false`, and an error about
 *        an insufficient balance rather than about a revert. Nothing reached chain. Is that
 *        deterministic, and is the refusal really tied to the call reverting?
 *
 *   P15  `P07` revealed that a 409 `idempotency_conflict` body carries `originalExecutionId`,
 *        which is documented nowhere. If that field survives on a key whose response was lost,
 *        it is a second recovery route, and a better one than waiting.
 *
 * Same rule as the first pass: record, do not assert the answer.
 */

import { KEEPERHUB_ENDPOINTS } from '@resurv/keeperhub-client';
import { beforeAll, describe, expect, it } from 'vitest';
import { challengeFor, prepareContractCall, semanticAttemptId } from '../../src/attempt.ts';
import type { ScenarioEvidence } from '../../src/evidence.ts';
import { writeEvidence } from '../../src/evidence.ts';
import { ABSENT_FUNCTION_ABI, ABSENT_FUNCTION_NAME, PING_ABI } from '../../src/fixture.ts';
import type { TransportRecord } from '../../src/keeperhub.ts';
import { KeeperhubProbeClient, readField, readStringField, sleep } from '../../src/keeperhub.ts';
import {
  credentialShapedEnvNames,
  loadLocalEnv,
  readKeeperhubCredential,
} from '../../src/local-env.ts';
import { countEffects, pace, pollExecution, reconcileChain } from '../../src/probe.ts';
import { getBlockNumber } from '../../src/rpc.ts';

let client: KeeperhubProbeClient;
let runLabel: string;
let startBlock: number;

function summarize(record: TransportRecord): string {
  return record.transportError !== undefined
    ? `no HTTP response (${record.transportError}) after ${record.elapsedMs}ms`
    : `HTTP ${record.httpStatus} in ${record.elapsedMs}ms`;
}

function blank(): Omit<ScenarioEvidence, 'id' | 'question' | 'observation' | 'transport'> {
  return {
    semanticAttemptId: undefined,
    challenge: undefined,
    idempotencyKey: undefined,
    requestBodyHash: undefined,
    requestBody: undefined,
    executionId: undefined,
    statusTransitions: [],
    chain: undefined,
    onchainEffectCount: undefined,
  };
}

function record(evidence: ScenarioEvidence): void {
  writeEvidence(evidence, client.knownSecrets);
  console.log(`[${evidence.id}] ${evidence.observation}`);
}

beforeAll(async () => {
  loadLocalEnv();
  const credential = readKeeperhubCredential();
  if (!credential.ok) {
    throw new Error(
      [
        'USER ACTION REQUIRED',
        `credential-shaped variable names visible: ${credentialShapedEnvNames().join(', ') || '(none)'}`,
        credential.reason,
      ].join('\n'),
    );
  }
  client = new KeeperhubProbeClient(credential.credential.value);
  runLabel = `recovery-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`;
  startBlock = (await getBlockNumber()) ?? 0;
}, 60_000);

describe('phase 0.5 seam probe, recovery pass', () => {
  it('P13 deferred replay: can a lost response be recovered from KeeperHub at all', async () => {
    const attemptId = await semanticAttemptId('deferred-replay', runLabel);
    const challenge = await challengeFor(attemptId);
    const call = await prepareContractCall({
      semanticAttemptId: attemptId,
      functionName: 'ping',
      abi: PING_ABI,
      challenge,
    });

    const aborted = await client.call({
      method: 'POST',
      path: KEEPERHUB_ENDPOINTS.executeContractCall,
      bodyText: call.bodyText,
      requestBodyHash: call.bodyHash,
      idempotencyKey: call.idempotencyKey,
      abortAfterMs: 250,
    });

    // Replay the stored key on a fixed cadence until it stops reporting in-progress. This is
    // the recovery loop a real orchestrator would run, so its shape is part of the finding.
    const replays: TransportRecord[] = [];
    let recoveredExecutionId: string | undefined;
    let attempts = 0;
    while (attempts < 12 && recoveredExecutionId === undefined) {
      attempts += 1;
      await sleep(2000);
      const replay = await client.call({
        method: 'POST',
        path: KEEPERHUB_ENDPOINTS.executeContractCall,
        bodyText: call.bodyText,
        requestBodyHash: call.bodyHash,
        idempotencyKey: call.idempotencyKey,
      });
      replays.push(replay);
      recoveredExecutionId = readStringField(replay.responseBody, 'executionId');
    }

    const poll =
      recoveredExecutionId === undefined
        ? undefined
        : await pollExecution(client, recoveredExecutionId);
    const chain = await reconcileChain(poll?.transactionHash, challenge);
    const effects = await countEffects(challenge, startBlock);

    const codes = replays.map(
      (replay) => `${replay.httpStatus}/${String(readField(replay.responseBody, 'code') ?? '-')}`,
    );

    record({
      ...blank(),
      id: 'P13-deferred-replay',
      question:
        'after a lost response, does replaying the idempotency key eventually return the original execution',
      semanticAttemptId: attemptId,
      challenge,
      idempotencyKey: call.idempotencyKey,
      requestBody: JSON.parse(call.bodyText),
      requestBodyHash: call.bodyHash,
      transport: [aborted, ...replays],
      executionId: recoveredExecutionId,
      statusTransitions: poll?.transitions ?? [],
      chain,
      onchainEffectCount: effects.count,
      observation: `abort ${summarize(aborted)}; ${replays.length} replays at 2s: ${codes.join(' -> ')}; recovered executionId=${String(recoveredExecutionId)}; idempotentReplay=${String(readField(replays.at(-1)?.responseBody, 'idempotentReplay'))}; chain=${chain.receiptVerdict} hash=${String(chain.transactionHash)}; effects=${effects.count} (${effects.hashes.join(',') || 'none'}); origins agreed=${chain.originsAgreed}`,
    });
    expect(aborted.httpStatus).toBeUndefined();
    expect(replays.length).toBeGreaterThan(0);
  }, 300_000);

  it('P14 would-revert broadcast, repeated: is the refusal deterministic and pre-broadcast', async () => {
    const observations: string[] = [];
    const transport: TransportRecord[] = [];
    let totalEffects = 0;

    for (const round of ['a', 'b']) {
      const attemptId = await semanticAttemptId(`absent-fn-${round}`, runLabel);
      const challenge = await challengeFor(attemptId);
      const call = await prepareContractCall({
        semanticAttemptId: attemptId,
        functionName: ABSENT_FUNCTION_NAME,
        abi: ABSENT_FUNCTION_ABI,
        challenge,
      });
      const response = await client.call({
        method: 'POST',
        path: KEEPERHUB_ENDPOINTS.executeContractCall,
        bodyText: call.bodyText,
        requestBodyHash: call.bodyHash,
        idempotencyKey: call.idempotencyKey,
      });
      transport.push(response);
      const executionId = readStringField(response.responseBody, 'executionId');
      const status =
        executionId === undefined ? undefined : await pollExecution(client, executionId);
      const effects = await countEffects(challenge, startBlock);
      totalEffects += effects.count;
      const body = status?.transitions.at(-1)?.body;
      observations.push(
        `${round}: ${summarize(response)} status=${String(readStringField(response.responseBody, 'status'))} finalStatus=${String(status?.finalStatus)} hash=${String(status?.transactionHash)} sponsored=${String(readField(body, 'sponsored'))} receipts=${JSON.stringify(readField(body, 'receipts'))} error=${String(readField(body, 'error')).slice(0, 140)} effects=${effects.count}`,
      );
      await pace();
    }

    record({
      ...blank(),
      id: 'P14-would-revert-broadcast-repeat',
      question:
        'is a would-revert contract call refused before broadcast every time, and what does KeeperHub call the reason',
      transport,
      onchainEffectCount: totalEffects,
      observation: observations.join(' | '),
    });
    expect(totalEffects).toBe(0);
  }, 300_000);

  it('P15 conflict channel: does a 409 hand back the execution id of a lost request', async () => {
    const attemptId = await semanticAttemptId('conflict-recovery', runLabel);
    const challenge = await challengeFor(attemptId);
    const call = await prepareContractCall({
      semanticAttemptId: attemptId,
      functionName: 'ping',
      abi: PING_ABI,
      challenge,
    });

    const aborted = await client.call({
      method: 'POST',
      path: KEEPERHUB_ENDPOINTS.executeContractCall,
      bodyText: call.bodyText,
      requestBodyHash: call.bodyHash,
      idempotencyKey: call.idempotencyKey,
      abortAfterMs: 250,
    });

    // Wait past the in-progress window, then deliberately send a *different* body under the
    // same key. The documented answer is 409 idempotency_conflict; the undocumented question
    // is whether it names the original execution.
    await sleep(12_000);
    const other = await semanticAttemptId('conflict-recovery-other', runLabel);
    const differing = await prepareContractCall({
      semanticAttemptId: other,
      functionName: 'ping',
      abi: PING_ABI,
      challenge: await challengeFor(other),
    });
    const conflict = await client.call({
      method: 'POST',
      path: KEEPERHUB_ENDPOINTS.executeContractCall,
      bodyText: differing.bodyText,
      requestBodyHash: differing.bodyHash,
      idempotencyKey: call.idempotencyKey,
    });

    const named = readStringField(conflict.responseBody, 'originalExecutionId');
    const status = named === undefined ? undefined : await pollExecution(client, named);
    const chain = await reconcileChain(status?.transactionHash, challenge);
    const effects = await countEffects(challenge, startBlock);
    const otherEffects = await countEffects(await challengeFor(other), startBlock);

    record({
      ...blank(),
      id: 'P15-conflict-recovery-channel',
      question:
        'does a 409 idempotency_conflict name the execution the lost request created, and does the conflicting body execute',
      semanticAttemptId: attemptId,
      challenge,
      idempotencyKey: call.idempotencyKey,
      requestBody: JSON.parse(call.bodyText),
      requestBodyHash: call.bodyHash,
      transport: [aborted, conflict],
      executionId: named,
      statusTransitions: status?.transitions ?? [],
      chain,
      onchainEffectCount: effects.count,
      observation: `abort ${summarize(aborted)}; conflict ${summarize(conflict)} code=${String(readField(conflict.responseBody, 'code'))} retryable=${String(readField(conflict.responseBody, 'retryable'))} originalExecutionId=${String(named)}; recovered status=${String(status?.finalStatus)} hash=${String(status?.transactionHash)}; chain=${chain.receiptVerdict}; effects for the lost attempt=${effects.count}; effects for the conflicting body=${otherEffects.count}`,
    });
    expect(aborted.httpStatus).toBeUndefined();
    expect(conflict.httpStatus).toBe(409);
  }, 300_000);
});

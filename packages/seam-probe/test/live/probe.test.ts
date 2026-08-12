/**
 * PHASE 0.5 seam recorder.
 *
 * This file makes real KeeperHub calls with the organization credential and lands real
 * transactions on Base Sepolia. It is deliberately not reachable from `pnpm test`, from
 * `pnpm gate`, or from any auto-approved Claude Code command:
 *
 *     pnpm --filter @resurv/seam-probe test:seam
 *
 * It records rather than asserts. The outcome of every scenario below is the thing Phase 0.5
 * is measuring, so an expectation about what KeeperHub *should* return would beg the question.
 * The assertions here are about the evidence being complete and free of credentials.
 *
 * A second live file, pinning the behavior that was actually observed so a KeeperHub change
 * fails a test, is deliberately not written yet: nothing has been observed. It is the first
 * thing the session that completes this phase adds, and `docs/keeperhub/SEAM_CHECKLIST.md`
 * tracks which of the twelve states each scenario has settled.
 */

import { KEEPERHUB_ENDPOINTS } from '@resurv/keeperhub-client';
import { beforeAll, describe, expect, it } from 'vitest';
import { challengeFor, prepareContractCall, semanticAttemptId } from '../../src/attempt.ts';
import type { ScenarioEvidence } from '../../src/evidence.ts';
import { writeEvidence, writeIndex } from '../../src/evidence.ts';
import {
  ABSENT_FUNCTION_ABI,
  ABSENT_FUNCTION_NAME,
  CANARY_ADDRESS,
  PING_ABI,
  PING_INTRINSIC_GAS,
  PING_SELECTOR,
} from '../../src/fixture.ts';
import type { TransportRecord } from '../../src/keeperhub.ts';
import { KeeperhubProbeClient, readField, readStringField } from '../../src/keeperhub.ts';
import {
  credentialShapedEnvNames,
  loadLocalEnv,
  readKeeperhubCredential,
} from '../../src/local-env.ts';
import { countEffects, pace, pollExecution, reconcileChain } from '../../src/probe.ts';
import { estimateGas, getBlockNumber } from '../../src/rpc.ts';

const FAKE_KEY = 'kh_0000000000000000000000000000000000000000';

let client: KeeperhubProbeClient;
let runLabel: string;
let startBlock: number;
let khGasEstimate: number | undefined;
const written: { id: string; question: string; observation: string }[] = [];

interface SuccessState {
  readonly attemptId: string;
  readonly challenge: string;
  readonly call: Awaited<ReturnType<typeof prepareContractCall>>;
  readonly executionId: string | undefined;
  readonly hash: string | undefined;
}

let successState: SuccessState | undefined;

function record(evidence: ScenarioEvidence): void {
  writeEvidence(evidence, client.knownSecrets);
  written.push({ id: evidence.id, question: evidence.question, observation: evidence.observation });
  console.log(`[${evidence.id}] ${evidence.observation}`);
}

function summarize(record_: TransportRecord): string {
  return record_.transportError !== undefined
    ? `no HTTP response (${record_.transportError}) after ${record_.elapsedMs}ms`
    : `HTTP ${record_.httpStatus} in ${record_.elapsedMs}ms`;
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

beforeAll(async () => {
  const load = loadLocalEnv();
  const credential = readKeeperhubCredential();
  if (!credential.ok) {
    throw new Error(
      [
        'USER ACTION REQUIRED',
        `runtime configuration file found: ${load.source ?? '(none)'}`,
        ...load.candidates.map(
          (candidate) =>
            `  ${candidate.readable ? 'readable' : candidate.reason}  ${candidate.path}`,
        ),
        `names assigned: ${load.assigned.join(', ') || '(none)'}`,
        `names already in the process environment: ${load.skipped.join(', ') || '(none)'}`,
        `credential-shaped variable names visible to this process: ${credentialShapedEnvNames().join(', ') || '(none)'}`,
        credential.reason,
      ].join('\n'),
    );
  }
  client = new KeeperhubProbeClient(credential.credential.value);
  runLabel = new Date().toISOString().replaceAll(/[:.]/g, '-');
  startBlock = (await getBlockNumber()) ?? 0;
  console.log(
    `run ${runLabel}  credential ${credential.credential.fingerprint}  startBlock ${startBlock}`,
  );
}, 60_000);

describe('phase 0.5 seam probe', () => {
  it('P00 preflight: credential, chain list, organization identity', async () => {
    const keys = await client.call({ method: 'GET', path: KEEPERHUB_ENDPOINTS.keys });
    await pace();
    const chains = await client.call({ method: 'GET', path: KEEPERHUB_ENDPOINTS.chains });
    await pace();
    const user = await client.call({ method: 'GET', path: KEEPERHUB_ENDPOINTS.user });

    const list = Array.isArray(chains.responseBody)
      ? (chains.responseBody as unknown[])
      : ((readField(chains.responseBody, 'chains') as unknown[] | undefined) ?? []);
    const base = list.find((entry) => readField(entry, 'chainId') === 84532);

    record({
      ...blank(),
      id: 'P00-preflight',
      question: 'is the credential live, is Base Sepolia enabled, and what is the org identity',
      transport: [keys, chains, user],
      observation: [
        `GET /api/keys ${summarize(keys)}`,
        `GET /api/chains ${summarize(chains)}`,
        `base sepolia entry ${base === undefined ? 'ABSENT' : JSON.stringify(base)}`,
        `GET /api/user ${summarize(user)}`,
      ].join('; '),
    });
    expect(keys.httpStatus).toBe(200);
    expect(base).toBeDefined();
  }, 120_000);

  it('P01 local rejection: refused before any request leaves the process', async () => {
    const { isApiKeyShapeValid } = await import('@resurv/keeperhub-client');
    const { idempotencyPreimage } = await import('@resurv/keeperhub-client');

    const webhookKey = isApiKeyShapeValid('wfb_abcdefghij');
    const unprefixed = isApiKeyShapeValid('abcdefghij');
    const prefixOnly = isApiKeyShapeValid('kh_');
    let separatorRejected = 'not thrown';
    try {
      idempotencyPreimage({
        chainId: 84532,
        contractAddress: CANARY_ADDRESS,
        functionName: 'ping',
        functionArgs: '["a|b"]',
        value: '0',
        semanticAttemptId: 'x',
      });
    } catch (error) {
      separatorRejected = error instanceof Error ? error.message : String(error);
    }

    record({
      ...blank(),
      id: 'P01-local-rejection',
      question: 'which requests are refused locally, with zero network exposure',
      transport: [],
      requestBody: { webhookKey, unprefixed, prefixOnly, separatorRejected },
      observation: `client-side rejections, 0 HTTP requests: webhook key ${webhookKey.valid}, unprefixed ${unprefixed.valid}, prefix-only ${prefixOnly.valid}, separator guard "${separatorRejected}"`,
    });
    expect(webhookKey.valid).toBe(false);
    expect(unprefixed.valid).toBe(false);
    expect(prefixOnly.valid).toBe(false);
  });

  it('P02 authentication failure: wrong key and no key', async () => {
    const attemptId = await semanticAttemptId('auth', runLabel);
    const call = await prepareContractCall({
      semanticAttemptId: attemptId,
      functionName: 'ping',
      abi: PING_ABI,
      challenge: await challengeFor(attemptId),
      simulate: true,
    });

    const wrongKey = await client.call({
      method: 'POST',
      path: KEEPERHUB_ENDPOINTS.executeContractCall,
      bodyText: call.bodyText,
      requestBodyHash: call.bodyHash,
      authorizationOverride: `Bearer ${FAKE_KEY}`,
    });
    await pace();
    const noKey = await client.call({
      method: 'POST',
      path: KEEPERHUB_ENDPOINTS.executeContractCall,
      bodyText: call.bodyText,
      requestBodyHash: call.bodyHash,
      authorizationOverride: null,
    });

    record({
      ...blank(),
      id: 'P02-auth-failure',
      question: 'what does an authentication failure look like, and does it carry a request id',
      transport: [wrongKey, noKey],
      requestBody: JSON.parse(call.bodyText),
      requestBodyHash: call.bodyHash,
      observation: `wrong key ${summarize(wrongKey)}; missing key ${summarize(noKey)}`,
    });
    expect(wrongKey.httpStatus).toBeGreaterThanOrEqual(400);
    expect(noKey.httpStatus).toBeGreaterThanOrEqual(400);
  }, 120_000);

  it('P03 simulation accepted: a call that should succeed', async () => {
    const attemptId = await semanticAttemptId('simulate-ok', runLabel);
    const challenge = await challengeFor(attemptId);
    const call = await prepareContractCall({
      semanticAttemptId: attemptId,
      functionName: 'ping',
      abi: PING_ABI,
      challenge,
      simulate: true,
    });

    const response = await client.call({
      method: 'POST',
      path: KEEPERHUB_ENDPOINTS.executeContractCall,
      bodyText: call.bodyText,
      requestBodyHash: call.bodyHash,
    });
    const estimate = readStringField(response.responseBody, 'gasEstimate');
    khGasEstimate = estimate === undefined ? undefined : Number(estimate);

    const effects = await countEffects(challenge, startBlock);

    record({
      ...blank(),
      id: 'P03-simulation-accepted',
      question: 'does a simulation answer, what is `from`, and does it touch chain',
      semanticAttemptId: attemptId,
      challenge,
      requestBody: JSON.parse(call.bodyText),
      requestBodyHash: call.bodyHash,
      transport: [response],
      onchainEffectCount: effects.count,
      observation: `${summarize(response)}; wouldRevert=${String(readField(response.responseBody, 'wouldRevert'))}; from=${String(readField(response.responseBody, 'from'))}; gasEstimate=${String(estimate)}; onchain effects for this challenge=${effects.count}`,
    });
    expect(effects.count).toBe(0);
  }, 120_000);

  it('P04 simulation rejected: a call that must revert', async () => {
    const attemptId = await semanticAttemptId('simulate-revert', runLabel);
    const challenge = await challengeFor(attemptId);
    const call = await prepareContractCall({
      semanticAttemptId: attemptId,
      functionName: ABSENT_FUNCTION_NAME,
      abi: ABSENT_FUNCTION_ABI,
      challenge,
      simulate: true,
    });

    const response = await client.call({
      method: 'POST',
      path: KEEPERHUB_ENDPOINTS.executeContractCall,
      bodyText: call.bodyText,
      requestBodyHash: call.bodyHash,
    });

    record({
      ...blank(),
      id: 'P04-simulation-rejected',
      question: 'is a would-revert simulation an answer or an error, and is anything broadcast',
      semanticAttemptId: attemptId,
      challenge,
      requestBody: JSON.parse(call.bodyText),
      requestBodyHash: call.bodyHash,
      transport: [response],
      executionId: readStringField(response.responseBody, 'executionId'),
      observation: `${summarize(response)}; wouldRevert=${String(readField(response.responseBody, 'wouldRevert'))}; revertReason=${String(readField(response.responseBody, 'revertReason'))}; executionId=${String(readStringField(response.responseBody, 'executionId'))}`,
    });
  }, 120_000);

  it('P05 broadcast accepted and confirmed', async () => {
    const attemptId = await semanticAttemptId('broadcast-success', runLabel);
    const challenge = await challengeFor(attemptId);
    const call = await prepareContractCall({
      semanticAttemptId: attemptId,
      functionName: 'ping',
      abi: PING_ABI,
      challenge,
    });

    const response = await client.call({
      method: 'POST',
      path: KEEPERHUB_ENDPOINTS.executeContractCall,
      bodyText: call.bodyText,
      requestBodyHash: call.bodyHash,
      idempotencyKey: call.idempotencyKey,
      requestId: `resurv-${attemptId.slice(0, 16)}`,
    });
    const executionId = readStringField(response.responseBody, 'executionId');
    const poll = executionId === undefined ? undefined : await pollExecution(client, executionId);
    const chain = await reconcileChain(poll?.transactionHash, challenge);
    const effects = await countEffects(challenge, startBlock);

    successState = { attemptId, challenge, call, executionId, hash: poll?.transactionHash };

    record({
      ...blank(),
      id: 'P05-broadcast-confirmed',
      question: 'what does an accepted broadcast return, and does chain agree with KeeperHub',
      semanticAttemptId: attemptId,
      challenge,
      idempotencyKey: call.idempotencyKey,
      requestBody: JSON.parse(call.bodyText),
      requestBodyHash: call.bodyHash,
      transport: [response],
      executionId,
      statusTransitions: poll?.transitions ?? [],
      chain,
      onchainEffectCount: effects.count,
      observation: `${summarize(response)}; 202 body fields=${Object.keys((response.responseBody ?? {}) as object).join(',')}; final KeeperHub status=${String(poll?.finalStatus)}; receiptStatus=${String(poll?.receiptStatus)}; hash=${String(poll?.transactionHash)}; chain receipt=${chain.receiptVerdict} at block ${String(chain.blockNumber)}; origins agreed=${chain.originsAgreed}; effects=${effects.count}`,
    });
    expect(executionId).toBeDefined();
  }, 300_000);

  it('P06 transport retry: same key, byte-identical body', async () => {
    const previous = successState;
    expect(previous).toBeDefined();
    if (previous === undefined) return;

    const response = await client.call({
      method: 'POST',
      path: KEEPERHUB_ENDPOINTS.executeContractCall,
      bodyText: previous.call.bodyText,
      requestBodyHash: previous.call.bodyHash,
      idempotencyKey: previous.call.idempotencyKey,
    });
    const executionId = readStringField(response.responseBody, 'executionId');
    const effects = await countEffects(previous.challenge, startBlock);

    record({
      ...blank(),
      id: 'P06-transport-retry',
      question: 'does replaying the same idempotency key create a second economic effect',
      semanticAttemptId: previous.attemptId,
      challenge: previous.challenge,
      idempotencyKey: previous.call.idempotencyKey,
      requestBody: JSON.parse(previous.call.bodyText),
      requestBodyHash: previous.call.bodyHash,
      transport: [response],
      executionId,
      onchainEffectCount: effects.count,
      observation: `${summarize(response)}; idempotentReplay=${String(readField(response.responseBody, 'idempotentReplay'))}; executionId ${String(executionId)} vs original ${String(previous.executionId)} (${executionId === previous.executionId ? 'SAME' : 'DIFFERENT'}); onchain effects for this challenge=${effects.count}`,
    });
  }, 180_000);

  it('P07 idempotency conflict: same key, different body', async () => {
    const previous = successState;
    expect(previous).toBeDefined();
    if (previous === undefined) return;

    const otherAttempt = await semanticAttemptId('conflict-body', runLabel);
    const otherChallenge = await challengeFor(otherAttempt);
    const conflicting = await prepareContractCall({
      semanticAttemptId: otherAttempt,
      functionName: 'ping',
      abi: PING_ABI,
      challenge: otherChallenge,
    });

    const response = await client.call({
      method: 'POST',
      path: KEEPERHUB_ENDPOINTS.executeContractCall,
      bodyText: conflicting.bodyText,
      requestBodyHash: conflicting.bodyHash,
      idempotencyKey: previous.call.idempotencyKey,
    });
    const effects = await countEffects(otherChallenge, startBlock);

    record({
      ...blank(),
      id: 'P07-idempotency-conflict',
      question: 'what happens when a key is reused with a different body',
      semanticAttemptId: otherAttempt,
      challenge: otherChallenge,
      idempotencyKey: previous.call.idempotencyKey,
      requestBody: JSON.parse(conflicting.bodyText),
      requestBodyHash: conflicting.bodyHash,
      transport: [response],
      onchainEffectCount: effects.count,
      observation: `${summarize(response)}; error=${String(readField(response.responseBody, 'error'))}; retryable=${String(readField(response.responseBody, 'retryable'))}`,
    });
  }, 180_000);

  it('P08 semantic replay: same economic action, new idempotency key', async () => {
    const previous = successState;
    expect(previous).toBeDefined();
    if (previous === undefined) return;

    const newAttempt = await semanticAttemptId('broadcast-success-repeat', runLabel);
    const replay = await prepareContractCall({
      semanticAttemptId: newAttempt,
      functionName: 'ping',
      abi: PING_ABI,
      // Deliberately the *same* economic action: the same challenge word as P05.
      challenge: previous.challenge,
    });
    expect(replay.idempotencyKey).not.toBe(previous.call.idempotencyKey);

    const response = await client.call({
      method: 'POST',
      path: KEEPERHUB_ENDPOINTS.executeContractCall,
      bodyText: replay.bodyText,
      requestBodyHash: replay.bodyHash,
      idempotencyKey: replay.idempotencyKey,
    });
    const executionId = readStringField(response.responseBody, 'executionId');
    const poll = executionId === undefined ? undefined : await pollExecution(client, executionId);
    const chain = await reconcileChain(poll?.transactionHash, previous.challenge);
    const effects = await countEffects(previous.challenge, startBlock);

    record({
      ...blank(),
      id: 'P08-semantic-replay',
      question: 'does a new idempotency key permit a second execution of the same action',
      semanticAttemptId: newAttempt,
      challenge: previous.challenge,
      idempotencyKey: replay.idempotencyKey,
      requestBody: JSON.parse(replay.bodyText),
      requestBodyHash: replay.bodyHash,
      transport: [response],
      executionId,
      statusTransitions: poll?.transitions ?? [],
      chain,
      onchainEffectCount: effects.count,
      observation: `${summarize(response)}; executionId ${String(executionId)} vs P05 ${String(previous.executionId)}; final status=${String(poll?.finalStatus)}; chain=${chain.receiptVerdict}; total onchain effects for this challenge=${effects.count}`,
    });
  }, 300_000);

  it('P09 broadcast of a call with no matching selector', async () => {
    const attemptId = await semanticAttemptId('broadcast-absent-fn', runLabel);
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
    const executionId = readStringField(response.responseBody, 'executionId');
    const poll = executionId === undefined ? undefined : await pollExecution(client, executionId);
    const chain = await reconcileChain(poll?.transactionHash, challenge);

    record({
      ...blank(),
      id: 'P09-broadcast-absent-selector',
      question: 'does KeeperHub broadcast a transaction it can predict will revert',
      semanticAttemptId: attemptId,
      challenge,
      idempotencyKey: call.idempotencyKey,
      requestBody: JSON.parse(call.bodyText),
      requestBodyHash: call.bodyHash,
      transport: [response],
      executionId,
      statusTransitions: poll?.transitions ?? [],
      chain,
      onchainEffectCount: 0,
      observation: `${summarize(response)}; executionId=${String(executionId)}; hash=${String(poll?.transactionHash)}; KeeperHub status=${String(poll?.finalStatus)}; receiptStatus=${String(poll?.receiptStatus)}; chain=${chain.receiptVerdict}`,
    });
  }, 300_000);

  it('P10 broadcast that reverts onchain: a valid call starved of gas', async () => {
    const attemptId = await semanticAttemptId('broadcast-oog', runLabel);
    const challenge = await challengeFor(attemptId);
    const calldata = `${PING_SELECTOR}${challenge.slice(2)}`;
    const rpcEstimate = await estimateGas({ to: CANARY_ADDRESS, data: calldata });
    const executionGas =
      rpcEstimate.value === undefined ? 23_557 : Number.parseInt(rpcEstimate.value, 16);
    const targetGas = Math.floor((PING_INTRINSIC_GAS + executionGas) / 2);
    const basis = khGasEstimate ?? executionGas;
    const multiplier = Math.max(0.05, Math.min(0.99, targetGas / basis)).toFixed(3);

    const call = await prepareContractCall({
      semanticAttemptId: attemptId,
      functionName: 'ping',
      abi: PING_ABI,
      challenge,
      gasLimitMultiplier: multiplier,
    });

    const response = await client.call({
      method: 'POST',
      path: KEEPERHUB_ENDPOINTS.executeContractCall,
      bodyText: call.bodyText,
      requestBodyHash: call.bodyHash,
      idempotencyKey: call.idempotencyKey,
    });
    const executionId = readStringField(response.responseBody, 'executionId');
    const poll = executionId === undefined ? undefined : await pollExecution(client, executionId);
    const chain = await reconcileChain(poll?.transactionHash, challenge);
    const effects = await countEffects(challenge, startBlock);

    record({
      ...blank(),
      id: 'P10-broadcast-reverted',
      question:
        'when a broadcast transaction reverts onchain, is that distinguishable from a transport failure',
      semanticAttemptId: attemptId,
      challenge,
      idempotencyKey: call.idempotencyKey,
      requestBody: JSON.parse(call.bodyText),
      requestBodyHash: call.bodyHash,
      transport: [response],
      executionId,
      statusTransitions: poll?.transitions ?? [],
      chain,
      onchainEffectCount: effects.count,
      observation: `intrinsic=${PING_INTRINSIC_GAS} rpcEstimate=${executionGas} khEstimate=${String(khGasEstimate)} target=${targetGas} multiplier=${multiplier}; ${summarize(response)}; executionId=${String(executionId)}; KeeperHub status=${String(poll?.finalStatus)}; receiptStatus=${String(poll?.receiptStatus)}; hash=${String(poll?.transactionHash)}; chain=${chain.receiptVerdict} gasUsed=${String(chain.gasUsed)} gasLimit=${String(chain.gasLimit)}; effects=${effects.count}; revertReplay=${String(chain.revertData)}`,
    });
  }, 300_000);

  it('P11 transport failure after possible acceptance', async () => {
    const attemptId = await semanticAttemptId('transport-abort', runLabel);
    const challenge = await challengeFor(attemptId);
    const call = await prepareContractCall({
      semanticAttemptId: attemptId,
      functionName: 'ping',
      abi: PING_ABI,
      challenge,
    });

    // The request is fully sent and the client stops listening before any response can arrive.
    // Nothing is mocked: KeeperHub receives it and does whatever it does.
    const aborted = await client.call({
      method: 'POST',
      path: KEEPERHUB_ENDPOINTS.executeContractCall,
      bodyText: call.bodyText,
      requestBodyHash: call.bodyHash,
      idempotencyKey: call.idempotencyKey,
      abortAfterMs: 250,
    });
    await pace();

    // Recovery path 1: is there any way to find the execution without its id.
    const listA = await client.call({ method: 'GET', path: '/api/execute' });
    await pace();
    const listB = await client.call({ method: 'GET', path: '/api/executions' });
    await pace();

    // Recovery path 2: replay the stored key with a byte-identical body.
    const replay = await client.call({
      method: 'POST',
      path: KEEPERHUB_ENDPOINTS.executeContractCall,
      bodyText: call.bodyText,
      requestBodyHash: call.bodyHash,
      idempotencyKey: call.idempotencyKey,
    });
    const executionId = readStringField(replay.responseBody, 'executionId');
    const poll = executionId === undefined ? undefined : await pollExecution(client, executionId);

    // Recovery path 3: ask chain directly, and reconcile from whatever chain names. When
    // KeeperHub hands back no hash, the challenge word is the only handle RESURV has, and a
    // reconciler that can only start from a KeeperHub-supplied hash is useless in exactly the
    // case it exists for.
    const effects = await countEffects(challenge, startBlock);
    const chain = await reconcileChain(poll?.transactionHash ?? effects.hashes[0], challenge);

    record({
      ...blank(),
      id: 'P11-transport-abort',
      question:
        'the client did not receive a usable response: can RESURV find out whether the action happened',
      semanticAttemptId: attemptId,
      challenge,
      idempotencyKey: call.idempotencyKey,
      requestBody: JSON.parse(call.bodyText),
      requestBodyHash: call.bodyHash,
      transport: [aborted, listA, listB, replay],
      executionId,
      statusTransitions: poll?.transitions ?? [],
      chain,
      onchainEffectCount: effects.count,
      observation: `abort: ${summarize(aborted)}; GET /api/execute ${summarize(listA)}; GET /api/executions ${summarize(listB)}; key replay ${summarize(replay)} code=${String(readField(replay.responseBody, 'code'))} idempotentReplay=${String(readField(replay.responseBody, 'idempotentReplay'))} executionId=${String(executionId)}; chain effects for this challenge=${effects.count} (hashes ${effects.hashes.join(',') || 'none'}); chain-first reconciliation=${chain.receiptVerdict} sender=${String(chain.decodedSenderTopic)} block=${String(chain.blockNumber)} origins agreed=${chain.originsAgreed}`,
    });
    expect(aborted.httpStatus).toBeUndefined();
    expect(aborted.transportError).toBeDefined();
  }, 300_000);

  it('P12 unknown execution state', async () => {
    const missing = await client.call({
      method: 'GET',
      path: KEEPERHUB_ENDPOINTS.executionStatus('direct_resurv_does_not_exist'),
    });
    await pace();
    const malformed = await client.call({
      method: 'GET',
      path: KEEPERHUB_ENDPOINTS.executionStatus('not-an-id'),
    });

    record({
      ...blank(),
      id: 'P12-unknown-execution',
      question: 'what does KeeperHub say about an execution id it has never seen',
      transport: [missing, malformed],
      observation: `unknown id ${summarize(missing)} body=${JSON.stringify(missing.responseBody)}; malformed id ${summarize(malformed)}`,
    });
  }, 180_000);

  it('writes the evidence index', () => {
    const path = writeIndex(runLabel, written);
    console.log(`wrote ${written.length} evidence records; index at ${path}`);
    console.log(`total KeeperHub requests this run: ${client.requestCount}`);
    expect(written.length).toBeGreaterThanOrEqual(11);
  });
});

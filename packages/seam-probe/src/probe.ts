/**
 * Shared machinery for the live probe: polling, chain reconciliation, and pacing.
 *
 * Nothing here classifies a KeeperHub response. Classification is the question Phase 0.5 is
 * asking, and a helper that answered it in advance would make the measurement circular.
 */

import { KEEPERHUB_ENDPOINTS, RATE_LIMIT_HEADERS } from '@resurv/keeperhub-client';
import type { ChainObservation, StatusObservation } from './evidence.ts';
import { CANARY_ADDRESS, CANARY_EVENT_TOPIC0 } from './fixture.ts';
import { type KeeperhubProbeClient, readField, readStringField, sleep } from './keeperhub.ts';
import {
  callAtBlock,
  getLogs,
  getReceipt,
  getTransaction,
  type TransactionByHash,
  type TransactionReceipt,
} from './rpc.ts';

/** 60 requests per minute is the documented ceiling. One per second keeps a wide margin. */
export const PACE_MS = 1000;

export async function pace(): Promise<void> {
  await sleep(PACE_MS);
}

function readNestedStatus(body: unknown): string | undefined {
  const direct = readStringField(body, 'status');
  if (direct !== undefined) return direct;
  const execution = readField(body, 'execution');
  return readStringField(execution, 'status');
}

function readReceiptStatus(body: unknown): string | undefined {
  const receipts = readField(body, 'receipts');
  if (!Array.isArray(receipts)) return undefined;
  const first = receipts[0] as unknown;
  return readStringField(first, 'receiptStatus');
}

export interface PollResult {
  readonly transitions: readonly StatusObservation[];
  readonly finalStatus: string | undefined;
  readonly transactionHash: string | undefined;
  readonly receiptStatus: string | undefined;
  readonly timedOut: boolean;
}

/**
 * Polls until the observed status stops changing and matches a terminal value, or the budget
 * runs out. A transition is recorded whenever any of (status, transactionHash, receiptStatus)
 * changes, so the record shows the path rather than only the destination.
 */
export async function pollExecution(
  client: KeeperhubProbeClient,
  executionId: string,
  budgetMs = 120_000,
): Promise<PollResult> {
  const transitions: StatusObservation[] = [];
  const started = Date.now();
  let previous = '';
  let status: string | undefined;
  let transactionHash: string | undefined;
  let receiptStatus: string | undefined;
  let waitMs = 1000;

  while (Date.now() - started < budgetMs) {
    const record = await client.call({
      method: 'GET',
      path: KEEPERHUB_ENDPOINTS.executionStatus(executionId),
    });
    status = readNestedStatus(record.responseBody);
    transactionHash = readStringField(record.responseBody, 'transactionHash');
    receiptStatus = readReceiptStatus(record.responseBody);
    const hint = record.responseHeaders[RATE_LIMIT_HEADERS.pollIntervalHint.toLowerCase()];

    const signature = `${record.httpStatus}|${status}|${transactionHash}|${receiptStatus}`;
    if (signature !== previous) {
      transitions.push({
        atMs: Date.now() - started,
        httpStatus: record.httpStatus,
        status,
        transactionHash,
        receiptStatus,
        pollIntervalHint: hint,
        body: record.responseBody,
      });
      previous = signature;
    }

    if (status === 'completed' || status === 'failed') {
      return { transitions, finalStatus: status, transactionHash, receiptStatus, timedOut: false };
    }
    if (record.httpStatus !== undefined && record.httpStatus >= 400) {
      return { transitions, finalStatus: status, transactionHash, receiptStatus, timedOut: false };
    }

    const hinted = hint === undefined ? Number.NaN : Number(hint);
    waitMs = Number.isFinite(hinted) && hinted > 0 ? Math.min(hinted * 1000, 5000) : waitMs;
    await sleep(Math.max(waitMs, PACE_MS));
  }
  return { transitions, finalStatus: status, transactionHash, receiptStatus, timedOut: true };
}

/**
 * Counts the canary events carrying a given challenge, from both pinned RPC origins. This is
 * how "did a second onchain effect happen" is answered without trusting KeeperHub's own count.
 */
export async function countEffects(
  challenge: string,
  fromBlock: number,
): Promise<{ count: number; hashes: string[]; agreed: boolean }> {
  const quorum = await getLogs({
    address: CANARY_ADDRESS,
    topics: [CANARY_EVENT_TOPIC0],
    fromBlock,
    toBlock: 'latest',
  });
  const matching = (quorum.value ?? []).filter((entry) =>
    entry.topics.some((topic) => topic.toLowerCase() === challenge.toLowerCase()),
  );
  return {
    count: matching.length,
    hashes: [...new Set(matching.map((entry) => entry.transactionHash))],
    agreed: quorum.agreed,
  };
}

const NO_CHAIN_OBSERVATION: ChainObservation = {
  transactionHash: undefined,
  receiptStatusHex: undefined,
  receiptVerdict: 'absent',
  blockNumber: undefined,
  from: undefined,
  to: undefined,
  gasUsed: undefined,
  gasLimit: undefined,
  decodedSenderTopic: undefined,
  decodedChallengeTopic: undefined,
  originsAgreed: false,
  originAnswers: undefined,
  revertData: undefined,
};

function verdictOf(receipt: TransactionReceipt | undefined): ChainObservation['receiptVerdict'] {
  if (receipt === undefined) return 'absent';
  if (receipt.status === '0x1') return 'success';
  if (receipt.status === '0x0') return 'reverted';
  return 'unknown';
}

/**
 * The canary event's Solidity name is not published, so its two indexed parameters are
 * identified by shape: whichever topic equals the challenge is the challenge, and whichever
 * looks like a left-padded address is the caller.
 */
function decodeCanaryTopics(
  receipt: TransactionReceipt | undefined,
  challenge: string | undefined,
): { challengeTopic: string | undefined; senderTopic: string | undefined } {
  const log = receipt?.logs.find(
    (entry) =>
      entry.address.toLowerCase() === CANARY_ADDRESS.toLowerCase() &&
      entry.topics[0]?.toLowerCase() === CANARY_EVENT_TOPIC0,
  );
  const challengeTopic = log?.topics.find(
    (topic) => challenge !== undefined && topic.toLowerCase() === challenge.toLowerCase(),
  );
  const senderTopic = log?.topics
    .slice(1)
    .find((topic) => topic !== challengeTopic && /^0x0{24}[0-9a-fA-F]{40}$/.test(topic));
  return { challengeTopic, senderTopic };
}

/** A receipt carries no revert reason, so the call is replayed at the parent block to get one. */
async function recoverRevertReason(
  transaction: TransactionByHash,
  blockNumber: number,
): Promise<string> {
  const replay = await callAtBlock(
    {
      to: transaction.to ?? CANARY_ADDRESS,
      data: transaction.input,
      ...(transaction.from === undefined ? {} : { from: transaction.from }),
    },
    blockNumber - 1,
  );
  return replay.answers
    .map((answer) => `${answer.origin}: ${answer.error ?? 'no error'}`)
    .join(' | ');
}

export async function reconcileChain(
  transactionHash: string | undefined,
  challenge: string | undefined,
): Promise<ChainObservation> {
  if (transactionHash === undefined) return NO_CHAIN_OBSERVATION;

  const [receiptQuorum, transactionQuorum] = await Promise.all([
    getReceipt(transactionHash),
    getTransaction(transactionHash),
  ]);
  const receipt = receiptQuorum.value ?? undefined;
  const transaction = transactionQuorum.value ?? undefined;
  const { challengeTopic, senderTopic } = decodeCanaryTopics(receipt, challenge);
  const blockNumber =
    receipt?.blockNumber === undefined ? undefined : Number.parseInt(receipt.blockNumber, 16);
  const reverted = receipt?.status === '0x0' && transaction !== undefined;

  return {
    transactionHash,
    receiptStatusHex: receipt?.status,
    receiptVerdict: verdictOf(receipt),
    blockNumber,
    from: receipt?.from,
    to: receipt?.to ?? undefined,
    gasUsed: receipt?.gasUsed,
    gasLimit: transaction?.gas,
    decodedSenderTopic: senderTopic,
    decodedChallengeTopic: challengeTopic,
    originsAgreed: receiptQuorum.agreed,
    originAnswers: receiptQuorum.answers.map((answer) => ({
      origin: answer.origin,
      ok: answer.ok,
      status: answer.value?.status,
      blockNumber: answer.value?.blockNumber,
      error: answer.error,
    })),
    revertData:
      reverted && blockNumber !== undefined
        ? await recoverRevertReason(transaction, blockNumber)
        : undefined,
  };
}

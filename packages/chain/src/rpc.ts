/**
 * Independent chain reads, across two origins that must agree.
 *
 * `docs/THREAT_MODEL.md` T8 and T9: a run is proven when a receipt fetched from a node RESURV
 * does not control agrees with what KeeperHub reported, and no single node decides a proof.
 *
 * Agreement is judged on a projection, never on the raw JSON. Measured on 2026-08-12:
 * `sepolia.base.org` and `base-sepolia-rpc.publicnode.com` returned the same receipt, with the
 * same status at the same block, and a byte comparison said they disagreed. OP-stack nodes
 * differ on optional L1-fee accounting, key order and hex casing, none of which decides
 * anything. A check that cries wolf on every reconciliation is worse than no check, because a
 * reader learns to ignore it.
 */

import { PUBLIC_RPC_URLS } from './constants.ts';

export interface RpcAnswer<T> {
  readonly origin: string;
  readonly ok: boolean;
  readonly value: T | undefined;
  readonly error: string | undefined;
  readonly elapsedMs: number;
}

export interface Quorum<T> {
  readonly method: string;
  readonly answers: readonly RpcAnswer<T>[];
  /** True when every origin that answered agreed on the projection. */
  readonly agreed: boolean;
  /** How many origins answered at all. One answer is not a quorum. */
  readonly respondingOrigins: number;
  readonly value: T | undefined;
}

export interface RpcOptions {
  readonly origins?: readonly string[];
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 20_000;

async function callOne<T>(
  origin: string,
  method: string,
  params: readonly unknown[],
  options: RpcOptions,
): Promise<RpcAnswer<T>> {
  const started = Date.now();
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('rpc-timeout')),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    const response = await doFetch(origin, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    const parsed = (await response.json()) as { result?: T; error?: { message?: string } };
    if (parsed.error !== undefined) {
      return {
        origin,
        ok: false,
        value: undefined,
        error: parsed.error.message ?? 'rpc error',
        elapsedMs: Date.now() - started,
      };
    }
    return {
      origin,
      ok: true,
      value: parsed.result,
      error: undefined,
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    return {
      origin,
      ok: false,
      value: undefined,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function rpcQuorum<T>(
  method: string,
  params: readonly unknown[],
  fingerprint: (value: T | undefined) => unknown = (value) => value,
  options: RpcOptions = {},
): Promise<Quorum<T>> {
  const origins = options.origins ?? PUBLIC_RPC_URLS;
  const answers = await Promise.all(
    origins.map((origin) => callOne<T>(origin, method, params, options)),
  );
  const successful = answers.filter((answer) => answer.ok);
  const serialized = successful.map((answer) => JSON.stringify(fingerprint(answer.value) ?? null));
  return {
    method,
    answers,
    agreed: serialized.length > 1 && new Set(serialized).size === 1,
    respondingOrigins: successful.length,
    value: successful[0]?.value,
  };
}

export interface RpcLog {
  readonly address: string;
  readonly topics: readonly string[];
  readonly data: string;
  readonly blockNumber: string;
  readonly transactionHash: string;
  readonly logIndex: string;
}

export interface RpcReceipt {
  readonly transactionHash: string;
  readonly status: string;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly from: string;
  readonly to: string | null;
  readonly gasUsed: string;
  readonly logs: readonly RpcLog[];
}

/**
 * The consensus-relevant part of a receipt: what it settled, where, and what it emitted.
 * Everything outside this projection is recorded and not judged.
 */
export function receiptFingerprint(receipt: RpcReceipt | null | undefined): unknown {
  if (receipt === null || receipt === undefined) return null;
  return {
    transactionHash: receipt.transactionHash?.toLowerCase(),
    status: receipt.status,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    logs: (receipt.logs ?? []).map((entry) => ({
      address: entry.address?.toLowerCase(),
      topics: entry.topics.map((topic) => topic.toLowerCase()),
      data: entry.data,
    })),
  };
}

export async function getReceipt(
  hash: string,
  options: RpcOptions = {},
): Promise<Quorum<RpcReceipt | null>> {
  return rpcQuorum<RpcReceipt | null>(
    'eth_getTransactionReceipt',
    [hash],
    receiptFingerprint,
    options,
  );
}

export async function getBlockNumber(options: RpcOptions = {}): Promise<number | undefined> {
  const quorum = await rpcQuorum<string>('eth_blockNumber', [], undefined, options);
  return quorum.value === undefined ? undefined : Number.parseInt(quorum.value, 16);
}

export async function getLogs(
  query: {
    address?: string;
    topics: readonly (string | null | readonly string[])[];
    fromBlock: number;
    toBlock: number | 'latest';
  },
  options: RpcOptions = {},
): Promise<Quorum<RpcLog[]>> {
  return rpcQuorum<RpcLog[]>(
    'eth_getLogs',
    [
      {
        ...(query.address === undefined ? {} : { address: query.address }),
        topics: query.topics,
        fromBlock: `0x${query.fromBlock.toString(16)}`,
        toBlock: query.toBlock === 'latest' ? 'latest' : `0x${query.toBlock.toString(16)}`,
      },
    ],
    // `toBlock: latest` resolves to a different head on each origin, so the answers are
    // compared on the log identities they name rather than on the window they cover.
    (logs) => (logs ?? []).map((entry) => `${entry.transactionHash}:${entry.logIndex}`).sort(),
    options,
  );
}

export interface EthCallRequest {
  readonly from?: string;
  readonly to: string;
  readonly data: string;
}

export async function ethCall(
  request: EthCallRequest,
  block: number | 'latest' = 'latest',
  options: RpcOptions = {},
): Promise<Quorum<string>> {
  return rpcQuorum<string>(
    'eth_call',
    [request, block === 'latest' ? 'latest' : `0x${block.toString(16)}`],
    undefined,
    options,
  );
}

/**
 * Base Sepolia produces a block about every two seconds. Absence of an effect is only evidence
 * after enough of them have passed that a broadcast would have landed.
 */
export const BASE_SEPOLIA_BLOCK_TIME_MS = 2000;

/** How long RESURV waits before treating "no effect on chain" as proof of no broadcast. */
export const SETTLEMENT_WINDOW_MS = 90_000;

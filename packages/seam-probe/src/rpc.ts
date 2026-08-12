/**
 * Independent chain reads.
 *
 * The rule from `docs/THREAT_MODEL.md` T8 and T9: a run is proven when a receipt fetched from
 * a node RESURV does not control agrees with what KeeperHub reported, and no single node
 * decides a proof. Both pinned origins are queried for every read and disagreement is
 * recorded rather than resolved, because a reconciler that silently picks a winner is exactly
 * the thing the threat model warns about.
 */

import { PUBLIC_RPC_URLS } from '@resurv/chain';

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
  /** True when every origin that answered returned the same JSON. */
  readonly agreed: boolean;
  readonly value: T | undefined;
}

async function callOne<T>(
  origin: string,
  method: string,
  params: unknown[],
): Promise<RpcAnswer<T>> {
  const started = performance.now();
  try {
    const response = await fetch(origin, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const parsed = (await response.json()) as { result?: T; error?: { message?: string } };
    const elapsedMs = Math.round(performance.now() - started);
    if (parsed.error !== undefined) {
      return {
        origin,
        ok: false,
        value: undefined,
        error: parsed.error.message ?? 'rpc error',
        elapsedMs,
      };
    }
    return { origin, ok: true, value: parsed.result, error: undefined, elapsedMs };
  } catch (error) {
    return {
      origin,
      ok: false,
      value: undefined,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      elapsedMs: Math.round(performance.now() - started),
    };
  }
}

export async function rpcQuorum<T>(method: string, params: unknown[]): Promise<Quorum<T>> {
  const answers = await Promise.all(
    PUBLIC_RPC_URLS.map((origin) => callOne<T>(origin, method, params)),
  );
  const successful = answers.filter((answer) => answer.ok);
  const serialized = successful.map((answer) => JSON.stringify(answer.value ?? null));
  const agreed = serialized.length > 1 && new Set(serialized).size === 1;
  return { method, answers, agreed, value: successful[0]?.value };
}

export interface TransactionReceipt {
  readonly transactionHash: string;
  readonly status: string;
  readonly blockNumber: string;
  readonly from: string;
  readonly to: string | null;
  readonly gasUsed: string;
  readonly logs: readonly { address: string; topics: readonly string[]; data: string }[];
}

export async function getReceipt(hash: string): Promise<Quorum<TransactionReceipt | null>> {
  return rpcQuorum<TransactionReceipt | null>('eth_getTransactionReceipt', [hash]);
}

export interface TransactionByHash {
  readonly hash: string;
  readonly from: string;
  readonly to: string | null;
  readonly input: string;
  readonly gas: string;
  readonly value: string;
  readonly blockNumber: string | null;
}

export async function getTransaction(hash: string): Promise<Quorum<TransactionByHash | null>> {
  return rpcQuorum<TransactionByHash | null>('eth_getTransactionByHash', [hash]);
}

export async function getBlockNumber(): Promise<number | undefined> {
  const quorum = await rpcQuorum<string>('eth_blockNumber', []);
  return quorum.value === undefined ? undefined : Number.parseInt(quorum.value, 16);
}

export interface LogEntry {
  readonly address: string;
  readonly topics: readonly string[];
  readonly data: string;
  readonly blockNumber: string;
  readonly transactionHash: string;
}

/**
 * Every matching log in a block window. This is how "did a second onchain effect happen"
 * is answered: the probe searches for its own challenge value as an indexed topic and counts
 * the transactions that carry it.
 */
export async function getLogs(query: {
  address: string;
  topics: (string | null)[];
  fromBlock: number;
  toBlock: number | 'latest';
}): Promise<Quorum<LogEntry[]>> {
  return rpcQuorum<LogEntry[]>('eth_getLogs', [
    {
      address: query.address,
      topics: query.topics,
      fromBlock: `0x${query.fromBlock.toString(16)}`,
      toBlock: query.toBlock === 'latest' ? 'latest' : `0x${query.toBlock.toString(16)}`,
    },
  ]);
}

export interface CallRequest {
  readonly from?: string;
  readonly to: string;
  readonly data: string;
  readonly gas?: string;
  readonly value?: string;
}

export async function estimateGas(request: CallRequest): Promise<Quorum<string>> {
  return rpcQuorum<string>('eth_estimateGas', [request, 'latest']);
}

/**
 * Replays a call at a historical block to recover a revert reason a receipt does not carry.
 * The answer arrives as an RPC error rather than a result, which is why the whole quorum is
 * returned rather than a value.
 */
export async function callAtBlock(
  request: CallRequest,
  blockNumber: number,
): Promise<Quorum<string>> {
  return rpcQuorum<string>('eth_call', [request, `0x${blockNumber.toString(16)}`]);
}

/**
 * Base Sepolia has no `eth_getTransactionByHash` for a transaction that was never broadcast,
 * so absence is only evidence after the window a broadcast would have landed in. Callers wait
 * this long before recording that nothing was broadcast.
 */
export const BASE_SEPOLIA_BLOCK_TIME_MS = 2000;

/**
 * The live half of the proof page.
 *
 * Everything the page shows about the past comes from committed artifacts. Everything it shows
 * about *now* comes from here: two independent public RPC origins, queried from the visitor's
 * own browser, with no RESURV server in the path. A judge who does not trust this page can run
 * the same reads with `cast` and get the same answers, which is the point.
 */

import { ethCall, getReceipt, PUBLIC_RPC_URLS, type RpcReceipt } from '@resurv/chain';
import { RECEIPT } from '@resurv/proof';
import { decodeAbiParameters, encodeFunctionData } from 'viem';

const MANAGER_ABI = [
  {
    type: 'function',
    name: 'statusOf',
    stateMutability: 'view',
    inputs: [{ name: 'covenantId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'readOutcome',
    stateMutability: 'view',
    inputs: [
      { name: 'covenantId', type: 'bytes32' },
      { name: 'verifierContext', type: 'bytes' },
    ],
    outputs: [
      { name: 'satisfied', type: 'bool' },
      { name: 'stateHash', type: 'bytes32' },
      { name: 'observedValue', type: 'uint256' },
    ],
  },
] as const;

const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export const STATUS_NAMES = [
  'NONE',
  'DRAFT',
  'ARMED',
  'TRIGGERED',
  'EXECUTING',
  'SATISFIED',
  'EXPIRED',
  'CANCELLED',
] as const;

export interface LiveVerification {
  readonly checkedAt: string;
  readonly origins: readonly string[];
  readonly statusName: string;
  readonly satisfied: boolean;
  readonly observedValue: bigint;
  readonly stateHash: string;
  readonly vaultBalance: bigint;
  readonly safeBalance: bigint;
  readonly responderBalance: bigint;
  /** The two origins agreed on the material projection of the success receipt. */
  readonly receiptOriginsAgreed: boolean;
  readonly receipt: RpcReceipt | null | undefined;
  readonly matchesCommittedReceipt: boolean;
}

async function balanceOf(token: string, holder: string): Promise<bigint> {
  const call = await ethCall({
    to: token,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [holder as `0x${string}`],
    }),
  });
  return BigInt(call.value ?? '0x0');
}

export async function verifyLive(): Promise<LiveVerification> {
  const covenantId = RECEIPT.covenant.covenantId as `0x${string}`;

  const [statusCall, outcomeCall, vaultBalance, safeBalance, responderBalance] = await Promise.all([
    ethCall({
      to: RECEIPT.covenant.manager,
      data: encodeFunctionData({ abi: MANAGER_ABI, functionName: 'statusOf', args: [covenantId] }),
    }),
    ethCall({
      to: RECEIPT.covenant.manager,
      data: encodeFunctionData({
        abi: MANAGER_ABI,
        functionName: 'readOutcome',
        args: [covenantId, RECEIPT.covenant.verifierContext as `0x${string}`],
      }),
    }),
    balanceOf(RECEIPT.covenant.feeToken, vaultAddress()),
    balanceOf(RECEIPT.covenant.feeToken, safeAddress()),
    balanceOf(RECEIPT.covenant.feeToken, RECEIPT.covenant.responder),
  ]);

  const status = Number(BigInt(statusCall.value ?? '0x0'));
  const [satisfied, stateHash, observedValue] = decodeAbiParameters(
    [{ type: 'bool' }, { type: 'bytes32' }, { type: 'uint256' }],
    (outcomeCall.value ?? '0x') as `0x${string}`,
  );

  const hash = RECEIPT.successTransaction.hash;
  const receiptQuorum = hash === undefined ? undefined : await getReceipt(hash);

  return {
    checkedAt: new Date().toISOString(),
    origins: [...PUBLIC_RPC_URLS],
    statusName: STATUS_NAMES[status] ?? `UNKNOWN(${status})`,
    satisfied,
    observedValue,
    stateHash,
    vaultBalance,
    safeBalance,
    responderBalance,
    receiptOriginsAgreed: receiptQuorum?.agreed ?? false,
    receipt: receiptQuorum?.value,
    matchesCommittedReceipt:
      String(status) === String(RECEIPT.outcome.terminalStatus) &&
      satisfied === RECEIPT.outcome.satisfied &&
      observedValue.toString() === RECEIPT.outcome.observedValue,
  };
}

/**
 * The vault and the approved recipient are committed inside the verifier context rather than
 * stated separately, which is the point of committing them. Decoding them here means the page
 * reads the same bytes the contract hashes.
 */
export function decodeVerifierContext(): {
  vault: string;
  safe: string;
  token: string;
  safeBaseline: bigint;
  minimumReceived: bigint;
} {
  const [vault, safe, token, safeBaseline, minimumReceived] = decodeAbiParameters(
    [
      { type: 'address' },
      { type: 'address' },
      { type: 'address' },
      { type: 'uint256' },
      { type: 'uint256' },
    ],
    RECEIPT.covenant.verifierContext as `0x${string}`,
  );
  return { vault, safe, token, safeBaseline, minimumReceived };
}

function vaultAddress(): string {
  return decodeVerifierContext().vault;
}

function safeAddress(): string {
  return decodeVerifierContext().safe;
}

export function formatUsd(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${fraction}`;
}

export function shorten(value: string, lead = 10, tail = 8): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

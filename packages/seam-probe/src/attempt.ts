/**
 * Semantic attempt identity for the probe.
 *
 * PRD 12.7 derives a semantic attempt id from covenant id, action index, expected state hash,
 * attempt sequence and request body hash. No covenant exists at Phase 0.5, so the probe uses
 * the same *shape* with the covenant fields replaced by the scenario name and a per-run label.
 * What matters for the seam question is preserved: one semantic attempt is one economic
 * action, a transport retry keeps its id, and a deliberate second economic action gets a new
 * one.
 *
 * The challenge word is derived from the semantic attempt id rather than drawn at random, so
 * every onchain effect this probe produces is attributable to the scenario that produced it,
 * and `eth_getLogs` can count them.
 */

import {
  type ContractCallIdentity,
  canonicalBodyHash,
  canonicalJson,
  deriveIdempotencyKey,
} from '@resurv/keeperhub-client';
import { CANARY_ADDRESS, CANARY_CHAIN_ID } from './fixture.ts';

export const PROBE_NAMESPACE = 'resurv/phase-0.5';

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function semanticAttemptId(scenario: string, runLabel: string): Promise<string> {
  return sha256Hex([PROBE_NAMESPACE, runLabel, scenario].join('|'));
}

/** A bytes32 the probe can search for in chain logs. */
export async function challengeFor(attemptId: string): Promise<string> {
  return `0x${await sha256Hex(`challenge|${attemptId}`)}`;
}

export interface ContractCallBody {
  readonly contractAddress: string;
  readonly chainId: number;
  readonly functionName: string;
  readonly functionArgs: string;
  readonly abi: string;
  readonly value?: string;
  readonly gasLimitMultiplier?: string;
  readonly simulate?: boolean;
}

export interface PreparedCall {
  readonly body: ContractCallBody;
  /** The exact bytes sent. A replay must reproduce this string or KeeperHub answers 409. */
  readonly bodyText: string;
  readonly bodyHash: string;
  readonly idempotencyKey: string;
  readonly identity: ContractCallIdentity;
}

export interface PrepareOptions {
  readonly semanticAttemptId: string;
  readonly functionName: string;
  readonly abi: unknown;
  readonly challenge: string;
  readonly simulate?: boolean;
  readonly gasLimitMultiplier?: string;
  readonly value?: string;
  readonly contractAddress?: string;
}

export async function prepareContractCall(options: PrepareOptions): Promise<PreparedCall> {
  const functionArgs = JSON.stringify([options.challenge]);
  const contractAddress = options.contractAddress ?? CANARY_ADDRESS;

  const body: ContractCallBody = {
    contractAddress,
    chainId: CANARY_CHAIN_ID,
    functionName: options.functionName,
    functionArgs,
    abi: JSON.stringify(options.abi),
    ...(options.value === undefined ? {} : { value: options.value }),
    ...(options.gasLimitMultiplier === undefined
      ? {}
      : { gasLimitMultiplier: options.gasLimitMultiplier }),
    ...(options.simulate === undefined ? {} : { simulate: options.simulate }),
  };

  const identity: ContractCallIdentity = {
    chainId: CANARY_CHAIN_ID,
    contractAddress,
    functionName: options.functionName,
    functionArgs,
    value: options.value ?? '0',
    semanticAttemptId: options.semanticAttemptId,
  };

  return {
    body,
    bodyText: canonicalJson(body),
    bodyHash: await canonicalBodyHash(body),
    idempotencyKey: await deriveIdempotencyKey(identity),
    identity,
  };
}

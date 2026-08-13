/**
 * Turning a contract call into a semantic attempt.
 *
 * Every live write RESURV performs goes through here, deployments included, so there is exactly
 * one place where a canonical body, its hash, an idempotency key and a semantic attempt id are
 * derived. A second derivation path is how a replay stops being byte-identical.
 */

import { getBlockNumber, TARGET_CHAIN_ID } from '@resurv/chain';
import { canonicalBodyHash, canonicalJson, deriveIdempotencyKey } from '@resurv/keeperhub-client';
import type { AttemptPlan, ExpectedEffect } from '@resurv/orchestrator';
import { type Abi, keccak256, toHex } from 'viem';

export interface ContractCallSpec {
  /** Stable label. Two calls with the same label are the same economic action. */
  readonly label: string;
  readonly contractAddress: string;
  readonly functionName: string;
  readonly abi: Abi | readonly unknown[];
  readonly args: readonly unknown[];
  readonly value?: string;
  readonly expectedEffect: ExpectedEffect;
  /** Distinguishes two attempts at the same action against different world states. */
  readonly generation?: string;
}

export interface PreparedCall {
  readonly plan: AttemptPlan;
  readonly body: Record<string, unknown>;
}

/**
 * `functionArgs` and `abi` are JSON-encoded *strings*, not arrays. Measured and documented, and
 * the mistake costs a 400 that reads like a schema problem.
 */
export function contractCallBody(spec: ContractCallSpec): Record<string, unknown> {
  return {
    contractAddress: spec.contractAddress,
    chainId: TARGET_CHAIN_ID,
    functionName: spec.functionName,
    functionArgs: JSON.stringify(spec.args),
    abi: JSON.stringify(spec.abi),
    ...(spec.value === undefined ? {} : { value: spec.value }),
  };
}

export async function prepareCall(spec: ContractCallSpec): Promise<PreparedCall> {
  const body = contractCallBody(spec);
  const bodyText = canonicalJson(body);
  const bodyHash = await canonicalBodyHash(body);

  // The semantic identity of a live write. `generation` is what makes a deliberate second
  // attempt at the same action a different attempt, and its absence what makes a crash-recovery
  // replay the same one.
  const semanticAttemptId = keccak256(
    toHex([spec.label, spec.generation ?? 'g0', bodyHash].join('|')),
  );

  const idempotencyKey = await deriveIdempotencyKey({
    chainId: TARGET_CHAIN_ID,
    contractAddress: spec.contractAddress,
    functionName: spec.functionName,
    functionArgs: JSON.stringify(spec.args),
    value: spec.value ?? '0',
    semanticAttemptId,
  });

  // `fromBlock` anchors every later log search for this attempt, so it has to be a real head.
  // Substituting genesis when the read fails would ask a public node for a range it will refuse,
  // and `getLogs` reports a refusal and an empty result the same way: the reconciler would then
  // read a search failure as proof that nothing landed. Refuse to plan instead.
  const head = await getBlockNumber();
  if (head === undefined) {
    throw new Error(
      `cannot prepare ${spec.label}: no RPC origin returned a block height, so the attempt has no ` +
        'anchor to search from. Retry when an origin is reachable.',
    );
  }

  return {
    body,
    plan: {
      semanticAttemptId,
      covenantId: spec.label,
      actionIndex: 0,
      attemptSequence: 0,
      expectedStateHash: undefined,
      canonicalBody: bodyText,
      canonicalBodyHash: bodyHash,
      idempotencyKey,
      expectedEffect: spec.expectedEffect,
      // One block of slack, so a log search cannot miss an effect that landed in the block the
      // head was read from.
      fromBlock: Math.max(0, head - 1),
    },
  };
}

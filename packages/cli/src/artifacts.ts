/**
 * Compiled contract artifacts, read from `packages/contracts/out`.
 *
 * Read rather than vendored: the bytecode a deployment lands must be the bytecode the tests
 * ran against, and copying it into a second place is how those two drift apart. `foundry.toml`
 * pins `bytecode_hash = "none"` and `cbor_metadata = false`, so the same source compiles to the
 * same bytes on any machine, which is what makes the runtime-bytecode comparison in the proof
 * ladder mean anything.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '@resurv/node-runtime';
import { type Abi, encodeDeployData, keccak256 } from 'viem';

export const ARTIFACT_ROOT = join(REPO_ROOT, 'packages', 'contracts', 'out');
export const CONTRACTS_ROOT = join(REPO_ROOT, 'packages', 'contracts');

/**
 * Rebuild before reading. Call this once before any deployment reads an artifact.
 *
 * `out/` is a cache, and nothing about reading a file tells you which source produced it. This
 * was not a theoretical concern: a mutation campaign restored `ResurvCovenantManager.sol` with a
 * plain file copy and never rebuilt, so `out/` held the artifact compiled from the *last mutant*
 * — a manager with its `maxTotalAttempts` check deleted — and a deployment read it and put it on
 * Base Sepolia. Nothing caught it at the time. The recorded `runtimeBytecodeHash` was the
 * mutant's, so the manifest was self-consistent and wrong, and Sourcify was the only thing that
 * noticed, by refusing to verify that one contract while verifying the other five.
 *
 * `forge build` is incremental, so this costs nothing when the cache is already correct, and it
 * removes an entire class of "the bytes we shipped are not the bytes we tested".
 */
export function rebuildContracts(): void {
  execFileSync('forge', ['build'], { cwd: CONTRACTS_ROOT, stdio: 'inherit' });
}

export interface Artifact {
  readonly name: string;
  readonly abi: Abi;
  readonly bytecode: `0x${string}`;
  readonly runtimeBytecodeHash: `0x${string}`;
}

interface RawArtifact {
  readonly abi: Abi;
  readonly bytecode?: { object?: string };
  readonly deployedBytecode?: { object?: string };
}

export function readArtifact(name: string, file = `${name}.sol`): Artifact {
  const path = join(ARTIFACT_ROOT, file, `${name}.json`);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as RawArtifact;
  const bytecode = raw.bytecode?.object;
  const deployed = raw.deployedBytecode?.object;
  if (bytecode === undefined || !bytecode.startsWith('0x') || bytecode.length <= 2) {
    throw new Error(`artifact ${name} has no creation bytecode; run \`forge build\` first`);
  }
  return {
    name,
    abi: raw.abi,
    bytecode: bytecode as `0x${string}`,
    runtimeBytecodeHash: keccak256((deployed ?? '0x') as `0x${string}`),
  };
}

/** Creation bytecode with constructor arguments appended, which is what CREATE2 takes. */
export function initCodeFor(artifact: Artifact, args: readonly unknown[]): `0x${string}` {
  return encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    // viem types constructor args against the ABI; the caller supplies them positionally and
    // the ABI is read at runtime, so this is the one place the two meet.
    args: args as never,
  });
}

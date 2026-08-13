import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '@resurv/node-runtime';
import { keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';
import { initCodeFor, readArtifact } from '../src/artifacts.ts';

/**
 * The deployment manifest against a fresh build of the current source.
 *
 * This test exists because the alternative was measured. A deployment once read a stale artifact
 * cache and put a *mutant* `ResurvCovenantManager` on Base Sepolia: a mutation campaign had
 * restored the source file with a plain copy and never rebuilt, so `packages/contracts/out` still
 * held the build with the `maxTotalAttempts` check deleted.
 *
 * Every check RESURV performed on itself passed. All six predicted addresses matched, because the
 * prediction is derived from the same init code that was deployed. The manifest's recorded
 * bytecode hashes matched, because they were recorded from that same artifact. The whole
 * apparatus was internally consistent and wrong, and it was wrong in the one direction that
 * matters: the bytes on chain were not the bytes the tests ran against.
 *
 * The only thing that disagreed was an independent recompilation — Sourcify's, which refused to
 * verify that one contract while verifying the other five. This test is that same disagreement,
 * available offline and on every run, so the next occurrence fails in the gate rather than on a
 * public explorer.
 *
 * It needs no network. `deployments/base-sepolia.json` records what was deployed; `out/` holds
 * what the current source compiles to. Those two must agree or a claim in `docs/CLAIMS.md` is
 * false.
 */

interface Manifest {
  readonly gitCommit: string | undefined;
  readonly contracts: Record<
    string,
    {
      readonly address: string;
      readonly initCodeHash: string;
      readonly runtimeBytecodeHash: string;
      readonly constructorArgs: readonly string[];
      readonly predictedAddressMatched: boolean;
    }
  >;
}

const SOURCE_FILE: Record<string, string> = {
  TestUSD: 'TestUSD.sol',
  ResurvCovenantManager: 'ResurvCovenantManager.sol',
  PauseAction: 'PauseAction.sol',
  EvacuateERC20Action: 'EvacuateERC20Action.sol',
  VaultSafeStateVerifier: 'VaultSafeStateVerifier.sol',
  DemoVault: 'DemoVault.sol',
};

const manifest = JSON.parse(
  readFileSync(join(REPO_ROOT, 'deployments', 'base-sepolia.json'), 'utf8'),
) as Manifest;

/** `["0xabc", "0xdef"]` as the manifest records an address-array argument. */
function parseArg(described: string): unknown {
  const trimmed = described.trim();
  if (!trimmed.startsWith('[')) return trimmed;
  const inner = trimmed.slice(1, -1).trim();
  return inner === '' ? [] : inner.split(',').map((part) => part.trim());
}

describe('every deployed contract was built from the source in this repository', () => {
  const names = Object.keys(manifest.contracts);

  it('records all six contracts', () => {
    expect(names).toHaveLength(6);
  });

  it.each(names)('%s: deployed runtime bytecode recompiles from source', (name) => {
    // #given the artifact the current source compiles to
    const file = SOURCE_FILE[name];
    expect(file, `no source file mapped for ${name}`).toBeDefined();
    const artifact = readArtifact(name, file as string);

    // #then it is the one the deployment recorded
    expect(
      artifact.runtimeBytecodeHash.toLowerCase(),
      `${name}: the deployed runtime bytecode does not recompile from this source. Either the ` +
        'source changed after deployment, or the deployment read a stale artifact cache.',
    ).toBe(manifest.contracts[name]?.runtimeBytecodeHash.toLowerCase());
  });

  it.each(names)(
    '%s: deployed init code recompiles from source and its recorded arguments',
    (n) => {
      // #given
      const record = manifest.contracts[n];
      expect(record).toBeDefined();
      const artifact = readArtifact(n, SOURCE_FILE[n] as string);

      // #when the init code is rebuilt from the current artifact and the recorded arguments
      const initCode = initCodeFor(artifact, (record?.constructorArgs ?? []).map(parseArg));

      // #then it hashes to what CREATE2 was actually given
      expect(keccak256(initCode).toLowerCase(), `${n}: init code does not reproduce`).toBe(
        record?.initCodeHash.toLowerCase(),
      );
    },
  );

  it('predicted every address before sending, and every prediction matched', () => {
    // #then a deployment that only read the address back could not tell success from collision
    for (const name of names) {
      expect(manifest.contracts[name]?.predictedAddressMatched, name).toBe(true);
    }
  });
});

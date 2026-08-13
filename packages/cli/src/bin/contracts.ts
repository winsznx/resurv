/**
 * Land the RESURV contracts on Base Sepolia.
 *
 * An external-effect command. It spends the KeeperHub organization credential and produces real
 * transactions, so it is reachable from no auto-approved Claude Code command, exactly like the
 * seam probe. `packages/repo-policy` fails if anyone allow-lists a path to it.
 *
 *   pnpm --filter @resurv/cli live:contracts
 *
 * Every write goes through the same orchestrator every covenant attempt uses: the idempotency
 * key is durably journalled before the request leaves, and the outcome is settled by reading the
 * chain rather than by reading an HTTP status. Re-running after a crash resumes rather than
 * redeploys.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CREATEX_ADDRESS, explorerAddressUrl, explorerTxUrl, TARGET_CHAIN_ID } from '@resurv/chain';
import { readWalletAddress } from '@resurv/keeperhub-client';
import { REPO_ROOT } from '@resurv/node-runtime';
import { executeSemanticAttempt } from '@resurv/orchestrator';
import { keccak256, toHex } from 'viem';
import { initCodeFor, readArtifact, rebuildContracts } from '../artifacts.ts';
import { prepareCall } from '../call.ts';
import {
  addressFromCreationLog,
  CONTRACT_CREATION_TOPIC,
  CREATEX_DEPLOY_CREATE2_ABI,
  predictAddress,
  saltFor,
} from '../createx.ts';
import {
  type DeployedContract,
  type DeploymentManifest,
  readManifest,
  writeManifest,
} from '../deployments.ts';
import { fail, liveRuntime, step } from '../runtime.ts';

const ONE_TEST_DOLLAR = 1_000_000n;

function gitCommit(): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

function foundryProfile(): { solc: string; evm: string; runs: number } {
  const toml = readFileSync(join(REPO_ROOT, 'packages', 'contracts', 'foundry.toml'), 'utf8');
  const solc = /^solc\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? 'unknown';
  const evm = /^evm_version\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? 'unknown';
  const runs = Number(/^optimizer_runs\s*=\s*(\d+)/m.exec(toml)?.[1] ?? '0');
  return { solc, evm, runs };
}

async function main(): Promise<void> {
  // `--dry-run` reads the organization wallet, computes every predicted address, and sends no
  // write. It is how the deployment is reviewed before it is performed, and how this file is
  // exercised without spending anything.
  const dryRun = process.argv.includes('--dry-run');
  const runtime = liveRuntime(dryRun ? 'deploy-dry-run' : 'deploy');
  if (dryRun) step('dry run: no write will be sent');

  // Compile before reading anything out of `out/`. See `rebuildContracts`: a deployment once
  // shipped a mutant because the artifact cache outlived the source that produced it.
  step('building contracts from source');
  rebuildContracts();
  step(`credential ${runtime.credentialFingerprint}`);
  step(`journal ${runtime.store.path}`);

  const user = await runtime.keeperhub.user();
  const walletOrUndefined = readWalletAddress(user.body);
  if (walletOrUndefined === undefined) {
    throw new Error(
      `could not read the organization wallet from GET /api/user (HTTP ${user.httpStatus ?? 'none'})`,
    );
  }
  const orgWallet: string = walletOrUndefined;
  step(`organization wallet ${orgWallet}`);
  step('this address is msg.sender at every RESURV contract under sponsorship');

  const existing = readManifest();
  const contracts: Record<string, DeployedContract> = { ...(existing?.contracts ?? {}) };
  const configurationCalls = [...(existing?.configurationCalls ?? [])];

  /** Deploy one contract through CreateX, or return the one already recorded. */
  async function deploy(
    name: string,
    file: string,
    args: readonly unknown[],
    describedArgs: readonly string[],
  ): Promise<string> {
    const recorded = contracts[name];
    if (recorded !== undefined) {
      step(`${name}: already deployed at ${recorded.address}`);
      return recorded.address;
    }

    const artifact = readArtifact(name, file);
    const initCode = initCodeFor(artifact, args);
    const salt = saltFor(name);
    const predicted = predictAddress(salt, initCode, orgWallet);
    step(`${name}: predicted ${predicted} (init code ${initCode.length / 2 - 1} bytes)`);
    if (dryRun) return predicted;

    const prepared = await prepareCall({
      label: `deploy/${name}`,
      contractAddress: CREATEX_ADDRESS,
      functionName: 'deployCreate2',
      abi: CREATEX_DEPLOY_CREATE2_ABI,
      args: [salt, initCode],
      expectedEffect: {
        address: CREATEX_ADDRESS,
        topics: [CONTRACT_CREATION_TOPIC],
        matches: (log) => {
          const reported = addressFromCreationLog({ ...log, address: CREATEX_ADDRESS });
          return reported !== undefined && reported.toLowerCase() === predicted.toLowerCase();
        },
      },
    });

    const outcome = await executeSemanticAttempt(prepared.plan, {
      store: runtime.store,
      keeperhub: runtime.keeperhub,
      log: (message) => step(`  ${name}: ${message}`),
    });

    if (outcome.state !== 'CONFIRMED') {
      throw new Error(
        `${name} did not confirm: ${outcome.state}. ${outcome.reason}. ` +
          `execution ${outcome.executionId ?? 'none'}, transaction ${outcome.transactionHash ?? 'none'}`,
      );
    }

    const creationLog = (outcome.receipt?.logs ?? []).find(
      (entry) => addressFromCreationLog(entry) !== undefined,
    );
    const reported = creationLog === undefined ? undefined : addressFromCreationLog(creationLog);
    if (reported === undefined) {
      throw new Error(`${name} confirmed but CreateX emitted no ContractCreation event`);
    }

    // The address CreateX reported is the truth and is what gets recorded. A mismatch against
    // the offchain prediction means the salt guard in ADR-014 is wrong, which is worth shouting
    // about and is not worth stranding a deployed contract over: throwing here would leave a
    // live contract that the manifest never learned about.
    const matched = reported.toLowerCase() === predicted.toLowerCase();
    if (!matched) {
      step(
        `  ${name}: WARNING landed at ${reported}, predicted ${predicted}; ADR-014's salt guard is wrong`,
      );
    }

    contracts[name] = {
      name,
      address: reported,
      salt,
      initCodeHash: keccak256(initCode),
      runtimeBytecodeHash: artifact.runtimeBytecodeHash,
      constructorArgs: describedArgs,
      transactionHash: outcome.transactionHash ?? '',
      keeperhubExecutionId: outcome.executionId,
      blockNumber: outcome.receipt?.blockNumber,
      predictedAddressMatched: matched,
    };
    step(`${name}: ${reported}  ${explorerAddressUrl(reported)}`);
    step(`  tx ${explorerTxUrl(outcome.transactionHash ?? '')}`);
    return reported;
  }

  /** A post-deployment configuration write, through the same lifecycle. */
  async function configure(
    label: string,
    contractAddress: string,
    functionName: string,
    abi: readonly unknown[],
    args: readonly unknown[],
    expectedTopic: string,
  ): Promise<void> {
    if (configurationCalls.some((call) => call.label === label)) {
      step(`${label}: already applied`);
      return;
    }
    if (dryRun) {
      step(`${label}: would call ${functionName} on ${contractAddress}`);
      return;
    }
    const prepared = await prepareCall({
      label,
      contractAddress,
      functionName,
      abi,
      args,
      expectedEffect: { address: contractAddress, topics: [expectedTopic] },
    });
    const outcome = await executeSemanticAttempt(prepared.plan, {
      store: runtime.store,
      keeperhub: runtime.keeperhub,
      log: (message) => step(`  ${label}: ${message}`),
    });
    if (outcome.state !== 'CONFIRMED') {
      throw new Error(`${label} did not confirm: ${outcome.state}. ${outcome.reason}`);
    }
    configurationCalls.push({
      label,
      transactionHash: outcome.transactionHash ?? '',
      executionId: outcome.executionId,
    });
    step(`${label}: ${explorerTxUrl(outcome.transactionHash ?? '')}`);
  }

  const token = await deploy('TestUSD', 'TestUSD.sol', [], []);
  const manager = await deploy(
    'ResurvCovenantManager',
    'ResurvCovenantManager.sol',
    [orgWallet, orgWallet, orgWallet, [token]],
    [orgWallet, orgWallet, orgWallet, `[${token}]`],
  );
  const pauseAction = await deploy('PauseAction', 'PauseAction.sol', [manager], [manager]);
  const evacuateAction = await deploy(
    'EvacuateERC20Action',
    'EvacuateERC20Action.sol',
    [manager],
    [manager],
  );
  await deploy('VaultSafeStateVerifier', 'VaultSafeStateVerifier.sol', [], []);
  const vault = await deploy('DemoVault', 'DemoVault.sol', [orgWallet], [orgWallet]);

  // Grant each adapter exactly the one vault role its capability needs. PRD 20.3: narrow
  // authority to an adapter, never broad authority to an agent EOA.
  const vaultAbi = readArtifact('DemoVault', 'DemoVault.sol').abi;
  const roleGranted = keccak256(toHex('RoleGranted(bytes32,address,address)'));
  await configure(
    'grant/pauser',
    vault,
    'grantRole',
    vaultAbi,
    [keccak256(toHex('DEMO_VAULT_PAUSER_ROLE')), pauseAction],
    roleGranted,
  );
  await configure(
    'grant/rescuer',
    vault,
    'grantRole',
    vaultAbi,
    [keccak256(toHex('DEMO_VAULT_RESCUER_ROLE')), evacuateAction],
    roleGranted,
  );

  const tokenAbi = readArtifact('TestUSD', 'TestUSD.sol').abi;
  const transferTopic = keccak256(toHex('Transfer(address,address,uint256)'));
  await configure(
    'mint/vault',
    token,
    'mint',
    tokenAbi,
    [vault, ONE_TEST_DOLLAR.toString()],
    transferTopic,
  );

  if (dryRun) {
    step('dry run complete: nothing was sent');
    return;
  }

  const profile = foundryProfile();
  const manifest: DeploymentManifest = {
    chainId: TARGET_CHAIN_ID,
    chainName: 'Base Sepolia',
    deployedAt: new Date().toISOString(),
    factory: CREATEX_ADDRESS,
    deployerOrgWallet: orgWallet,
    solcVersion: profile.solc,
    evmVersion: profile.evm,
    optimizer: { enabled: true, runs: profile.runs },
    gitCommit: gitCommit(),
    contracts,
    configurationCalls,
  };
  const path = writeManifest(manifest);
  step(`manifest written to ${path}`);
  step(`${runtime.exchanges.length} KeeperHub exchanges recorded`);
}

main().catch(fail);

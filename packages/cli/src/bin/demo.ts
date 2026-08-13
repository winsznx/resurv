/**
 * The canonical live covenant, end to end, on Base Sepolia.
 *
 * An external-effect command. It spends the KeeperHub organization credential and lands real
 * transactions, so it is reachable from no auto-approved Claude Code command.
 *
 *   pnpm --filter @resurv/cli live:demo             run it
 *   pnpm --filter @resurv/cli live:demo --dry-run   simulate every step, broadcast nothing
 *
 * The story it tells, in the order it tells it:
 *
 *   a covenant is created and funded, committing a verifier and two ordered recovery actions
 *   a signed risk trigger arms it for execution
 *   the primary action, pause, is refused by simulation because its role was revoked
 *   RESURV does not guess: it moves to the next committed action, and only to that one
 *   the fallback evacuates the vault, the verifier returns true, and the fee is released,
 *     all inside one transaction that would have reverted whole had the outcome been false
 *   the same trigger and the same attempt are replayed, and neither produces a second effect
 *
 * The trigger authority is an ephemeral key generated in this process and never written down.
 * That is the honest shape: the authority to declare an incident belongs to the requester, and
 * RESURV never holds it. Its signature is recorded so the replay can be reproduced by anyone.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ethCall,
  explorerAddressUrl,
  explorerTxUrl,
  getReceipt,
  TARGET_CHAIN_ID,
} from '@resurv/chain';
import {
  type KeeperhubExchange,
  readFailureKind,
  readRevertReason,
  readWalletAddress,
  readWouldRevert,
} from '@resurv/keeperhub-client';
import { REPO_ROOT } from '@resurv/node-runtime';
import { executeSemanticAttempt } from '@resurv/orchestrator';
import {
  type Abi,
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  toHex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { readArtifact } from '../artifacts.ts';
import { type ContractCallSpec, contractCallBody, prepareCall } from '../call.ts';
import {
  ACTION_EVACUATE,
  ACTION_PAUSE,
  APPROVED_SAFE,
  COVENANT_DURATION_SECONDS,
  ONE_TEST_DOLLAR,
  RESPONDER,
  SIGNAL_WINDOW_SECONDS,
} from '../demo-config.ts';
import { readManifest } from '../deployments.ts';
import { openRunState } from '../run-state.ts';
import { fail, liveRuntime, step } from '../runtime.ts';

const PROOF_DIR = join(REPO_ROOT, 'docs', 'proof');

const TOPIC = {
  covenantCreated: keccak256(
    toHex(
      'CovenantCreated(bytes32,address,address,address,address,address,uint256,uint64,uint16,bytes32,bytes)',
    ),
  ),
  covenantArmed: keccak256(toHex('CovenantArmed(bytes32)')),
  covenantTriggered: keccak256(toHex('CovenantTriggered(bytes32,bytes32,uint32)')),
  attemptSucceeded: keccak256(toHex('AttemptSucceeded(bytes32,bytes32,uint256,bytes32)')),
  covenantSatisfied: keccak256(toHex('CovenantSatisfied(bytes32,bytes32,uint256,address,uint256)')),
  roleRevoked: keccak256(toHex('RoleRevoked(bytes32,address,address)')),
  transfer: keccak256(toHex('Transfer(address,address,uint256)')),
} as const;

interface StepRecord {
  readonly label: string;
  readonly state: string;
  readonly transactionHash: string | undefined;
  readonly executionId: string | undefined;
  readonly explorer: string | undefined;
  readonly note: string;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const runtime = liveRuntime(dryRun ? 'demo-dry-run' : 'demo');
  const manifest = readManifest();
  if (manifest === undefined) {
    throw new Error('no deployment manifest; run `pnpm --filter @resurv/cli live:contracts` first');
  }

  const user = await runtime.keeperhub.user();
  const wallet = readWalletAddress(user.body);
  if (wallet === undefined) throw new Error('could not read the organization wallet');
  const requester: string = wallet;

  const manager = manifest.contracts['ResurvCovenantManager']?.address ?? '';
  const vault = manifest.contracts['DemoVault']?.address ?? '';
  const token = manifest.contracts['TestUSD']?.address ?? '';
  const verifier = manifest.contracts['VaultSafeStateVerifier']?.address ?? '';
  const pauseAction = manifest.contracts['PauseAction']?.address ?? '';
  const evacuateAction = manifest.contracts['EvacuateERC20Action']?.address ?? '';
  if ([manager, vault, token, verifier, pauseAction, evacuateAction].some((a) => a === '')) {
    throw new Error('deployment manifest is incomplete');
  }

  const managerAbi = readArtifact('ResurvCovenantManager', 'ResurvCovenantManager.sol').abi;
  const vaultAbi = readArtifact('DemoVault', 'DemoVault.sol').abi;
  const tokenAbi = readArtifact('TestUSD', 'TestUSD.sol').abi;

  step(`manager   ${explorerAddressUrl(manager)}`);
  step(`vault     ${explorerAddressUrl(vault)}`);
  step(`requester ${requester} (KeeperHub organization wallet)`);
  if (dryRun) step('dry run: every step is simulated and nothing is broadcast');

  // ---------------------------------------------------------------------------------------
  // The committed shapes. Every one of these is hashed into the covenant before it is armed.
  // ---------------------------------------------------------------------------------------
  const verifierContext = encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'address' },
      { type: 'address' },
      { type: 'uint256' },
      { type: 'uint256' },
    ],
    [vault as `0x${string}`, APPROVED_SAFE, token as `0x${string}`, 0n, ONE_TEST_DOLLAR],
  );
  const pauseConfig = encodeAbiParameters([{ type: 'address' }], [vault as `0x${string}`]);
  // The bound is a range, not an equality. `TestUSD.mint` is permissionless, which is what let a
  // zero-balance wallet fund the first demo at all, and it means anyone can add a unit to the
  // vault for the cost of gas. With `min == max` that one unit puts the evacuation permanently
  // outside its committed bounds and bricks the covenant with no role and no privilege. The
  // minimum is what the covenant actually promises to deliver; the maximum only has to bound the
  // adapter's authority, so it is generous.
  const evacuateConfig = encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'address' },
      { type: 'address' },
      { type: 'uint256' },
      { type: 'uint256' },
    ],
    [
      vault as `0x${string}`,
      token as `0x${string}`,
      APPROVED_SAFE,
      ONE_TEST_DOLLAR,
      ONE_TEST_DOLLAR * 1_000n,
    ],
  );

  // The run label is durable, because every semantic attempt id in this run is derived from it.
  // A restart that minted a fresh label would mint a fresh idempotency namespace, and the
  // crash-recovery guarantee the orchestrator spends real effort providing would be defeated at
  // its only caller. `--resume` reuses the recorded run; the default starts a new covenant,
  // which is the right default because a covenant is a one-shot object.
  const runState = openRunState(dryRun);
  const runLabel = runState.runLabel;
  step(`run ${runLabel}${runState.resumed ? ' (resumed)' : ''}`);
  const covenantSalt = keccak256(toHex(`resurv/demo/${dryRun ? 'dry' : runLabel}`));
  const covenantId = keccak256(
    encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'bytes32' }],
      [BigInt(TARGET_CHAIN_ID), manager as `0x${string}`, requester as `0x${string}`, covenantSalt],
    ),
  );
  step(`covenant  ${covenantId}`);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + COVENANT_DURATION_SECONDS);
  const steps: StepRecord[] = [];

  /**
   * The semantic identity of one action, written exactly once.
   *
   * Simulation and execution are two questions about a single action, and the only difference
   * between their bodies must be the `simulate` flag the client adds. Every call site below
   * builds one of these and hands it to both, so there is no second literal to drift: a caller
   * who repeats the target, the selector and the args by hand for the simulate request is one
   * typo away from simulating one call and broadcasting another, and no KeeperHub response would
   * say so. `packages/cli/test/call.test.ts` pins the byte equality this arrangement produces.
   */
  function specFor(
    label: string,
    contractAddress: string,
    functionName: string,
    abi: Abi,
    args: readonly unknown[],
    expectedTopic: string,
  ): ContractCallSpec {
    return {
      label: `demo/${runLabel}/${label}`,
      contractAddress,
      functionName,
      abi,
      args,
      expectedEffect: { address: contractAddress, topics: [expectedTopic] },
    };
  }

  /** Simulate an action and record what came back. Nothing is broadcast on this path. */
  async function simulateOnly(spec: ContractCallSpec): Promise<KeeperhubExchange> {
    return runtime.keeperhub.simulate(contractCallBody(spec) as never);
  }

  /** One live write, through the full measured lifecycle. */
  async function send(
    label: string,
    spec: ContractCallSpec,
  ): Promise<{ transactionHash: string | undefined; executionId: string | undefined }> {
    const prepared = await prepareCall(spec);

    if (dryRun) {
      const simulation = await simulateOnly(spec);
      const wouldRevert = readWouldRevert(simulation.body);
      step(`${label}: simulate -> HTTP ${simulation.httpStatus} wouldRevert=${wouldRevert}`);
      if (wouldRevert === true) {
        step(`  reason: ${readRevertReason(simulation.body)?.slice(0, 200) ?? 'none given'}`);
      }
      steps.push({
        label,
        state: wouldRevert === false ? 'SIMULATED_OK' : 'SIMULATION_REJECTED',
        transactionHash: undefined,
        executionId: undefined,
        explorer: undefined,
        note: `dry run, HTTP ${simulation.httpStatus}`,
      });
      return { transactionHash: undefined, executionId: undefined };
    }

    const outcome = await executeSemanticAttempt(prepared.plan, {
      store: runtime.store,
      keeperhub: runtime.keeperhub,
      log: (message) => step(`  ${label}: ${message}`),
    });
    steps.push({
      label,
      state: outcome.state,
      transactionHash: outcome.transactionHash,
      executionId: outcome.executionId,
      explorer:
        outcome.transactionHash === undefined ? undefined : explorerTxUrl(outcome.transactionHash),
      note: outcome.reason,
    });
    if (outcome.state !== 'CONFIRMED') {
      throw new Error(`${label} did not confirm: ${outcome.state}. ${outcome.reason}`);
    }
    step(`${label}: ${explorerTxUrl(outcome.transactionHash ?? '')}`);
    return { transactionHash: outcome.transactionHash, executionId: outcome.executionId };
  }

  // ---------------------------------------------------------------------------------------
  // 1. The incident that has not happened yet: the primary emergency lever is quietly broken.
  // ---------------------------------------------------------------------------------------
  step('--- setup: revoking the vault role the primary action depends on');
  await send(
    'revoke-pauser',
    specFor(
      'revoke-pauser',
      vault,
      'revokeRole',
      vaultAbi,
      [keccak256(toHex('DEMO_VAULT_PAUSER_ROLE')), pauseAction],
      TOPIC.roleRevoked,
    ),
  );

  // ---------------------------------------------------------------------------------------
  // 2. Fund the requester and let the covenant escrow the fee.
  // ---------------------------------------------------------------------------------------
  step('--- covenant: mint the success fee, approve the escrow, create, fund and arm');
  await send(
    'mint-fee',
    specFor(
      'mint-fee',
      token,
      'mint',
      tokenAbi,
      [requester, ONE_TEST_DOLLAR.toString()],
      TOPIC.transfer,
    ),
  );
  await send(
    'approve-escrow',
    specFor(
      'approve-escrow',
      token,
      'approve',
      tokenAbi,
      [manager, ONE_TEST_DOLLAR.toString()],
      keccak256(toHex('Approval(address,address,uint256)')),
    ),
  );

  // The trigger authority exists only in this process. Its private key is never written to
  // disk, never logged, and is discarded when the run ends.
  const triggerAccount = privateKeyToAccount(generatePrivateKey());
  step(`trigger authority ${triggerAccount.address} (ephemeral, key held only in memory)`);

  // Pre-encoded, because KeeperHub's request encoder was measured rejecting a struct argument
  // with `Failed to encode call: invalid address`. Two `bytes` arguments are expressible in the
  // JSON body; a nested tuple is not. `createCovenantEncoded` decodes into the same structs and
  // runs the same validation. See ADR-015.
  const encodedParams = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'triggerAuthority', type: 'address' },
          { name: 'responder', type: 'address' },
          { name: 'verifier', type: 'address' },
          { name: 'feeToken', type: 'address' },
          { name: 'feeAmount', type: 'uint128' },
          { name: 'deadline', type: 'uint64' },
          { name: 'maxTotalAttempts', type: 'uint16' },
          { name: 'verifierContext', type: 'bytes' },
          { name: 'salt', type: 'bytes32' },
        ],
      },
    ],
    [
      {
        triggerAuthority: triggerAccount.address,
        responder: RESPONDER,
        verifier: verifier as `0x${string}`,
        feeToken: token as `0x${string}`,
        feeAmount: ONE_TEST_DOLLAR,
        deadline,
        maxTotalAttempts: 4,
        verifierContext,
        salt: covenantSalt,
      },
    ],
  );
  const encodedActions = encodeAbiParameters(
    [
      {
        type: 'tuple[]',
        components: [
          { name: 'adapter', type: 'address' },
          { name: 'config', type: 'bytes' },
          { name: 'maxAttempts', type: 'uint16' },
        ],
      },
    ],
    [
      [
        { adapter: pauseAction as `0x${string}`, config: pauseConfig, maxAttempts: 2 },
        { adapter: evacuateAction as `0x${string}`, config: evacuateConfig, maxAttempts: 2 },
      ],
    ],
  );

  await send(
    'covenant-create',
    specFor(
      'covenant-create',
      manager,
      'createCovenantEncoded',
      managerAbi,
      [encodedParams, encodedActions],
      TOPIC.covenantCreated,
    ),
  );
  await send(
    'covenant-arm',
    specFor('covenant-arm', manager, 'fundAndArm', managerAbi, [covenantId], TOPIC.covenantArmed),
  );

  // ---------------------------------------------------------------------------------------
  // 3. The incident. A signed risk trigger, relayed by anyone, authored only by the authority.
  // ---------------------------------------------------------------------------------------
  step('--- trigger: a signed risk signal moves the covenant to TRIGGERED');
  // Signed once and written down, so a resumed run replays the identical trigger body rather
  // than authoring a second one with a new window. The private key is never persisted.
  if (runState.trigger === undefined) {
    const validAfter = BigInt(Math.floor(Date.now() / 1000) - 60);
    const validUntil = validAfter + BigInt(SIGNAL_WINDOW_SECONDS);
    const signalHash = keccak256(toHex(`vault-drain-alert/${runLabel}`));
    const signature = await triggerAccount.signTypedData({
      domain: {
        name: 'RESURV',
        version: '1',
        chainId: TARGET_CHAIN_ID,
        verifyingContract: manager as `0x${string}`,
      },
      types: {
        TriggerSignal: [
          { name: 'covenantId', type: 'bytes32' },
          { name: 'signalHash', type: 'bytes32' },
          { name: 'nonce', type: 'uint32' },
          { name: 'validAfter', type: 'uint64' },
          { name: 'validUntil', type: 'uint64' },
        ],
      },
      primaryType: 'TriggerSignal',
      message: { covenantId, signalHash, nonce: 0, validAfter, validUntil },
    });
    runState.trigger = {
      signalHash,
      nonce: 0,
      validAfter: validAfter.toString(),
      validUntil: validUntil.toString(),
      signature,
      authority: triggerAccount.address,
    };
    runState.save();
  }
  const trigger = runState.trigger;
  const signalHash = trigger.signalHash as `0x${string}`;
  const validAfter = BigInt(trigger.validAfter);
  const validUntil = BigInt(trigger.validUntil);
  const signature = trigger.signature;

  const triggerArgs = [
    covenantId,
    signalHash,
    String(trigger.nonce),
    trigger.validAfter,
    trigger.validUntil,
    signature,
  ];
  await send(
    'trigger',
    specFor('trigger', manager, 'trigger', managerAbi, triggerArgs, TOPIC.covenantTriggered),
  );

  // ---------------------------------------------------------------------------------------
  // 4. The primary action. Simulated, refused, and never broadcast.
  // ---------------------------------------------------------------------------------------
  step('--- attempt 1: the primary action, simulated before anything is sent');
  const primarySpec = specFor(
    'attempt-primary',
    manager,
    'executeAttempt',
    managerAbi,
    [covenantId, String(ACTION_PAUSE), pauseConfig, verifierContext, `0x${'0'.repeat(64)}`, '0'],
    TOPIC.attemptSucceeded,
  );
  const primarySimulation = await simulateOnly(primarySpec);
  const primaryWouldRevert = readWouldRevert(primarySimulation.body);
  step(
    `primary simulation: HTTP ${primarySimulation.httpStatus} wouldRevert=${primaryWouldRevert} failureKind=${readFailureKind(primarySimulation.body) ?? 'none'}`,
  );
  steps.push({
    label: 'attempt-primary',
    state: primaryWouldRevert === true ? 'SIMULATION_REJECTED' : 'SIMULATED_OK',
    transactionHash: undefined,
    executionId: undefined,
    explorer: undefined,
    note: `HTTP ${primarySimulation.httpStatus}; ${readRevertReason(primarySimulation.body)?.slice(0, 300) ?? 'no reason given'}`,
  });
  if (primaryWouldRevert !== true) {
    throw new Error(
      'the primary action was expected to be refused by simulation and was not; the demo premise is broken',
    );
  }
  step('primary refused. No transaction was sent, so nothing on chain moved.');

  // ---------------------------------------------------------------------------------------
  // 5. The fallback. Simulated, then executed, and the whole outcome settles in that one call.
  // ---------------------------------------------------------------------------------------
  step('--- attempt 2: the approved fallback');
  const fallbackArgs = [
    covenantId,
    String(ACTION_EVACUATE),
    evacuateConfig,
    verifierContext,
    `0x${'0'.repeat(64)}`,
    '1',
  ];
  const fallbackSpec = specFor(
    'attempt-fallback',
    manager,
    'executeAttempt',
    managerAbi,
    fallbackArgs,
    TOPIC.attemptSucceeded,
  );
  const fallbackSimulation = await simulateOnly(fallbackSpec);
  step(
    `fallback simulation: HTTP ${fallbackSimulation.httpStatus} wouldRevert=${readWouldRevert(fallbackSimulation.body)}`,
  );
  if (readWouldRevert(fallbackSimulation.body) !== false) {
    throw new Error(
      `the fallback was refused by simulation: ${readRevertReason(fallbackSimulation.body) ?? 'no reason'}`,
    );
  }

  // The same spec object that was just simulated. Not an equivalent one: the same one.
  const attempt = await send('attempt-fallback', fallbackSpec);

  // ---------------------------------------------------------------------------------------
  // 6. Duplicate protection, proven rather than asserted.
  // ---------------------------------------------------------------------------------------
  step('--- replay: the same trigger and the same attempt, again');
  const replayTrigger = await simulateOnly(
    specFor('replay-trigger', manager, 'trigger', managerAbi, triggerArgs, TOPIC.covenantTriggered),
  );
  step(
    `replayed trigger: HTTP ${replayTrigger.httpStatus} wouldRevert=${readWouldRevert(replayTrigger.body)}`,
  );
  // Byte-identical to the attempt that already ran, which is the point of the replay.
  const replayAttempt = await simulateOnly(fallbackSpec);
  step(
    `replayed attempt: HTTP ${replayAttempt.httpStatus} wouldRevert=${readWouldRevert(replayAttempt.body)}`,
  );
  steps.push({
    label: 'replay-trigger',
    state: readWouldRevert(replayTrigger.body) === true ? 'REJECTED' : 'UNEXPECTEDLY_ACCEPTED',
    transactionHash: undefined,
    executionId: undefined,
    explorer: undefined,
    note: readRevertReason(replayTrigger.body)?.slice(0, 200) ?? '',
  });
  steps.push({
    label: 'replay-attempt',
    state: readWouldRevert(replayAttempt.body) === true ? 'REJECTED' : 'UNEXPECTEDLY_ACCEPTED',
    transactionHash: undefined,
    executionId: undefined,
    explorer: undefined,
    note: readRevertReason(replayAttempt.body)?.slice(0, 200) ?? '',
  });

  // ---------------------------------------------------------------------------------------
  // 7. Read the world back from chain, not from anything KeeperHub said.
  // ---------------------------------------------------------------------------------------
  step('--- verification: reading the final state from two independent RPC origins');
  const statusCall = await ethCall({
    to: manager,
    data: encodeFunctionData({ abi: managerAbi, functionName: 'statusOf', args: [covenantId] }),
  });
  const status = Number(BigInt(statusCall.value ?? '0x0'));
  const outcomeCall = await ethCall({
    to: manager,
    data: encodeFunctionData({
      abi: managerAbi,
      functionName: 'readOutcome',
      args: [covenantId, verifierContext],
    }),
  });
  const [satisfied, stateHash, observedValue] = decodeAbiParameters(
    [{ type: 'bool' }, { type: 'bytes32' }, { type: 'uint256' }],
    (outcomeCall.value ?? '0x') as `0x${string}`,
  );

  const vaultBalance = await readBalance(token, vault, tokenAbi);
  const safeBalance = await readBalance(token, APPROVED_SAFE, tokenAbi);
  const responderBalance = await readBalance(token, RESPONDER, tokenAbi);

  const receipt =
    attempt.transactionHash === undefined
      ? undefined
      : (await getReceipt(attempt.transactionHash)).value;

  step(`covenant status  ${status} (5 = SATISFIED)`);
  step(`verifier says    satisfied=${satisfied} observed=${observedValue}`);
  step(`vault balance    ${vaultBalance}`);
  step(`safe balance     ${safeBalance}`);
  step(`responder paid   ${responderBalance}`);

  const receiptPath = join(PROOF_DIR, 'canonical-covenant.json');
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(
    receiptPath,
    `${JSON.stringify(
      {
        schema: 'resurv.outcome-receipt.v1',
        generatedAt: new Date().toISOString(),
        chain: { chainId: TARGET_CHAIN_ID, name: 'Base Sepolia' },
        covenant: {
          manager,
          covenantId,
          requester,
          responder: RESPONDER,
          triggerAuthority: triggerAccount.address,
          deadline: deadline.toString(),
          verifier,
          verifierContext,
          verifierContextHash: keccak256(verifierContext),
          feeToken: token,
          feeAmount: ONE_TEST_DOLLAR.toString(),
        },
        recoveryPlan: [
          { index: ACTION_PAUSE, adapter: pauseAction, name: 'pause', config: pauseConfig },
          {
            index: ACTION_EVACUATE,
            adapter: evacuateAction,
            name: 'evacuate-to-safe',
            config: evacuateConfig,
          },
        ],
        trigger: {
          signalHash,
          nonce: 0,
          validAfter: validAfter.toString(),
          validUntil: validUntil.toString(),
          signature,
        },
        steps,
        outcome: {
          terminalStatus: status,
          satisfied,
          stateHash,
          observedValue: observedValue.toString(),
          vaultBalance: vaultBalance.toString(),
          safeBalance: safeBalance.toString(),
          responderBalance: responderBalance.toString(),
        },
        successTransaction: {
          hash: attempt.transactionHash,
          link:
            attempt.transactionHash === undefined
              ? undefined
              : explorerTxUrl(attempt.transactionHash),
          keeperhubExecutionId: attempt.executionId,
          blockNumber: receipt?.blockNumber,
          logCount: receipt?.logs.length,
        },
        limitations: [
          'The refused primary action is offchain evidence: a simulation has no transaction hash.',
          'The guarantee is single-chain and synchronous. Nothing here rolls back a confirmed transaction.',
          'Private routing is not claimed. Base Sepolia was measured with usePrivateMempoolRpc false.',
          'The requester and the executor are the same organization wallet in this demo. In production they are different parties.',
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  step(`receipt written to ${receiptPath}`);

  async function readBalance(erc20: string, holder: string, abi: Abi): Promise<bigint> {
    const call = await ethCall({
      to: erc20,
      data: encodeFunctionData({ abi, functionName: 'balanceOf', args: [holder] }),
    });
    return BigInt(call.value ?? '0x0');
  }
}

main().catch(fail);

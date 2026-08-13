/**
 * Deploying through CreateX, called by a sponsored KeeperHub contract call. ADR-014.
 *
 * RESURV has no funded deployer. The KeeperHub organization wallet holds zero native currency
 * and gets its gas sponsored, and sponsorship pays a fee rather than granting a balance. There
 * is no deployment endpoint on the Direct Execution API. CreateX's `deployCreate2` is an
 * ordinary ABI function, so a call to it is sponsored like any other contract call, and RESURV
 * deploys its own contracts with no funding at all.
 *
 * Two things about the salt, and they are the whole reason the address is predictable.
 *
 * CreateX guards every salt before using it, and which guard applies depends on the salt's own
 * first 21 bytes. A salt whose leading 20 bytes are the zero address or the caller's address
 * selects a permissioned or chain-bound scheme that depends on `msg.sender`, which under
 * sponsorship is a value this process does not control. Any other leading 20 bytes select the
 * unrestricted scheme, where the guarded salt is simply `keccak256(abi.encode(salt))`.
 *
 * So RESURV derives its salts from a label hash, checks that the leading bytes fall in the
 * unrestricted case, and computes the deployment address offchain. The address is then compared
 * against the one CreateX emits. Predicting it and reading it back are two independent facts,
 * and a deployment tool that only did the second could not tell a success from a collision.
 */

import { CREATEX_ADDRESS } from '@resurv/chain';
import { encodeAbiParameters, getCreate2Address, keccak256, toHex } from 'viem';

export const CREATEX_DEPLOY_CREATE2_ABI = [
  {
    type: 'function',
    name: 'deployCreate2',
    stateMutability: 'payable',
    inputs: [
      { name: 'salt', type: 'bytes32' },
      { name: 'initCode', type: 'bytes' },
    ],
    outputs: [{ name: 'newContract', type: 'address' }],
  },
] as const;

/** `ContractCreation(address indexed newContract, bytes32 indexed salt)`. */
export const CONTRACT_CREATION_TOPIC =
  '0xb8fda7e00c6b06a2b54e58521bc5894fee35f1090e5a3bb6390bfe2b98b497f7' as const;

/** `ContractCreation(address indexed newContract)`, emitted by the non-salted entry points. */
export const CONTRACT_CREATION_UNSALTED_TOPIC =
  '0x4db17dd5e4732fb6da34a148104a592783ca119a1e7bb8829eba6cbadef0b511' as const;

/**
 * The deployment generation.
 *
 * v2 added `createCovenantEncoded`. v3 followed an audit that found two ways a covenant's escrow
 * could be trapped permanently. v4 follows the second audit round, which found three more:
 * a verifier returning a non-boolean word reverted the expiry in the manager's own frame, an
 * over-long verifier return let the expiry refund over a true outcome, and a global pause closed
 * the last exit for a covenant whose outcome came true past its deadline.
 *
 * Why a namespace bump rather than relying on the init code changing. A CREATE2 address is a
 * function of the guarded salt and the init code, so a contract whose bytecode changed lands
 * somewhere new by itself. `TestUSD`, `DemoVault` and `VaultSafeStateVerifier` did not change,
 * and without a new namespace they would collide with their own previous deployment and revert,
 * leaving a generation split across two sets of addresses. Bumping keeps one deployment coherent.
 *
 * v5 exists for a worse reason than any of them. The v4 deployment read a stale artifact cache
 * and put a *mutant* `ResurvCovenantManager` on chain: a mutation campaign had restored the
 * source file without rebuilding, so `out/` still held the build with `maxTotalAttempts`
 * deleted. The manifest recorded that mutant's hashes and was therefore self-consistent and
 * wrong. Sourcify caught it, by refusing to verify that one contract while verifying the other
 * five. `rebuildContracts()` now runs before any artifact is read.
 *
 * Every earlier generation stays on chain. Nothing references it, and `deployments/historical/`
 * records it as what it is: the evidence a previous run produced, superseded rather than deleted.
 */
export const SALT_NAMESPACE = 'resurv/v5';

export class SaltRejectedError extends Error {
  constructor(reason: string) {
    super(`salt is unusable: ${reason}`);
    this.name = 'SaltRejectedError';
  }
}

/**
 * A salt in CreateX's unrestricted case, derived from a label so a redeployment of the same
 * label at the same version collides loudly instead of silently producing a second copy.
 */
export function saltFor(label: string, version = SALT_NAMESPACE): `0x${string}` {
  return keccak256(toHex(`${version}/${label}`));
}

/**
 * The guarded salt CreateX actually uses, for the unrestricted case only. Throws rather than
 * guessing when the salt would select one of the `msg.sender`-dependent schemes.
 */
export function guardedSalt(salt: `0x${string}`, orgWallet: string): `0x${string}` {
  const leading = salt.slice(2, 42).toLowerCase();
  if (leading === '0'.repeat(40)) {
    throw new SaltRejectedError(
      'leading 20 bytes are the zero address, which selects a chain-bound guard',
    );
  }
  if (leading === orgWallet.replace(/^0x/, '').toLowerCase()) {
    throw new SaltRejectedError(
      'leading 20 bytes are the caller, which selects a permissioned guard',
    );
  }
  return keccak256(encodeAbiParameters([{ type: 'bytes32' }], [salt]));
}

export function predictAddress(
  salt: `0x${string}`,
  initCode: `0x${string}`,
  orgWallet: string,
): `0x${string}` {
  return getCreate2Address({
    from: CREATEX_ADDRESS,
    salt: guardedSalt(salt, orgWallet),
    bytecodeHash: keccak256(initCode),
  });
}

/** The address CreateX reported, taken from the indexed first topic of its own event. */
export function addressFromCreationLog(log: {
  topics: readonly string[];
  address: string;
}): `0x${string}` | undefined {
  const topic0 = log.topics[0]?.toLowerCase();
  if (
    topic0 !== CONTRACT_CREATION_TOPIC.toLowerCase() &&
    topic0 !== CONTRACT_CREATION_UNSALTED_TOPIC.toLowerCase()
  ) {
    return undefined;
  }
  if (log.address.toLowerCase() !== CREATEX_ADDRESS.toLowerCase()) return undefined;
  const indexed = log.topics[1];
  if (indexed === undefined || indexed.length !== 66) return undefined;
  return `0x${indexed.slice(26)}` as `0x${string}`;
}

/**
 * The seam fixture.
 *
 * A purpose-built contract would mean `forge script --broadcast`, a funded deployer key and a
 * faucet trip. KeeperHub sponsors the calls it executes, not a Foundry deployment, so that is
 * a separate blocker and the seam question does not need it. An already-deployed canary on
 * Base Sepolia gives the deterministic pair for free.
 *
 * Independently verified from this repository before use, against `https://sepolia.base.org`:
 *
 *   cast code   -> 139 bytes of runtime, one dispatch arm
 *   cast selectors <runtime> -> exactly one entry, 0x33d425c4
 *   cast call ping(bytes32)  -> returns 0x
 *   cast call <unknown selector> -> execution reverted
 *   cast estimate ping(bytes32) -> 23557
 *
 * The runtime is `...600436106026575f3560e01c806333d425c414602a575b5f80fd5b...`: a single
 * selector compare, and `5f80fd` (`revert(0, 0)`) as the default arm. There is no fallback and
 * no receive, which is what makes the revert case deterministic rather than state-dependent.
 */

export const CANARY_ADDRESS = '0x2A6FC8182Bf9928Ef7517dA980dC79e8107c555A';

export const CANARY_CHAIN_ID = 84532;

/** `ping(bytes32)`. The only function the canary implements. */
export const PING_SELECTOR = '0x33d425c4';

export const PING_ABI = [
  {
    type: 'function',
    name: 'ping',
    inputs: [{ name: 'challenge', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

/**
 * A function the canary does not implement. Encoding succeeds locally, so the request is
 * well-formed and reaches KeeperHub; onchain there is no matching selector and no fallback, so
 * the call reverts at the contract. This is the guaranteed-revert half of the pair.
 */
export const ABSENT_FUNCTION_NAME = 'resurvSeamAbsentFunction';

export const ABSENT_FUNCTION_ABI = [
  {
    type: 'function',
    name: ABSENT_FUNCTION_NAME,
    inputs: [{ name: 'challenge', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

/**
 * topic0 of the event the canary emits, read out of its runtime bytecode rather than from a
 * published source. The event's Solidity name is not published anywhere this project can
 * reach, so it is recorded as an opaque topic and its parameters are decoded positionally.
 * LOG3 with 32 bytes of data: two indexed parameters and one word of payload, which the
 * bytecode shows are `caller()`, the challenge, and `chainid()`.
 */
export const CANARY_EVENT_TOPIC0 =
  '0x4947ef22330e8e81cdedf82c33d366e9c942511f5edf79140686b33af9de7f33';

/** Measured, not guessed. `cast estimate ping(bytes32) 0x…01` on Base Sepolia. */
export const PING_GAS_ESTIMATE = 23557;

/**
 * Intrinsic cost of the `ping` transaction with a fully non-zero 32-byte challenge:
 * 21000 + 36 non-zero calldata bytes x 16. A gas limit between this and the execution cost is
 * accepted by the node and runs out of gas inside the call, which is how a *broadcast* revert
 * is produced without a purpose-built contract.
 */
export const PING_INTRINSIC_GAS = 21000 + 36 * 16;

export function paddedAddressTopic(address: string): string {
  return `0x${address.replace(/^0x/, '').toLowerCase().padStart(64, '0')}`;
}

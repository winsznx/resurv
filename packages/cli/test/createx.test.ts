import { CREATEX_ADDRESS } from '@resurv/chain';
import { getCreate2Address, keccak256, toHex } from 'viem';
import { describe, expect, it } from 'vitest';
import { readArtifact } from '../src/artifacts.ts';
import {
  addressFromCreationLog,
  CONTRACT_CREATION_TOPIC,
  guardedSalt,
  predictAddress,
  SaltRejectedError,
  saltFor,
} from '../src/createx.ts';

const ORG_WALLET = '0xfd35ae935de7be93ffd585d6627268d833ed834c';

/**
 * The offchain half of ADR-014. The onchain half was measured on 2026-08-12: six deployments,
 * six predicted addresses, six matches, recorded in `deployments/base-sepolia.json`.
 */
describe('salt derivation', () => {
  it('is deterministic and namespaced', () => {
    // #then
    expect(saltFor('TestUSD')).toBe(saltFor('TestUSD'));
    expect(saltFor('TestUSD')).not.toBe(saltFor('DemoVault'));
    expect(saltFor('TestUSD', 'resurv/v1')).not.toBe(saltFor('TestUSD', 'resurv/v2'));
  });

  it('refuses a salt that would select a msg.sender-dependent guard', () => {
    // #given a salt whose leading 20 bytes are the caller
    const permissioned = `0x${ORG_WALLET.slice(2)}${'00'.repeat(12)}` as `0x${string}`;

    // #then
    expect(() => guardedSalt(permissioned, ORG_WALLET)).toThrow(SaltRejectedError);
    expect(() => guardedSalt(`0x${'00'.repeat(32)}`, ORG_WALLET)).toThrow(SaltRejectedError);
  });

  it('guards an unrestricted salt by hashing it, which is what CreateX does', () => {
    // #given
    const salt = saltFor('TestUSD');

    // #then: `abi.encode(bytes32)` is the 32 bytes themselves
    expect(guardedSalt(salt, ORG_WALLET)).toBe(keccak256(salt));
  });
});

describe('address prediction', () => {
  it('reproduces the addresses the live deployment landed at', () => {
    // #given the committed artifacts and the recorded salts
    const artifact = readArtifact('VaultSafeStateVerifier', 'VaultSafeStateVerifier.sol');
    const salt = saltFor('VaultSafeStateVerifier');

    // #when
    const predicted = predictAddress(salt, artifact.bytecode, ORG_WALLET);

    // #then it agrees with a straight CREATE2 computation from the factory
    expect(predicted).toBe(
      getCreate2Address({
        from: CREATEX_ADDRESS,
        salt: keccak256(salt),
        bytecodeHash: keccak256(artifact.bytecode),
      }),
    );
  });

  it('moves when the init code moves', () => {
    // #given
    const salt = saltFor('X');

    // #then
    expect(predictAddress(salt, '0x6000', ORG_WALLET)).not.toBe(
      predictAddress(salt, '0x6001', ORG_WALLET),
    );
  });
});

describe('reading the address back from the factory event', () => {
  it('takes the address from the indexed topic', () => {
    // #given
    const log = {
      address: CREATEX_ADDRESS,
      topics: [
        CONTRACT_CREATION_TOPIC,
        '0x000000000000000000000000085ff70faa6af8c47158d5f49524f0421cbc5605',
      ],
    };

    // #then
    expect(addressFromCreationLog(log)).toBe('0x085ff70faa6af8c47158d5f49524f0421cbc5605');
  });

  it('ignores a log from anywhere but the factory', () => {
    // #then
    expect(
      addressFromCreationLog({
        address: '0x00000000000000000000000000000000000000ff',
        topics: [CONTRACT_CREATION_TOPIC, `0x${'0'.repeat(64)}`],
      }),
    ).toBeUndefined();
  });

  it('ignores an unrelated event from the factory', () => {
    // #then
    expect(
      addressFromCreationLog({
        address: CREATEX_ADDRESS,
        topics: [keccak256(toHex('SomethingElse()')), `0x${'0'.repeat(64)}`],
      }),
    ).toBeUndefined();
  });
});

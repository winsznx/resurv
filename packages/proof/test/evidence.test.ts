import { describe, expect, it } from 'vitest';
import { ATOMIC_LOG_ORDER, DEPLOYMENT, RECEIPT } from '../src/index.ts';

/**
 * These tests exist so the proof page cannot show something the run did not produce. They read
 * the committed artifacts and assert the specific claims the page makes about them, which means
 * a re-run that changed an outcome fails the gate rather than quietly changing the page.
 */

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_32 = /^0x[0-9a-fA-F]{64}$/;

describe('the deployment manifest', () => {
  it('covers every contract the demo needs', () => {
    // #then
    for (const name of [
      'ResurvCovenantManager',
      'PauseAction',
      'EvacuateERC20Action',
      'VaultSafeStateVerifier',
      'DemoVault',
      'TestUSD',
    ]) {
      const contract = DEPLOYMENT.contracts[name];
      expect(contract, `${name} is missing from the manifest`).toBeDefined();
      expect(contract?.address).toMatch(HEX_ADDRESS);
      expect(contract?.transactionHash).toMatch(HEX_32);
    }
  });

  it('records that every address was predicted before it was deployed', () => {
    // #then this is the whole claim of ADR-014, and a single false here refutes it
    for (const contract of Object.values(DEPLOYMENT.contracts)) {
      expect(contract.predictedAddressMatched, `${contract.name} address was not predicted`).toBe(
        true,
      );
    }
  });

  it('was deployed on Base Sepolia through CreateX by the organization wallet', () => {
    // #then
    expect(DEPLOYMENT.chainId).toBe(84532);
    expect(DEPLOYMENT.factory.toLowerCase()).toBe('0xba5ed099633d3b313e4d5f7bdc1305d3c28ba5ed');
    expect(DEPLOYMENT.deployerOrgWallet).toMatch(HEX_ADDRESS);
  });

  it('records the compiler settings a verifier needs', () => {
    // #then
    expect(DEPLOYMENT.solcVersion).toBe('0.8.36');
    expect(DEPLOYMENT.evmVersion).toBe('cancun');
    expect(DEPLOYMENT.optimizer.enabled).toBe(true);
  });
});

describe('the canonical outcome receipt', () => {
  it('records a satisfied covenant', () => {
    // #then 5 is SATISFIED in the onchain enum
    expect(RECEIPT.outcome.terminalStatus).toBe(5);
    expect(RECEIPT.outcome.satisfied).toBe(true);
    expect(RECEIPT.outcome.stateHash).toMatch(HEX_32);
  });

  it('shows the vault emptied, the recipient paid and the responder paid', () => {
    // #then
    expect(RECEIPT.outcome.vaultBalance).toBe('0');
    expect(RECEIPT.outcome.safeBalance).toBe('1000000');
    expect(RECEIPT.outcome.responderBalance).toBe('1000000');
    expect(RECEIPT.outcome.observedValue).toBe('1000000');
  });

  it('shows the primary action refused before broadcast, with no transaction', () => {
    // #then
    const primary = RECEIPT.steps.find((step) => step.label === 'attempt-primary');
    expect(primary?.state).toBe('SIMULATION_REJECTED');
    expect(primary?.transactionHash).toBeUndefined();
  });

  it('shows the fallback confirmed on chain', () => {
    // #then
    const fallback = RECEIPT.steps.find((step) => step.label === 'attempt-fallback');
    expect(fallback?.state).toBe('CONFIRMED');
    expect(fallback?.transactionHash).toMatch(HEX_32);
    expect(fallback?.transactionHash).toBe(RECEIPT.successTransaction.hash);
  });

  it('shows both replays rejected', () => {
    // #then
    for (const label of ['replay-trigger', 'replay-attempt']) {
      expect(RECEIPT.steps.find((step) => step.label === label)?.state).toBe('REJECTED');
    }
  });

  it('carries the six logs the atomicity claim rests on', () => {
    // #then
    expect(RECEIPT.successTransaction.logCount).toBe(ATOMIC_LOG_ORDER.length);
  });

  it('never confirmed a step that has no transaction', () => {
    // #then: CONFIRMED is a chain state and cannot exist without a hash
    for (const step of RECEIPT.steps) {
      if (step.state !== 'CONFIRMED') continue;
      expect(step.transactionHash, `${step.label} is CONFIRMED with no transaction`).toMatch(
        HEX_32,
      );
    }
  });

  it('states its limitations rather than leaving them to be discovered', () => {
    // #then
    expect(RECEIPT.limitations.length).toBeGreaterThanOrEqual(4);
    expect(RECEIPT.limitations.join(' ')).toContain('Private routing is not claimed');
  });

  it('points at the contracts the manifest recorded', () => {
    // #then
    expect(RECEIPT.covenant.manager.toLowerCase()).toBe(
      DEPLOYMENT.contracts['ResurvCovenantManager']?.address.toLowerCase(),
    );
    expect(RECEIPT.covenant.verifier.toLowerCase()).toBe(
      DEPLOYMENT.contracts['VaultSafeStateVerifier']?.address.toLowerCase(),
    );
  });
});

import { describe, expect, it } from 'vitest';
import {
  BASE_SEPOLIA,
  baseSepolia,
  explorerAddressUrl,
  explorerTxUrl,
  PUBLIC_RPC_URLS,
  TARGET_CHAIN_ID,
} from '../src/index.ts';

describe('target chain', () => {
  it('agrees with viem on the Base Sepolia chain id', () => {
    expect(TARGET_CHAIN_ID).toBe(84532);
    expect(baseSepolia.id).toBe(TARGET_CHAIN_ID);
    expect(BASE_SEPOLIA.chainId).toBe(baseSepolia.id);
  });

  it('is a testnet, which the deployment gate depends on', () => {
    expect(BASE_SEPOLIA.isTestnet).toBe(true);
    expect(baseSepolia.testnet).toBe(true);
  });

  /**
   * Guards a claim, not a constant. Private mempool routing is false on Base Sepolia. If
   * this ever flips, docs/CLAIMS.md and every public statement about MEV protection must be
   * revisited before the value changes here.
   */
  it('records that Base Sepolia does not use a private mempool', () => {
    expect(BASE_SEPOLIA.usePrivateMempoolRpc).toBe(false);
  });
});

describe('independent verification endpoints', () => {
  it('keeps at least two distinct origins so a single node cannot decide a proof', () => {
    expect(PUBLIC_RPC_URLS.length).toBeGreaterThanOrEqual(2);
    expect(new Set(PUBLIC_RPC_URLS).size).toBe(PUBLIC_RPC_URLS.length);
  });

  it('uses hosts RESURV does not control', () => {
    for (const url of PUBLIC_RPC_URLS) {
      expect(url.startsWith('https://')).toBe(true);
      expect(url).not.toContain('resurv');
    }
  });
});

describe('explorer links', () => {
  it('builds a transaction url on sepolia.basescan.org', () => {
    expect(explorerTxUrl('0xabc')).toBe('https://sepolia.basescan.org/tx/0xabc');
  });

  it('builds an address url', () => {
    expect(explorerAddressUrl('0xdef')).toBe('https://sepolia.basescan.org/address/0xdef');
  });
});

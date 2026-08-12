import { baseSepolia } from 'viem/chains';

export { baseSepolia };

/**
 * Base Sepolia. v1 is locked to this chain (PRD 7.1). Values below were read from KeeperHub's
 * live `GET /api/chains` response, not from documentation.
 */
export const TARGET_CHAIN_ID = 84532 as const;

export const BASE_SEPOLIA = {
  chainId: TARGET_CHAIN_ID,
  name: 'Base Sepolia',
  isTestnet: true,
  explorerUrl: 'https://sepolia.basescan.org',
  /**
   * Measured false on Base Sepolia. Private mempool routing applies to Ethereum mainnet and
   * Sepolia, not to our target chain, so RESURV must not claim MEV protection anywhere in its
   * UI, README, or demo. See docs/CLAIMS.md.
   */
  usePrivateMempoolRpc: false,
} as const;

/**
 * Independent verification endpoints. A run is only proven when a receipt fetched from a node
 * RESURV does not control agrees with what KeeperHub reported, so at least two origins are kept
 * and quorum is required.
 */
export const PUBLIC_RPC_URLS = [
  'https://sepolia.base.org',
  'https://base-sepolia-rpc.publicnode.com',
] as const;

/**
 * CreateX, the CREATE2 factory RESURV deploys through. ADR-014.
 *
 * Verified from this repository on 2026-08-12 against `https://sepolia.base.org`: `cast code`
 * returns 23 KB of runtime at this address on chain 84532, and `cast selectors` on that runtime
 * contains `0x26307668`, which is `deployCreate2(bytes32,bytes)`.
 *
 * It matters that the deployer is a factory and not an operator: `msg.sender` inside every
 * RESURV constructor is this address, which is why no RESURV constructor reads it.
 */
export const CREATEX_ADDRESS = '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed' as const;

export function explorerTxUrl(transactionHash: string): string {
  return `${BASE_SEPOLIA.explorerUrl}/tx/${transactionHash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${BASE_SEPOLIA.explorerUrl}/address/${address}`;
}

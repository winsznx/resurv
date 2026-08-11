import { baseSepolia } from 'viem/chains';

export { baseSepolia };

/**
 * Base Sepolia. v1 is locked to this chain (PRD 7.1). Values below were read from
 * KeeperHub's live `GET /api/chains` response, not from documentation.
 */
export const TARGET_CHAIN_ID = 84532 as const;

export const BASE_SEPOLIA = {
  chainId: TARGET_CHAIN_ID,
  name: 'Base Sepolia',
  isTestnet: true,
  explorerUrl: 'https://sepolia.basescan.org',
  /**
   * Measured false on Base Sepolia. Private mempool routing applies to Ethereum
   * mainnet and Sepolia, not to our target chain, so RESURV must not claim MEV
   * protection anywhere in its UI, README, or demo. See docs/CLAIMS.md.
   */
  usePrivateMempoolRpc: false,
} as const;

/**
 * Independent verification endpoints. A run is only proven when a receipt fetched from a
 * node RESURV does not control agrees with what KeeperHub reported, so at least two
 * origins are kept and quorum is required.
 */
export const PUBLIC_RPC_URLS = [
  'https://sepolia.base.org',
  'https://base-sepolia-rpc.publicnode.com',
] as const;

export function explorerTxUrl(transactionHash: string): string {
  return `${BASE_SEPOLIA.explorerUrl}/tx/${transactionHash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${BASE_SEPOLIA.explorerUrl}/address/${address}`;
}

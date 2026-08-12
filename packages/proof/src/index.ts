/**
 * The committed evidence, typed once and imported everywhere.
 *
 * The deployment manifest and the outcome receipt are written by the live runs themselves and
 * committed to the repository. Both the proof page and the Worker import *these* files rather
 * than a copy, so nothing the judge reads can drift away from what the run produced. A build
 * that cannot find them fails, which is the correct behaviour for a page whose entire job is to
 * show evidence.
 */

import manifestJson from '../../../deployments/base-sepolia.json' with { type: 'json' };
import receiptJson from '../../../docs/proof/canonical-covenant.json' with { type: 'json' };

export interface DeployedContractRecord {
  readonly name: string;
  readonly address: string;
  readonly salt: string;
  readonly initCodeHash: string;
  readonly runtimeBytecodeHash: string;
  readonly constructorArgs: readonly string[];
  readonly transactionHash: string;
  readonly keeperhubExecutionId?: string | undefined;
  readonly blockNumber?: string | undefined;
  readonly predictedAddressMatched: boolean;
}

export interface DeploymentRecord {
  readonly chainId: number;
  readonly chainName: string;
  readonly deployedAt: string;
  readonly factory: string;
  readonly deployerOrgWallet: string;
  readonly solcVersion: string;
  readonly evmVersion: string;
  readonly optimizer: { readonly enabled: boolean; readonly runs: number };
  readonly gitCommit?: string | undefined;
  readonly contracts: Readonly<Record<string, DeployedContractRecord>>;
  readonly configurationCalls: readonly {
    readonly label: string;
    readonly transactionHash: string;
    readonly executionId?: string | undefined;
  }[];
}

export interface ReceiptStep {
  readonly label: string;
  readonly state: string;
  readonly transactionHash?: string | undefined;
  readonly executionId?: string | undefined;
  readonly explorer?: string | undefined;
  readonly note: string;
}

export interface OutcomeReceipt {
  readonly schema: string;
  readonly generatedAt: string;
  readonly chain: { readonly chainId: number; readonly name: string };
  readonly covenant: {
    readonly manager: string;
    readonly covenantId: string;
    readonly requester: string;
    readonly responder: string;
    readonly triggerAuthority: string;
    readonly deadline: string;
    readonly verifier: string;
    readonly verifierContext: string;
    readonly verifierContextHash: string;
    readonly feeToken: string;
    readonly feeAmount: string;
  };
  readonly recoveryPlan: readonly {
    readonly index: number;
    readonly adapter: string;
    readonly name: string;
    readonly config: string;
  }[];
  readonly trigger: {
    readonly signalHash: string;
    readonly nonce: number;
    readonly validAfter: string;
    readonly validUntil: string;
    readonly signature: string;
  };
  readonly steps: readonly ReceiptStep[];
  readonly outcome: {
    readonly terminalStatus: number;
    readonly satisfied: boolean;
    readonly stateHash: string;
    readonly observedValue: string;
    readonly vaultBalance: string;
    readonly safeBalance: string;
    readonly responderBalance: string;
  };
  readonly successTransaction: {
    readonly hash?: string | undefined;
    readonly link?: string | undefined;
    readonly keeperhubExecutionId?: string | undefined;
    readonly blockNumber?: string | undefined;
    readonly logCount?: number | undefined;
  };
  readonly limitations: readonly string[];
}

export const DEPLOYMENT: DeploymentRecord = manifestJson as unknown as DeploymentRecord;
export const RECEIPT: OutcomeReceipt = receiptJson as unknown as OutcomeReceipt;

/**
 * Evidence classification, applied to every claim the proof page makes. The vocabulary is
 * `docs/CLAIMS.md`'s, and the page never states anything above its level.
 */
export type EvidenceLevel = 'LIVE' | 'MEASURED' | 'DOCUMENTED' | 'LOCAL' | 'REFUTED';

export interface Claim {
  readonly statement: string;
  readonly level: EvidenceLevel;
  readonly evidence: string;
}

/**
 * The six logs the successful attempt emitted, in the order the EVM produced them. This is the
 * atomicity argument: a false verifier result would have reverted the transaction, so none of
 * them would exist.
 */
export const ATOMIC_LOG_ORDER: readonly {
  /** Stable across renders. `Transfer` appears twice and means something different each time. */
  readonly id: string;
  readonly event: string;
  readonly meaning: string;
}[] = [
  {
    id: 'attempt-started',
    event: 'AttemptStarted',
    meaning: 'the attempt id is burned before the adapter runs',
  },
  {
    id: 'vault-transfer',
    event: 'Transfer',
    meaning: 'the vault sends its balance to the approved recipient',
  },
  {
    id: 'vault-evacuated',
    event: 'VaultEvacuated',
    meaning: 'the protocol records its own state change',
  },
  {
    id: 'attempt-succeeded',
    event: 'AttemptSucceeded',
    meaning: 'the committed adapter reported what it did',
  },
  {
    id: 'fee-transfer',
    event: 'Transfer',
    meaning: 'the escrow releases the success fee to the responder',
  },
  {
    id: 'covenant-satisfied',
    event: 'CovenantSatisfied',
    meaning: 'the covenant becomes terminal, with the state hash',
  },
];

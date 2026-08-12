/**
 * The deployment manifest. PRD 10.2 requires bytecode hashes, constructor arguments and
 * compiler settings to be recorded; PRD 22.3 requires the address, the commit and the
 * transaction. This file is that record, committed to the repository, and it is what the public
 * proof page and the verification CLI both read.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '@resurv/node-runtime';

export const DEPLOYMENT_DIR = join(REPO_ROOT, 'deployments');
export const DEPLOYMENT_FILE = join(DEPLOYMENT_DIR, 'base-sepolia.json');

export interface DeployedContract {
  readonly name: string;
  readonly address: string;
  readonly salt: string;
  readonly initCodeHash: string;
  readonly runtimeBytecodeHash: string;
  readonly constructorArgs: readonly string[];
  readonly transactionHash: string;
  readonly keeperhubExecutionId: string | undefined;
  readonly blockNumber: string | undefined;
  readonly predictedAddressMatched: boolean;
}

export interface DeploymentManifest {
  readonly chainId: number;
  readonly chainName: string;
  readonly deployedAt: string;
  readonly factory: string;
  readonly deployerOrgWallet: string;
  readonly solcVersion: string;
  readonly evmVersion: string;
  readonly optimizer: { enabled: boolean; runs: number };
  readonly gitCommit: string | undefined;
  readonly contracts: Record<string, DeployedContract>;
  readonly configurationCalls: readonly {
    readonly label: string;
    readonly transactionHash: string;
    readonly executionId: string | undefined;
  }[];
}

export function readManifest(): DeploymentManifest | undefined {
  try {
    return JSON.parse(readFileSync(DEPLOYMENT_FILE, 'utf8')) as DeploymentManifest;
  } catch {
    return undefined;
  }
}

export function writeManifest(manifest: DeploymentManifest): string {
  mkdirSync(DEPLOYMENT_DIR, { recursive: true });
  writeFileSync(DEPLOYMENT_FILE, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return DEPLOYMENT_FILE;
}

/**
 * Reads the two hand-transcribed reference models and the Solidity enum out of source, so a
 * test can compare the Solidity and TypeScript state machines directly.
 *
 * The Phase 0 independent review found that nothing anywhere compared the Solidity enum to
 * the TypeScript one: `CovenantStatus.t.sol` asserted the Solidity ordinals against literals
 * in the same file, and `covenant-status.test.ts` asserted the TypeScript object was
 * contiguous against itself. The consensus-relevant pairing, the one where the contract emits
 * an ordinal and TypeScript decodes it, rested on two people typing the same eight names.
 */

import { readRepoFile } from './repo.ts';

export const SOLIDITY_MODEL_PATH = 'packages/contracts/test/model/CovenantStatusReference.sol';
export const TYPESCRIPT_MODEL_PATH = 'packages/domain/test/model/covenant-status-reference.ts';
export const SOLIDITY_ENUM_PATH = 'packages/contracts/src/CovenantStatus.sol';

const ROW = /['"]([.X]{8})['"]/g;

export interface ReferenceModelSource {
  readonly transitionRows: string[];
  readonly terminalRow: string;
}

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`missing marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`missing terminator after: ${startMarker}`);
  return source.slice(start, end);
}

function rowsIn(source: string): string[] {
  return [...source.matchAll(ROW)].map((match) => match[1] ?? '');
}

export function solidityReferenceModel(): ReferenceModelSource {
  const source = readRepoFile(SOLIDITY_MODEL_PATH);
  return {
    transitionRows: rowsIn(
      sliceBetween(source, 'function transitionTable', 'function terminalRow'),
    ),
    terminalRow: rowsIn(sliceBetween(source, 'function terminalRow', 'function allows'))[0] ?? '',
  };
}

export function typescriptReferenceModel(): ReferenceModelSource {
  const source = readRepoFile(TYPESCRIPT_MODEL_PATH);
  return {
    transitionRows: rowsIn(
      sliceBetween(source, 'export const REFERENCE_TRANSITION_TABLE', 'export const'),
    ).map((row) => row),
    terminalRow:
      rowsIn(
        sliceBetween(source, 'export const REFERENCE_TERMINAL_ROW', 'function ordinalOf'),
      )[0] ?? '',
  };
}

/** Enum member names in declaration order, which is ordinal order. */
export function solidityEnumMembers(): string[] {
  const body = sliceBetween(readRepoFile(SOLIDITY_ENUM_PATH), 'enum CovenantStatus {', '}');
  return [...body.matchAll(/^\s*([A-Z][A-Z_]*)\s*,?\s*(?:\/\/.*)?$/gm)].map(
    (match) => match[1] ?? '',
  );
}

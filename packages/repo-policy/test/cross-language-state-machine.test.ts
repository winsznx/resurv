import { allCovenantStatusNames, CovenantStatus } from '@resurv/domain';
import { describe, expect, it } from 'vitest';
import {
  solidityEnumMembers,
  solidityReferenceModel,
  typescriptReferenceModel,
} from '../src/state-machine-sources.ts';

/**
 * The contract emits a `CovenantStatus` ordinal and TypeScript decodes it, so the two
 * definitions are a consensus interface rather than a duplicated constant. Before this test
 * nothing compared them: each side asserted its own literals against itself.
 */

const solidity = solidityReferenceModel();
const typescript = typescriptReferenceModel();

describe('the Solidity and TypeScript covenant enums are one enum', () => {
  const members = solidityEnumMembers();

  it('declares the same names in the same order', () => {
    expect(members).toStrictEqual([...allCovenantStatusNames()]);
  });

  it('assigns the same ordinal to every name', () => {
    for (const [ordinal, name] of members.entries()) {
      expect(CovenantStatus[name as keyof typeof CovenantStatus]).toBe(ordinal);
    }
  });

  it('found a real enum rather than an empty parse', () => {
    expect(members).toHaveLength(8);
  });
});

describe('the two reference models are the same table', () => {
  it('parsed both files rather than matching two empty results', () => {
    expect(solidity.transitionRows).toHaveLength(8);
    expect(typescript.transitionRows).toHaveLength(8);
    expect(solidity.terminalRow).toMatch(/^[.X]{8}$/);
    expect(typescript.terminalRow).toMatch(/^[.X]{8}$/);
  });

  it('agrees row for row on the transition table', () => {
    expect(typescript.transitionRows).toStrictEqual(solidity.transitionRows);
  });

  it('agrees on which states are terminal', () => {
    expect(typescript.terminalRow).toBe(solidity.terminalRow);
  });

  it('marks exactly three terminal states, the last three ordinals', () => {
    expect(solidity.terminalRow).toBe('.....XXX');
  });
});

/**
 * Onchain covenant lifecycle. Mirrors PRD 9.1 and must stay ordinal-identical to the
 * Solidity `CovenantStatus` enum, because the contract emits the numeric value and this
 * package decodes it. A reordering here is a consensus-level bug, not a refactor.
 */
export const CovenantStatus = {
  NONE: 0,
  DRAFT: 1,
  ARMED: 2,
  TRIGGERED: 3,
  EXECUTING: 4,
  SATISFIED: 5,
  EXPIRED: 6,
  CANCELLED: 7,
} as const;

export type CovenantStatusName = keyof typeof CovenantStatus;
export type CovenantStatusValue = (typeof CovenantStatus)[CovenantStatusName];

const STATUS_NAMES = Object.keys(CovenantStatus) as CovenantStatusName[];

/**
 * Terminal states. Once a covenant reaches one of these the chain will not move it again,
 * and no further recovery action may run. CLAUDE.md invariant: "No action runs after a
 * terminal state."
 */
const TERMINAL: ReadonlySet<CovenantStatusName> = new Set(['SATISFIED', 'EXPIRED', 'CANCELLED']);

/**
 * Legal transitions from PRD 9.1. Anything absent from this table is illegal, including
 * self-transitions: re-observing the same status is not a transition and callers must not
 * route it through this check.
 */
const TRANSITIONS: Readonly<Record<CovenantStatusName, readonly CovenantStatusName[]>> = {
  NONE: ['DRAFT'],
  DRAFT: ['ARMED', 'CANCELLED'],
  ARMED: ['TRIGGERED', 'CANCELLED'],
  TRIGGERED: ['EXECUTING', 'SATISFIED', 'EXPIRED'],
  EXECUTING: ['SATISFIED', 'EXPIRED'],
  SATISFIED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export function isTerminalStatus(status: CovenantStatusName): boolean {
  return TERMINAL.has(status);
}

export function canTransition(from: CovenantStatusName, to: CovenantStatusName): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: CovenantStatusName): readonly CovenantStatusName[] {
  return TRANSITIONS[from];
}

export function covenantStatusName(value: number): CovenantStatusName {
  const name = STATUS_NAMES.find((candidate) => CovenantStatus[candidate] === value);
  if (name === undefined) {
    throw new RangeError(`unknown CovenantStatus ordinal: ${value}`);
  }
  return name;
}

export function allCovenantStatusNames(): readonly CovenantStatusName[] {
  return STATUS_NAMES;
}

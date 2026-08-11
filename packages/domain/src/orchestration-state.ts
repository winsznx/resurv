/**
 * Offchain orchestration state from PRD 9.2. This is RESURV's own bookkeeping and carries
 * no authority: PRD 14.3 makes the chain the source of truth for covenant status and
 * payment, and PRD 9.2 states "Offchain status never overrides onchain terminal status."
 */
export const ORCHESTRATION_STATES = [
  'PENDING',
  'RECONCILING',
  'PLANNING',
  'SIMULATING',
  'SIMULATION_REJECTED',
  'SUBMITTING',
  'AWAITING_KEEPERHUB',
  'AWAITING_CONFIRMATIONS',
  'SATISFIED',
  'EXHAUSTED',
  'EXPIRED',
  'ESCALATED',
  'FAILED_INTERNAL',
] as const;

export type OrchestrationState = (typeof ORCHESTRATION_STATES)[number];

const TERMINAL: ReadonlySet<OrchestrationState> = new Set([
  'SATISFIED',
  'EXHAUSTED',
  'EXPIRED',
  'ESCALATED',
  'FAILED_INTERNAL',
]);

/**
 * States in which a broadcast may already be in flight at KeeperHub. A process that dies
 * in one of these must reconcile by replaying the stored idempotency key before it is
 * allowed to plan a new attempt, or it can double-submit.
 */
const IN_FLIGHT: ReadonlySet<OrchestrationState> = new Set([
  'SUBMITTING',
  'AWAITING_KEEPERHUB',
  'AWAITING_CONFIRMATIONS',
]);

export function isTerminalOrchestrationState(state: OrchestrationState): boolean {
  return TERMINAL.has(state);
}

export function requiresIdempotentRecovery(state: OrchestrationState): boolean {
  return IN_FLIGHT.has(state);
}

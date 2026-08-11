import { allCovenantStatusNames, ORCHESTRATION_STATES } from '@resurv/domain';
import { describe, expect, it } from 'vitest';
import {
  attemptStatusEnum,
  attempts,
  keeperhubExecutions,
  onchainStatusEnum,
} from '../src/schema.ts';

describe('schema agrees with the domain model', () => {
  it('onchain_status enum matches CovenantStatus names in ordinal order', () => {
    expect([...onchainStatusEnum.enumValues]).toStrictEqual([...allCovenantStatusNames()]);
  });

  it('attempt_status enum matches the offchain orchestration states', () => {
    expect([...attemptStatusEnum.enumValues]).toStrictEqual([...ORCHESTRATION_STATES]);
  });
});

describe('crash-recovery columns', () => {
  it('records the idempotency key hash as NOT NULL, since it is the recovery primitive', () => {
    expect(keeperhubExecutions.idempotencyKeyHash.notNull).toBe(true);
  });

  it('allows a null execution_id, because the 202 may never be observed', () => {
    expect(keeperhubExecutions.executionId.notNull).toBe(false);
  });

  it('allows a null transaction hash, because /contract-call omits it on the 202', () => {
    expect(keeperhubExecutions.transactionHash.notNull).toBe(false);
  });

  it('requires a semantic attempt id so a replay cannot create a second attempt', () => {
    expect(attempts.semanticAttemptId.notNull).toBe(true);
  });
});

describe('uint256 quantities are not truncated', () => {
  it('stores fee, gas and observed values as numeric(78,0), not bigint', () => {
    expect(keeperhubExecutions.gasUsed.dataType).toBe('string');
    expect(keeperhubExecutions.gasPriceWei.dataType).toBe('string');
  });
});

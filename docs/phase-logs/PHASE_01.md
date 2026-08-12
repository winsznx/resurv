# Phase 1, reference model and atomic contracts

Date: 2026-08-12. Base commit: `35f3d68`. Gate: **PASS**.

## Objective

PRD Phase 1: a pure reference model, the covenant manager, the interfaces, the demo vault, the
two adapters, the safe-state verifier, and unit, fuzz and invariant tests. Exit gate: a false
verifier result reverts target state, covenant state and payment; the fee can move only once;
duplicate trigger and duplicate attempt tests pass.

Phase 0.5 added a second obligation that was not in the PRD: implement the attempt lifecycle it
measured, in `packages/domain`, with the same reference-model treatment ADR-009 requires.

## Work completed

### The attempt lifecycle

`packages/domain/src/attempt-state.ts` transcribes section 8 of the Phase 0.5 report: ten
states, ten transitions, six terminal, and one self-transition. There is no `ACCEPTED` and no
`PENDING`, because measurement removed them.

Two classifiers carry the advancement rule:

- `classifyBroadcastResponse` reads the body, never the status code, and its most positive
  answer is a *candidate* that a chain read still has to confirm. The measured `P09` shape
  (202, `status: failed`, null hash, empty receipts) is the only input that produces
  `EXECUTED_NO_EFFECT`, and even that carries `requiresChainConfirmation: true`.
- `classifyChainEvidence` is the only function in RESURV allowed to produce a terminal attempt
  state involving an onchain effect. It is exhaustively tested over its whole input space
  (3 receipt statuses × 2⁵ booleans = 96 points) against four safety properties rather than
  against a duplicated implementation.

`test/model/attempt-state-reference.ts` is the oracle: a flat character grid, structurally
unlike the production record of arrays, transcribed by hand and importing nothing from `src`.

### Contracts

| File | What it is |
|---|---|
| `src/ResurvCovenantManager.sol` | The covenant. 14,386 bytes of runtime |
| `src/actions/PauseAction.sol` | Primary capability: `DemoVault.pause()` |
| `src/actions/EvacuateERC20Action.sol` | Fallback capability: drain to a committed recipient |
| `src/verifiers/VaultSafeStateVerifier.sol` | `paused OR (vault empty AND safe received enough)` |
| `src/demo/DemoVault.sol` | The protocol being recovered, with two separately held roles |
| `src/demo/TestUSD.sol` | Six-decimal test token with an open mint |

Decisions worth naming:

- **Constructors take every role as an argument.** The contracts are deployed through a CREATE2
  factory, so `msg.sender` in a constructor is the factory. A contract that granted admin to
  `msg.sender` would hand the factory the keys. See ADR-014.
- **Adapters are bound to the manager.** Each holds an immutable `manager` address and refuses
  every other caller, so holding the vault's role is not enough to use the capability.
- **The fee has two independent guards.** Terminal states are absorbing, and `_settleEscrow`
  refuses a second call through `feeSettled`. A third flag, `funded`, exists because a
  cancelled DRAFT covenant that read the pooled escrow balance would have withdrawn a sibling
  covenant's fee. That was a real bug, found while writing the test that now pins it.
- **`fundAndArm` measures what arrives.** A fee-on-transfer token cannot arm a covenant.
- **Expiry treats a reverting verifier as "not verifiable" and refunds.** Everywhere else a
  reverting verifier fails the attempt closed. Escrow trapped behind a broken oracle forever is
  the worse failure.
- **`finalizeAlreadySatisfied` pays no fee in v1** and refunds the requester, because no
  recovery action was taken. PRD 10.8 left this open; this is the conservative reading.
- **Eight `block.timestamp` comparisons carry per-site lint suppressions**, not a project-wide
  exclusion, so the lint keeps firing on any new comparison nobody has reasoned about.

### Tests

| Suite | Tests |
|---|---|
| `CovenantLifecycle.t.sol` | 43 |
| `Adversarial.t.sol` | 13 |
| `CovenantFuzz.t.sol` | 9 at 512 runs |
| `CovenantInvariant.t.sol` | 8 invariants at 256 runs × depth 128 |
| `CovenantStatus.t.sol`, `CovenantStatusReference.t.sol`, `CovenantStatusInvariant.t.sol` | 26, unchanged |
| **Foundry total** | **99** (was 26) |
| `@resurv/domain` | 63 (was 34) |
| **TypeScript substantive total** | **620** (was 591) |

Invariant depth was raised from 64 to 128 for a measured reason: nine handler entry points at
depth 64 gave roughly seven calls each, and a covenant needs create, fund, trigger and attempt
in that order before anything can happen. Behavioral coverage per run went from *two covenants
created, zero triggers accepted, zero successful attempts* to *sixteen created, ten armed, six
triggers, fifteen attempts, three succeeding, and attempts fired at terminal covenants*. The
`afterInvariant` block prints those numbers on every run.

An earlier version of the handler toggled the global pause on half its calls, which left the
manager paused for most of every run. The suite was green and it was measuring almost nothing.

## Mutation results

Eight deliberate defects, applied one at a time to committed source, full suite run each time.

| # | Mutation | Detected by |
|---|---|---|
| 1 | `executeAttempt` no longer reverts on a false outcome | 8 tests, including the invariant that a satisfied covenant had a true verifier |
| 2 | the attempt id is never burned | `test_sameSemanticAttemptCannotBeReplayed`, `test_attemptIdBurnBlocksAReplayOnAnOpenCovenant` |
| 3 | `_settleEscrow` ignores `funded` | `test_cancellingAnUnfundedDraftCannotDrainAnotherCovenantsEscrow`, `invariant_escrowConservation` |
| 4 | the trigger nonce is not consumed | `test_duplicateTriggerIsRejectedOnTwoIndependentGrounds`, `invariant_triggerNonceNeverReplays` |
| 5 | the verifier threshold is off by one | `testFuzz_thresholdIsExactToTheUnit` |
| 6 | the action config commitment is unchecked | `test_uncommittedActionConfigIsRejected`, `testFuzz_anyConfigDriftIsRejected` |
| 7 | `fundAndArm` does not measure the delivered amount | `test_aFeeOnTransferTokenCannotArmACovenant` |
| 8 | `executeAttempt` accepts an `ARMED` covenant | **survived** |

Mutation 8 is the one worth recording. Weakening the status check so that an armed but never
triggered covenant could be attempted left the entire suite green: a responder would have been
paid for recovering from an incident that never happened. Two tests and one invariant were
added, and the mutation is now caught three ways. It is in this table because a mutation
campaign that only reports successes is not an instrument.

## Architecture changes

- `packages/domain` gains the attempt state machine and its reference model. ADR-013 is now
  implemented at the model level; the orchestrator that uses it is Phase 3.
- `foundry.toml` gains `ignored_warnings_from = ["lib"]`, because OpenZeppelin 5.6.1 uses
  `error` as an identifier and solc 0.8.36 warns about it. Excluding the warning by code would
  have silenced it in our own contracts too.
- `foundry.toml` invariant depth 64 → 128.

## Claims changed

| Claim | Was | Now |
|---|---|---|
| An atomic attempt reverts the action when the outcome is false | ASSUMED | **VERIFIED (local)** |
| Successful action, verifier and fee release share one transaction | ASSUMED | **VERIFIED (local)** |
| A duplicate trigger cannot produce a second payment | ASSUMED | **VERIFIED (local)** |

"VERIFIED (local)" is a new qualifier and it is doing work: these are Foundry results against a
local EVM, not a deployed contract on Base Sepolia. Rung 8 of the proof ladder is still not
reached and nothing here may be presented as if it were.

## Security findings

- The `funded` flag bug, found and fixed during implementation, described above.
- Mutation 8, found and fixed, described above.
- A reverting verifier can block `executeAttempt` and `finalizeAlreadySatisfied` indefinitely,
  which is the correct fail-closed behavior, and cannot block `expireCovenant`. Documented
  rather than mitigated further.
- `finalizeAlreadySatisfied` is permissionless. An observer who notices the outcome is already
  true can close a triggered covenant and refund the requester, denying a responder the chance
  to earn the fee. The outcome is satisfied by definition in that case, so this is accepted and
  recorded rather than fixed.

## Known limitations

- No contract is deployed. Every result here is a local EVM result.
- The demo contracts are demo contracts. `TestUSD` has an open mint on purpose.
- Gas snapshots are not committed. `forge build --sizes` runs in the gate; a snapshot diff does
  not.
- Fork tests against Base Sepolia are not written. Rung 6 remains unreached.

## Exit gate

| Criterion | Result |
|---|---|
| False verifier result reverts target state, covenant state and payment | PASS, `test_falseOutcomeRevertsTheActionTheCountersTheStatusAndTheFee` plus mutation 1 |
| Fee can move only once | PASS, `invariant_feeMovesAtMostOncePerCovenant` plus mutations 2 and 3 |
| Duplicate trigger and attempt tests pass | PASS, plus mutations 2, 4 and 8 |
| Contract coverage reviewed | PARTIAL. `forge coverage` exists as a script and its report is not committed; coverage was reasoned about through mutation instead, which is the stronger instrument and not a substitute for the number |
| `pnpm gate` | PASS, exit 0 |

## Next phase

Phase 2: the production KeeperHub client, built against the measured semantics rather than the
documentation, and the deployment path. The deployment question is the near-term risk: the
KeeperHub organization wallet holds no native currency, so contracts reach Base Sepolia through
a CREATE2 factory called by a sponsored KeeperHub contract call, or they do not reach it at all
without external funding.

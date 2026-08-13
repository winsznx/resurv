# Phase 6: three independent reviews, and what they found

Date: 2026-08-12. Base commit: `d7907c2`. Result commit: `07e8db7`.

Three read-only specialist agents were run in isolated worktrees against the finished build:
`contracts-auditor`, `keeperhub-integrator` and `test-reviewer`. **All three returned FAIL.**
That is the honest headline and it is the reason this log exists: a review that finds nothing on
a build this size has not looked hard enough.

Every finding is listed. Six were fixed and are pinned by regression tests, five are accepted or
deferred with reasons.

---

## Fixed: two ways a covenant's escrow could be lost permanently

Both were found by the contracts audit, both came with working proof-of-concept tests, and both
are reachable through ordinary operation rather than an attack.

### H-1. Every exit closed at once

`expireCovenant` refuses to refund while the outcome is true, which is correct: the escrow is
not the requester's to reclaim once the covenant's promise has been kept.
`finalizeAlreadySatisfied` was gated on the deadline. `executeAttempt` was too. `cancelCovenant`
stops at the trigger.

So a covenant whose outcome became true near its deadline had no exit at all. The escrow was
stuck in `TRIGGERED` forever, on an immutable contract with no rescue path. And the sequence
that gets there is the ordinary one: the requester's own team pauses the vault by hand, which is
what an incident response looks like, and the deadline passes while nobody is watching a
covenant they believe is handled.

**Fix.** `finalizeAlreadySatisfied` is no longer deadline-gated. The precondition that matters
is that the outcome is true, and that does not stop being true at a deadline.

**Pinned by** `test_aSatisfiedCovenantCanStillBeClosedAfterItsDeadline` and
`test_aFundedCovenantAlwaysHasAnExit`, which states the liveness property directly rather than
testing one path through it.

### H-2. The `try/catch` did not catch what it was written to catch

`expireCovenant` wrapped the verifier call in `try/catch` so that a verifier which cannot answer
would not trap the escrow. Two verifier shapes defeat that, and both pass covenant creation:

- **A codeless verifier.** Solidity emits an `extcodesize` check before a call that expects
  return data, and that check reverts in the *caller's* frame, outside the `catch`.
- **Malformed return data.** ABI decoding failure is also raised in the caller's frame.

Either one reverted `expireCovenant` outright, which is the same permanent lock as H-1.

**Fix.** A low-level `staticcall` with an explicit `returndatasize == 96` check. Anything else is
"not verifiable" and the refund proceeds.

**Pinned by** `test_aCodelessVerifierDoesNotTrapTheEscrow` and
`test_aVerifierWithShortReturnDataDoesNotTrapTheEscrow`.

### M-1, folded into the same fix. The caller chose the gas

A bare `catch` cannot tell "the verifier could not answer" from "I did not give it enough gas to
answer". Under EIP-150 a child call gets 63/64 of what is left, so a caller could starve an
honest, expensive verifier into silence and take the refund over an outcome that was actually
true — falsifying PRD invariant 10.14.8 directly.

**Fix.** A `VERIFIER_GAS_FLOOR` of 1,000,000 before the call, plus the standard post-call check
that the child did not consume essentially everything it was given. A starved verifier reverts
the expiry rather than granting it. Not verifiable refunds; starved does not.

**Pinned by** `test_expiryRefusesATrueOutcomeEvenWhenTheCallerStarvesTheVerifier`, which runs the
same covenant at 60M gas and at 2M and asserts opposite outcomes.

---

## Fixed: two reconciliation defects, one of them unsafe

### The log search restarted at the wrong block

Found by the KeeperHub review. `AttemptPlan.fromBlock` was recomputed from the live chain head
every time the CLI built a plan, and the orchestrator used that value rather than a stored one.
A process that died after sending, and was re-run later, therefore searched for its own effect
starting at the *current* head — skipping the block the transaction actually landed in.

When KeeperHub's key replay also cannot produce a hash, which is the exact `P11` scenario this
project's strongest evidence is built on, the log search is the only remaining route. It could
now come back empty for an attempt that succeeded, and the reconciler would conclude
`PROVEN_NOT_BROADCAST`. That is the verdict that invites a second economic effect, which is the
one thing `CLAUDE.md` calls non-negotiable.

**Fix.** `fromBlock` is part of `AttemptRecord`, persisted with the idempotency key, and the
reconciler uses the stored value.

**Pinned by** `searches the chain from the block the attempt started at, not the block it
resumed at`, which asserts the actual `eth_getLogs` filter.

### The settlement clock restarted on every invocation

Same review. `start: now()` was set fresh per call, so a resumed process began its settlement
window again from zero and `PROVEN_NOT_BROADCAST` was effectively unreachable through the
documented "come back later" recovery. Safe direction, and it quietly turned a bounded
resolution into an unbounded one.

**Fix.** The window is measured from `record.createdAt`.

**Pinned by** `measures the settlement window from the durable commit, not from this invocation`.

---

## Fixed: the one place the exact-once machinery was defeated by its own caller

Found by the test review, and it is the finding worth reading twice. `execute.ts` never rotates
an idempotency key — that is tested from several angles. But its only production caller,
`bin/demo.ts`, derived every semantic attempt id from a run label containing a fresh timestamp,
and the trigger step's request body carried a validity window derived from `Date.now()`.

A restart therefore produced different semantic attempt ids, `AttemptStore.reserve` found no
previous claim, and a fresh idempotency namespace was minted — defeating, at the only place it
matters, the guarantee the rest of the suite spent real effort proving.

**Fix.** `packages/cli/src/run-state.ts`. The run label and the signed trigger are written to
`.resurv/demo-run.json`, and `--resume` reuses them. The trigger authority's private key is not
persisted and never will be: what is written down is the signature it produced, which is enough
to replay the trigger and not enough to author a different one.

---

## Fixed: three mutations that survived the whole suite

The Phase 1 campaign ran eight mutations and reported one survivor. The audit ran three more and
all three survived, which says the campaign was not adversarial enough rather than that the
suite was good.

| Mutation | Why it survived | Now caught by |
|---|---|---|
| Remove `EXECUTING` from the attempt status check | `EXECUTING` is written and overwritten inside one transaction and never persists, so both branches are dead code | Documented rather than tested. See "accepted" below |
| Remove the `feeSettled` guard from `_settleEscrow` | The terminal-state rule always got there first, so the second layer was never reached | ~~`test_theFeeSettledGuardIsReachableAndHolds`~~ — **this was wrong, and a later campaign proved it.** That test passes with the guard deleted, against all 114 tests including the fee invariant. Its own comment admitted it drives only status-gated paths. Now genuinely caught by `test_theFeeSettledFlagBlocksASecondSettlementWithNoStatusCheckInFrontOfIt`, via `ManagerHarness`. See `PHASE_07_FINAL_AUDIT.md` |
| Permit `ARMED -> EXPIRED` in `expireCovenant` | **`CovenantStatusLib.canTransition` was never called from production code.** The library was exhaustively tested against a reference model, and nothing tied the manager's actual status writes to it | `test_anArmedCovenantCannotBeExpired` and `test_everyStatusTransitionTheManagerPerformsIsOneTheLibraryPermits` |

The third is the one that matters. Two hundred tests of a state machine prove nothing about a
contract that does not consult it.

---

## Fixed: three overclaims in source comments and one weak check

- `packages/orchestrator/src/file-store.ts` claimed a `SupabaseAttemptStore` existed alongside
  it and that a conformance suite ran against both. Neither was true. Corrected.
- `ResurvCovenantManager`'s header claimed `usedAttemptIds` was the permanent bound on duplicate
  effects. It bounds one attempt *identity*; `attemptSequence` is the caller's, so `maxAttempts`
  and the orchestrator's durable record are what bound repeats. Corrected, and the boundary is
  now pinned by `test_theAttemptBurnBoundsOneIdentityAndTheCountersBoundTheRest`.
- The invariant handler's `afterInvariant` figures describe the **last run only**, not the
  256-run campaign — off by roughly two orders of magnitude as previously framed. The block now
  says so in its first line.
- `/api/proof/summary`'s `recipientReceivedTheMinimum` asserted only that the balance was
  non-zero, which is weaker than the covenant promised and would have passed on a dust delivery.
  It now decodes the committed verifier context and compares against the declared minimum.

---

## Accepted, with reasons

**M-2. A covenant already satisfied at trigger time can still pay a full fee.** `executeAttempt`
discards the `satisfied` flag from its pre-state read, so an executor can run an action against
an already-safe covenant and take the fee instead of the zero-fee `finalizeAlreadySatisfied`
route. The PRD's own illustrative `executeAttempt` has the same gap, so the contract is faithful
to the specification and the specification is what is wrong. Accepted for v1 and recorded in
`docs/CLAIMS.md`; the fix is a pre-state check that belongs in a version with a considered fee
policy, not in a deadline patch.

**M-3. A requester who can satisfy their own outcome can reclaim the escrow**, and a pauser can
block the payout window until the deadline. Both are within the design: the requester holds the
authority the covenant granted them, and the pause deliberately never blocks a refund. Recorded
as a residual rather than fixed, because fixing it means a fee policy with responder protections
that v1 does not have.

**M-4's underlying fact**, that `attemptSequence` is caller-chosen, is accepted. `maxAttempts`
is the bound and the comment now says so.

**The dead `EXECUTING` branches.** Removing them would be a real simplification and a real risk
this close to a deadline, on contracts that are already deployed and already carry the live
proof. Documented here instead.

**L-1, L-2, L-3.** The fee-token allowlist is not rechecked at funding; `safeBaseline` is not
bound to reality at arm time; `TestUSD.mint` is permissionless on the live deployment. All three
are true, all three are demo-scoped or admin-trusted, and none creates a theft path. Recorded.

---

## Deferred with justification

- **A racy `AttemptStore` double.** The current concurrency test cannot interleave, because
  `InMemoryAttemptStore.reserve` is synchronous. The design it protects — a durable claim before
  the send — is right and is tested against a real journal, but the *race* is not exercised. The
  test the reviewer specified is the right one and it belongs with the Supabase store, which
  does not exist yet.
- **The remaining PRD 21.8 chaos cases**, Slither, container and dependency scanning,
  OpenTelemetry, alerts, a restore rehearsal. All need infrastructure this build does not have.
- **A fork suite (proof-ladder rung 6).** The contracts run on the real chain instead, which is
  a different and in some ways stronger statement. `docs/PROOF_LADDER.md` marks rung 6 not
  reached rather than blurring the two.

---

## After the fixes

The contracts were redeployed under the `resurv/v3` salt namespace and the canonical covenant
was re-run end to end against the fixed code. Addresses, transactions and the new receipt are in
`docs/DEPLOYMENTS.md` and `docs/proof/canonical-covenant.json`.

| | Before | After |
|---|---|---|
| Foundry | 102 | **114** |
| TypeScript | 703 | **705** |
| `pnpm gate` | exit 0 | exit 0 |
| Clean-room `TURBO_FORCE=true pnpm gate` | not run at this commit | exit 0, `Cached: 0` |

## What a fresh reviewer should attack first

The three findings above that were accepted rather than fixed, in this order: M-2, because it is
the one where a reasonable person could conclude the fee policy is wrong rather than merely
under-specified; M-3, because it decides whether a responder can be relied on to show up at all;
and the racy-store gap, because it is the one place where a test asserts a property it cannot
actually observe.

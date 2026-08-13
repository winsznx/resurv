# Phase 7 — the final audit round

Date: 2026-08-12. Four in-repo reviewers, run against the finished build in isolated worktrees:
`contracts-auditor`, `keeperhub-integrator`, `test-reviewer`, `claim-auditor`.

**Three returned FAIL.** This is the log of what they found and what was done about it. They are
agents in this repository with no write access. RESURV has had no external security audit and
does not claim one.

The short version: the previous round's fixes were incomplete in the same shape as the defects
they closed, one regression test was a false positive, and one claim in the ledger was provably
wrong. All of that is corrected below. Two findings are accepted rather than fixed, and named.

---

## 1. What the second contracts round found

Every finding came with a working proof-of-concept the reviewer ran. Each fix below was checked
the same way it was found: revert the fix, run the suite, confirm exactly one test fails.

### H-A. A dirty boolean reverted the expiry in the manager's own frame

`_refuseExpiryIfOutcomeIsTrue` had been rewritten in Phase 6 from a `try/catch` to a low-level
`staticcall` plus a length check, on the reasoning that this was "the only shape that actually
treats 'cannot answer' as an answer." It was not.

A verifier returning exactly 96 well-formed bytes whose first word is `2` passes the length check
and then reverts inside `abi.decode`, because Solidity's decoder validates booleans and raises in
the *caller's* frame. `finalizeAlreadySatisfied` and the attempt's pre-state read are typed calls
and hit the same validator. Every exit shut, permanently, on an immutable contract. This is H-2
returning in a third shape, having already returned in a second.

**Fixed.** The bool word is read with assembly and any value but 0 or 1 is treated like every
other kind of silence. Pinned by `test_aVerifierReturningADirtyBooleanDoesNotTrapTheEscrow`.

### M-B. An over-long return let the expiry refund over a true outcome

Solidity's typed decoder ignores a trailing tail on static types. A verifier returning four words
answered `true` to `executeAttempt`, `finalizeAlreadySatisfied` and `readOutcome`, while the
expiry's `!= 96` check called the same verifier "not conforming" and refunded. One contract, two
readings of one verifier, and a direct falsification of PRD invariant 10.14.8.

**Fixed.** `< 96`, and the tail is ignored exactly as the decoder ignores it. Pinned by
`test_expiryRefusesATrueOutcomeReturnedWithATrailingTail`.

### M-A. A global pause closed the last exit

`finalizeAlreadySatisfied` carried `whenNotPaused`. `expireCovenant` deliberately does not, with
the comment "a pause must never strand somebody else's escrow", but it refuses while the outcome
is true. So a covenant whose outcome came true past its deadline, with the pause on, had all four
exits shut. That is H-1 restored, one role away, and PRD 10.11 says a pause must not stop refunds
for expired covenants.

**Fixed.** The modifier is gone. The function moves escrow to the requester and cannot pay a fee,
so it is a refund by the same argument that exempts `expireCovenant` and `cancelCovenant`. Pinned
by `test_aGlobalPauseCannotStrandEscrowOnACovenantWhoseOutcomeCameTrue`.

### The mutation gaps

The reviewer ran 65 mutants and 19 survived. The three worth having are now closed, each verified
by re-applying the mutation:

| Mutation | What nothing was testing | Now caught by |
|---|---|---|
| Drop the verifier-context commitment check in `expireCovenant` | An expirer could supply a context the verifier answers false to and refund over a true outcome | `test_expiryRefusesAVerifierContextTheCovenantDidNotCommitTo` |
| `finalizeAlreadySatisfied` accepts any non-terminal status | An `ARMED -> SATISFIED` edge the reference machine forbids, closing a covenant nobody triggered | `test_finalizationRefusesACovenantThatWasNeverTriggered` |
| Drop the `usedAttemptIds` replay guard | The refusal branch was never reached; the existing test burns an id and never issues the call the guard would refuse | `test_aBurnedAttemptIdIsRefusedOnASecondUse` |

### Accepted, not fixed

**H-B. A verifier that runs out of gas at any budget has no exit.** The starvation guard is sound
against a stingy caller, and the reviewer could not defeat it. The cost is on the other side: the
contract cannot distinguish "the caller was stingy" from "this verifier's honest cost exceeds the
block gas limit", and the second case has no exit at all. Every fix reopens the attack the guard
closes. The real remedy is L-B.

**L-B. No verifier or adapter validation at creation.** Both are accepted as any non-zero address,
including an EOA. This is the enabling condition for H-A, H-B and M-B, and a conformance probe at
creation is the structural fix. It is a v2 change: it needs its own design and its own review, and
landing it hours before a deadline on contracts that are already deployed and verified would be
worse engineering than naming it.

Both are in `docs/CLAIMS.md` and in the README's limitations.

---

## 2. The deployed contracts do not have these fixes

Stated plainly because it is the most important sentence in this document.

The bytecode at the six Base Sepolia addresses was compiled from commit `2ccf02f`. H-A, M-B and
M-A are fixed **in this repository** and are **still present in the deployed instance**.
Redeploying is a human step that also invalidates the canonical receipt every public surface
cites, so it was not done.

What that does and does not mean:

- The canonical covenant is unaffected. It uses the shipped `VaultSafeStateVerifier`, which
  answers in exactly 96 bytes with a clean boolean, and the manager was never paused. All three
  defects require a verifier the requester chose to be malformed, or the admin to pause.
- Anyone arming a covenant against the deployed manager with their own verifier is exposed to all
  three. Nobody should, and nothing invites them to: this is a testnet demo.
- The Sourcify `match` at those addresses is still accurate. It attests that the deployed bytecode
  reproduces from commit `2ccf02f`, which it does. It has never attested that `main` matches.

The reviewer independently confirmed the deployed bytecode reproduces from source with `cast code`
against a public node, byte for byte, with the three immutable-bearing contracts matching after
masking their immutable slots and every masked value decoding correctly.

---

## 3. What the test reviewer found

A reverted mutation campaign, run for real, not cited.

- **`test_theFeeSettledGuardIsReachableAndHolds` was a false positive.** It passes with the
  `feeSettled` guard deleted, against all 114 tests including the 256-run fee invariant. Its own
  comment admitted it drove only status-gated paths. `PHASE_06_REVIEW.md` recorded that mutation
  as caught; that entry is now corrected in place rather than deleted.
- **An off-by-one in the reconciliation loop survived the whole suite.** `round <= maxRounds`
  weakened to `round < maxRounds` failed nothing, because no test asserted a round count and every
  test double returned one static answer for the whole run. Bounded polling that converges as
  evidence arrives is the loop's entire job and it had never been exercised.
- **`prepareCall` had no tests**, despite being the single place every live write derives its
  canonical body, hash, idempotency key and semantic attempt id.
- **The proof page's timeline could misstate a step**, because its narrative is keyed by label and
  the state chip is read live, with nothing tying them together, and every page test runs against
  the one committed receipt.

All four are closed. The harness that makes the first one testable is described above;
`packages/orchestrator/test/execute.test.ts` gained a `the reconciliation loop itself` block that
counts waits exactly; `packages/cli/test/call.test.ts` is new; the timeline gained unit tests
driven by synthetic steps rather than the committed receipt.

---

## 4. What the KeeperHub reviewer found

Returned PASS with follow-ups. Three were fixed:

- **`fromBlock` fell back to genesis when the head read failed**, and `getLogs` reported "every
  origin errored" and "the origins agree there is nothing" identically. An RPC outage could
  therefore become a proof that nothing was broadcast. `prepareCall` now refuses to plan an
  attempt with no anchor, `findEffectOnChain` returns a discriminated result, and the settlement
  window cannot elapse over a search that failed.
- **An unreadable `createdAt` silently restarted the settlement clock**, reproducing the exact
  defect the durable anchor removed. It is now an integrity error.
- **The `kh_`/`wfb_` diagnostic was dead code on the path that matters.** It was reachable only
  from the Worker's health route, never from the CLI that actually spends the credential. It now
  runs before the first request.

And one that changed the deployment: **the Worker required a live organization credential** so
that one health route could report its presence. Nothing else in the Worker used it. That put a
write-capable key on a public origin to buy a readiness signal. `KEEPERHUB_API_KEY` is now optional
in `workerEnvSchema`, the deployed Worker holds no secret at all, and a test pins that a bare
environment answers `200 ok`.

Left open and documented: `Retry-After`, `X-RateLimit-*` and `X-Poll-Interval-Hint` are parsed and
recorded but not acted on; the reconciler always sleeps a fixed interval. `docs/CLAIMS.md` and
`docs/RUNBOOKS.md` already said the 429 branch was never triggered, so nothing overclaimed.

---

## 5. What the claim auditor found

Four stale or overstated statements, all corrected: a README implying a Cloudflare deployment that
has not happened, a build report saying the contracts were unverified when they are Sourcify
`match`, a claim ledger with no row for that verification and a stale "no CI has ever run" note,
and a test-count table that did not sum to the total two paragraphs above it.

The CI row is now `VERIFIED (single run)` and says so: one green run on one runner, not a promise
about future ones.

---

## 6. Test counts after this round

| Suite | Before | After |
|---|---|---|
| Foundry | 114 | 122 |
| TypeScript | 705 | 723 |

Every added test was checked by mutation. None of them passes against the code it was written to
protect once that code is reverted.

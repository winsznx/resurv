# Proof ladder

From PRD 24. The rule is one line long and it is the important one:

> Do not present a lower rung as a higher one.

The hackathon submission must reach at least rung 9.

| # | Rung | Status | Evidence |
|---|---|---|---|
| 1 | Plain reference model | **REACHED** | `packages/domain` covenant and orchestration state machines, 17 tests |
| 2 | Contract unit tests | **PARTIAL** | 21 unit and fuzz tests on `CovenantStatusLib`, including exhaustive equivalence with an independent reference model over all 64 ordered pairs. The covenant contract does not exist yet, so this rung is reached for the state machine only |
| 3 | Fuzz and invariant tests | **PARTIAL** | 3 fuzz tests at 512 runs, 5 invariants at 256 runs × depth 64, every call a real transition attempt, judged against the reference model. Confirmed by 5 mutations, each detected. Same caveat: model only. The Phase 0 form of this rung was rated on a suite that could not detect a broken `isTerminal` |
| 4 | Local full lifecycle | not reached | |
| 5 | KeeperHub seam tests | **reached** | `packages/seam-probe`, 16 scenarios run live 2026-08-12, evidence committed under `docs/phase-logs/evidence/phase-00-5/` and asserted by 42 offline tests that read it. Every KeeperHub row in `docs/CLAIMS.md` was re-measured from here; none carries `MEASURED_EXTERNAL` any more |
| 6 | Base fork integration | not reached | |
| 7 | Base Sepolia deployment | not reached | |
| 8 | Real KeeperHub atomic attempt | not reached | This is the submission's headline artifact |
| 9 | Public proof page and verification CLI | not reached | Minimum bar for submission |
| 10 | Capped Base mainnet canary | out of scope for v1 | |
| 11 | Independent audit and production launch | out of scope for v1 | |

## How a rung gets marked reached

Evidence committed to this repository, produced by a command anyone can rerun. An external
repository's measurement is strong prior information and does not promote a rung here.

Two commands look like evidence and are not. `pnpm test:integration` and `pnpm test:e2e` run
with `--passWithNoTests` against directories holding a README and nothing else. They exit 0
while asserting nothing and they promote no rung. Rung 4 is where the first of them starts
mattering.

A third thing looks like evidence and is not: an experiment that exists. Between the two Phase
0.5 sessions `packages/seam-probe` was complete, typechecked and covered by offline tests, and
had produced zero measurements. It promoted nothing until it ran and its output was committed.
That gap is worth remembering the next time a phase reports a harness as an achievement.

A green test run is evidence only if a failure is reachable. The Phase 0 invariant suite exited
0 with a definition of "terminal" that was false for every state, which is why rungs 2 and 3
are now backed by mutation results rather than by pass counts.

## The gap that matters most right now

Rung 8: an atomic attempt where a false outcome reverts the whole thing. It needs the covenant
contract, which does not exist, so it is Phase 1's first proof.

Phase 0.5 changed what reaching it will take, in two ways.

**A receipt is not enough.** A transaction receipt with status `0x1` does not prove the attempt
succeeded, because `safe_inner_failure` is a documented receipt status in which the outer
transaction succeeds and the inner call does not. Reaching rung 8 means showing the expected
event and `executedCall.reverted !== true`, not the receipt. `docs/THREAT_MODEL.md` T15.

**The revert half could not be observed, for a reason nobody predicted.** The probe tried twice
to produce a broadcast that reverts onchain and neither route worked: KeeperHub refuses to
broadcast a call whose gas estimation reverts, three times out of three, and `gasLimitMultiplier`
below 1.0 is accepted and ignored. So the story the product is built on, a false outcome
reverting the attempt, has to be told through the covenant's own revert rather than through a
KeeperHub status. Whether a funded organization wallet would change that is untested and is the
single cheapest experiment left.

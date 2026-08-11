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
| 5 | KeeperHub seam tests | not reached from this repository | Equivalent probes were run from `keeperhub-flightcheck` and are recorded as `MEASURED_EXTERNAL` in `docs/CLAIMS.md`. That is not this rung |
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

A green test run is evidence only if a failure is reachable. The Phase 0 invariant suite exited
0 with a definition of "terminal" that was false for every state, which is why rungs 2 and 3
are now backed by mutation results rather than by pass counts.

## The gap that matters most right now

Rung 8 requires an atomic attempt where a false outcome reverts the whole thing. Nobody has
yet measured what KeeperHub returns when a broadcast transaction reverts onchain, as opposed
to a simulation predicting a revert. `receiptStatus` has a `reverted` value so the outcome is
representable, but whether an execution id and hash come back, what `status` settles to, and
whether the revert reason survives are all unknown. If a reverted attempt is indistinguishable
from a network failure, the proof page cannot tell the story the product is built on.

That probe belongs at the front of the next phase, ahead of any contract work.

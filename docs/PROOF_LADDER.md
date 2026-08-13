# Proof ladder

From PRD 24. The rule is one line long and it is the important one:

> Do not present a lower rung as a higher one.

The hackathon submission must reach at least rung 9.

| # | Rung | Status | Evidence |
|---|---|---|---|
| 1 | Plain reference model | **REACHED** | `packages/domain`: the covenant state machine and the measured attempt lifecycle, each with an independent reference model, 63 tests |
| 2 | Contract unit tests | **REACHED** | 109 Foundry unit and fuzz tests across `CovenantLifecycle`, `Adversarial`, `CovenantFuzz`, `AuditRegressions` and the state-machine suites |
| 3 | Fuzz and invariant tests | **REACHED** | 9 fuzz tests at 512 runs; 8 covenant invariants plus 5 state-machine invariants at 256 runs × depth 128, judged against reference models. Confirmed by mutation across three campaigns. The third is the one that matters: it found a regression test that passed with the fund-loss guard it was named after deleted, and every test written since was checked by reverting its fix |
| 4 | Local full lifecycle | **REACHED** | `test_primaryRefused_fallbackSucceeds_andPaysInTheSameTransaction` runs the whole demo against a local EVM, including the refused primary and both replays |
| 5 | KeeperHub seam tests | **REACHED** | `packages/seam-probe`, 16 scenarios run live 2026-08-12, evidence committed, 42 offline tests asserting the findings against it |
| 6 | Base fork integration | **not reached** | No `--fork-url` suite exists. Superseded in practice by rung 7: the contracts are deployed on the real chain and the demo ran against them, which is a stronger statement than a fork test, and is not the same statement |
| 7 | Base Sepolia deployment | **REACHED, with one qualifier** | Six contracts and three configuration calls, `deployments/base-sepolia.json`, every address predicted offchain and matched, five of six verified on Sourcify at `match` level. The qualifier is below |
| 8 | Real KeeperHub atomic attempt | **REACHED** | [`0xef63ee11…`](https://sepolia.basescan.org/tx/0xef63ee114dea86da25f1d38802be8bfbdcce166a140f322d283f22a41f9c7e22): six logs in one transaction, the action, the verifier result, the state transition and the fee |
| 9 | Public proof page and verification | **REACHED, with one qualifier** | `apps/web` plus `/api/proof`, `/api/proof/summary`, `/api/deployment`. The qualifier is below |
| 10 | Capped Base mainnet canary | out of scope for v1 | |
| 11 | Independent audit and production launch | out of scope for v1 | |

## The qualifier on rung 7

Five of the six contracts are verified on Sourcify at `match` level. `ResurvCovenantManager` is
not: three submissions answered `no_match` and the cause is unresolved. Rung 7 is claimed for the
deployment, which is recorded, address-predicted and bytecode-compared. It is not claimed as
"all six publicly verified", because that is not true. `docs/DEPLOYMENTS.md`.

## The qualifier on rung 9

PRD 18.2 specifies a signed receipt and a `pnpm resurv verify --receipt` CLI that recomputes a
hash, checks a signature, and reports each check separately. What exists is the receipt, the page
that renders it, and a JSON endpoint whose `checks` object is nine booleans each reproducible
with one `cast` command.

What does not exist: the receipt is not signed, and there is no standalone verification CLI. The
signing key would be a ninth credential and the CLI would duplicate reads the page already does
in the visitor's own browser, so both were cut against the deadline rather than forgotten. Rung 9
is claimed on the page and the endpoint; the signature is not claimed at all.

## Rung 6, and why it is marked not reached

A fork suite would run the contracts against a snapshot of Base state. The deployment ran them
against Base Sepolia itself, and the covenant settled there. That is more than a fork test proves
about *this* deployment and less than a fork test proves about *robustness to real protocol
state*, because the demo protocol is `DemoVault` rather than a real one. Both statements are
true, and marking rung 6 reached would blur them.

## How a rung gets marked reached

Evidence committed to this repository, produced by a command anyone can rerun. An external
repository's measurement is strong prior information and does not promote a rung here.

Two commands used to look like evidence and no longer do. `pnpm test:integration` and
`pnpm test:e2e` ran with `--passWithNoTests` against directories holding a README, and exited 0
while asserting nothing. They now carry 14 specs between them, including one that fails if the
proof page ever displays a 32-byte value that appears in no committed artifact.

A third thing looks like evidence and is not: an experiment that exists. Between the two Phase
0.5 sessions `packages/seam-probe` was complete, typechecked and covered by offline tests, and
had produced zero measurements. It promoted nothing until it ran.

A green test run is evidence only if a failure is reachable. Rungs 2 and 3 are backed by mutation
results rather than by pass counts, and the mutation that survived the whole suite is recorded in
`docs/phase-logs/PHASE_01.md` alongside the seven that did not.

## What is still not proven

- **A broadcast transaction that reverts onchain.** Two routes were tried in Phase 0.5 and both
  failed: KeeperHub refuses to broadcast a call whose gas estimation reverts, and
  `gasLimitMultiplier` below 1.0 is ignored. `REVERTED` is implemented and unit-tested. Nothing
  may be said about how it presents.
- **`safe_inner_failure`.** Documented, never observed, handled conservatively. The demo executes
  on the direct-wallet path where the hazard does not arise, so this build could not have
  observed it even in principle.
- **Anything about mainnet, an audit, or sustained operation.** Rungs 10 and 11.

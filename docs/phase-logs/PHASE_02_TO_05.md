# Phases 2, 3, 5 and 7: the seam, the orchestrator, the live proof and the page

Date: 2026-08-12. Base commit: `42ee514`. Gates: **PASS**.

Four PRD phases in one log because they were built as one arc and finished within hours of each
other: the production KeeperHub client (Phase 2), the orchestrator around it (Phase 3), the
public proof surface (Phase 5) and the live Base Sepolia proof (Phase 7). Phases 4, 6 and 8 are
addressed at the end, two of them by explicit deferral.

## Objective

Take the lifecycle Phase 0.5 measured and Phase 1 modelled, and run it for real: deploy the
covenant contracts, settle one canonical covenant on Base Sepolia through KeeperHub, and publish
evidence a judge can check without a credential.

## What was built

| Package | What it does |
|---|---|
| `@resurv/keeperhub-client` (extended) | The production transport. Parses, records, and decides nothing |
| `@resurv/chain` (extended) | Two-origin RPC quorum, receipt projection, log search, CreateX constants |
| `@resurv/orchestrator` (new) | The attempt lifecycle executed: durable claim, send, reconcile |
| `@resurv/node-runtime` (new) | The credential loader, moved out of the probe so a product package need not depend on one |
| `@resurv/cli` (new) | `live:contracts` and `live:demo`, the two external-effect entry points |
| `@resurv/proof` (new) | The committed evidence, typed, imported by both the page and the Worker |
| `apps/web` | The public proof page |
| `apps/worker` | `/api/proof`, `/api/proof/summary`, `/api/deployment` |

### The deployment problem, and how it was solved

The KeeperHub organization wallet holds zero native currency, sponsorship pays a fee rather than
granting a balance, and the Direct Execution API has no deployment endpoint. `forge script
--broadcast` needs a funded key and a faucet trip, both human steps.

CreateX is deployed at `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed` on Base Sepolia and its
`deployCreate2(bytes32,bytes)` is an ordinary ABI function, so a deployment is a contract call and
is sponsored like any other. ADR-014. Verified before adopting it with `cast code` and `cast
selectors`, then verified again by the deployment itself: six contracts, six addresses computed
offchain before sending, six matches.

One consequence shaped every constructor: `msg.sender` inside a constructor is the factory. Every
RESURV contract takes its admin, pauser and executor as explicit arguments and none reads
`msg.sender`. A contract that granted `DEFAULT_ADMIN_ROLE` to `msg.sender` there would have
handed a public factory the keys to the escrow.

### One contract change the seam forced

`createCovenant(CovenantParams, ActionInput[])` could not be called through KeeperHub:
`functionArgs` is JSON, and the encoder answered

```
Failed to encode call: invalid address (argument="address", value=["0x146DAb…", "0xb0b0…", …])
```

reading the tuple's first element as the whole tuple. Every other call encoded cleanly, including
ones with `bytes` arguments, so the problem is nesting rather than dynamic types.
`createCovenantEncoded(bytes,bytes)` decodes into the identical structs and calls the identical
internal function. ADR-015, and two tests compare the two paths field by field.

### The reconciliation loop, and the bug the tests found

The loop follows PHASE_00_5 section 8 exactly. Two defects were found by writing the tests rather
than by reading the code:

1. **A 409 `idempotency_in_progress` used to short-circuit the round**, so the chain was never
   asked. That is precisely the case Phase 0.5's `P11` recovered from, where the key replay
   reported only that something was running and `eth_getLogs` found the transaction. Now the
   in-progress branch falls through to the chain search.
2. **An in-progress report used to have no effect on the settlement window.** With no execution id
   and no hash, the loop would conclude `PROVEN_NOT_BROADCAST` while KeeperHub was actively saying
   an execution was running. An in-flight report is positive evidence that an effect may still
   land, so it now suppresses that conclusion entirely, however long the window has been open.

Both are exactly the class of error the phase exists to prevent, and both were invisible until a
test scripted the sequence.

## Live results

Nine KeeperHub-executed transactions for the deployment, eight for the demo, plus simulations.

| | |
|---|---|
| Contracts | `deployments/base-sepolia.json`, six, all predicted |
| Covenant | `0xb8c1c6ecb47cd4ed69755ca28e651348e72d58700ecf63da6e2c25896265694d` |
| Success transaction | `0x9ea030674ca2e9ee8729bf00a6fbf53cd48320c23d0ae0a0b9780bb0da59dbcb` |
| Block, gas | 45397010, 245,531 |
| Terminal status | `SATISFIED` |
| Verifier, read live | `satisfied: true`, observed 1,000,000 |
| Vault, recipient, responder | 0 · 1.000000 rUSD · 1.000000 rUSD |
| Primary action | `SIMULATION_REJECTED`, HTTP 400, `failureKind: "revert"`, no transaction |
| Replays | trigger rejected, attempt rejected |

The success transaction's six logs, in order: `AttemptStarted`, `Transfer` (vault → recipient),
`VaultEvacuated`, `AttemptSucceeded`, `Transfer` (escrow → responder), `CovenantSatisfied`.
Confirmed independently with `cast receipt` against `https://sepolia.base.org` after the run.

One observation worth keeping: on the first deployment the reconciler reported *two RPC origins
materially disagree* for one round and refused to advance, then confirmed on the next round. One
origin had not yet seen the block. That is the control working, on its first outing, without
anybody arranging it.

## Tests

| Suite | Before | After |
|---|---|---|
| `@resurv/orchestrator` | — | 20 |
| `@resurv/cli` | — | 8 |
| `@resurv/proof` | — | 13 |
| `@resurv/node-runtime` | — | 7 |
| `@resurv/repo-policy` | 391 | 412 |
| `apps/worker` | 7 | 13 |
| `apps/web` | 0 | 8 |
| **TypeScript total** | 620 | **703** |
| Foundry | 99 | **102** |

`pnpm test:integration` and `pnpm test:e2e` had zero specs and ran with `--passWithNoTests`,
listed in `BUILD_STATE.md` as a known defect rather than as coverage. They now have 14 between
them. One of them fails if the proof page ever renders a 32-byte value that appears in no
committed artifact, which is the specific way a proof page goes wrong.

## Architecture changes

- Two new product packages (`orchestrator`, `proof`) and two supporting ones (`node-runtime`,
  `cli`). `packages/seam-probe/src/local-env.ts` is now a re-export, so its committed imports
  still resolve.
- `@resurv/chain` gains the production RPC quorum. The seam probe's version stays where it is;
  they share the projection idea and not the code, which is a duplication worth removing later.
- The Worker gains three read-only routes and holds no credential to serve them.
- Two external-effect commands were added to `packages/repo-policy`'s classification, with a
  boundary test asserting no auto-approved command reaches either, and `--dry-run` neutralizing
  both.

## Claims changed

Five rows moved to `VERIFIED (Base Sepolia)`: the atomicity of action, verification, state
transition and fee; the refusal of a committed primary action before broadcast; duplicate trigger
and attempt producing no second effect; deployment with no funded deployer; and `msg.sender` at a
RESURV contract being the organization wallet, which closes the last Phase 0.5 residual that had
a cheap experiment attached to it.

## Security findings

- The two reconciliation defects above, found and fixed.
- The subagent review worktrees were briefly tracked by git and were removed and ignored.
- No credential appears in any artifact, bundle or page. The Worker integration suite asserts it
  on every public route.

## Phases 4, 6 and 8

**Phase 4, the bounded response agent: deliberately not built.** PRD 13 specifies a model that
ranks eligible actions with a deterministic fallback. The deterministic half is what shipped:
action order is the covenant's committed order. The model half was cut against the deadline, and
the honest reading is that cutting it removed a component from the demo without removing anything
from the safety argument — PRD 13.4 already requires the demo to complete with the model
disabled, and no model is anywhere near the safety path. `docs/CLAIMS.md` carries no claim about
an agent, and the README says the planner is deterministic.

**Phase 6, hardening: partial.** The chaos cases PRD 21.8 names are covered as unit tests against
scripted transports — crash after the durable commit, crash after the POST, lost response, RPC
disagreement, stale receipt, inner failure, concurrent workers. What is not done: Slither, a
container scan, a dependency audit, OpenTelemetry, alerts and a restore rehearsal. Those need
infrastructure this build does not have and would not exercise.

**Phase 8, the onboarding bounty: done.** `docs/bounty/README.md`.

## Exit gates

| Criterion | Result |
|---|---|
| One real KeeperHub-executed contract call with authoritative status and transaction link | PASS, seventeen of them |
| Same-key replay returns the original execution | PASS, unit-tested; observed live in Phase 0.5 |
| Changed-body reuse returns conflict | PASS, Phase 0.5 `P07`, handled in the loop |
| Failed simulation produces no broadcast | PASS, live: the primary action |
| Worker crash after broadcast recovers without duplicate execution | PASS, `resumes a claim left behind by a crash` |
| Database can rebuild terminal covenant state from chain | PASS, in the sense that matters: the reconciler recovers a transaction from `eth_getLogs` with no local record but the key |
| RPC disagreement pauses execution | PASS, unit-tested, and observed live once |
| Judge can verify without credentials | PASS, the page and `/api/proof/summary` |
| `pnpm gate` | PASS, exit 0 |

## Next

Independent review in a fresh session. `docs/FINAL_BUILD_REPORT.md` names what to attack first.

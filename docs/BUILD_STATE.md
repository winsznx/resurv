# Build state

Canonical handoff document. Read this first in a new session.

Last updated: 2026-08-13, after the redeployment and the fresh canonical run.

## Where we are

**`HACKATHON RELEASE READY — HUMAN VIDEO/SUBMISSION ONLY`**

| | |
|---|---|
| Completed | Phases 0, 0.5, 1, 2, 3, 5, 6 (review), 7, 8, 9 |
| Deliberately not built | Phase 4, the model-assisted planner. See below |
| Submission deadline | 2026-08-13 12:00 UTC+2 |
| Public repository | https://github.com/winsznx/resurv — full history, CI green on a clean runner |
| Blocking for submission | a recorded video, `wrangler deploy`, and the DoraHacks form. All three are human steps |

## What exists, in one paragraph

A covenant is deployed on Base Sepolia and one has run end to end. Its primary recovery action
was refused by KeeperHub's simulation because the adapter's vault role had been revoked, so no
transaction was sent. The approved fallback executed, and one transaction carries the
evacuation, the verifier result, the covenant's state transition and the success fee. The same
trigger and the same attempt were replayed and both were rejected. Every contract was deployed
by a gas-sponsored KeeperHub contract call to a public CREATE2 factory, with a zero-balance
wallet and no faucet.

| | |
|---|---|
| Success transaction | `0x7ac018850024cfd0e2d901840fd395fab852cf8cc23e5f7755c0b3eda8cc7d25` (block 45423354) |
| Deployed from | commit `1d1eb9a`, salt namespace `resurv/v4` |
| Previous generation | `deployments/historical/base-sepolia-v3.json`, superseded |
| Covenant | `0x1824fe778dfcc7ed43b79ec6887e762c04952a12763ec7481a05a7a257a23237` |
| Manager | `0xdae116d15a2d8a73249a1476f8fdd5edee27fdcc` |
| Receipt | `docs/proof/canonical-covenant.json` |
| Manifest | `deployments/base-sepolia.json` |

## Read these, in this order

1. `README.md` — the product, the proof, and how to check it
2. `docs/phase-logs/PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md` sections 2, 8, 9 — the measured
   seam behaviour, which is authoritative over the PRD and over KeeperHub's documentation
3. `docs/DECISIONS.md` ADR-013, ADR-014, ADR-015 — the three decisions that shaped the build
4. `docs/phase-logs/PHASE_01.md` — contracts, and the mutation campaign
5. `docs/phase-logs/PHASE_02_TO_05.md` — the live build
6. `docs/phase-logs/PHASE_06_REVIEW.md` — the first review round, three FAILs
7. **`docs/phase-logs/PHASE_07_FINAL_AUDIT.md`** — the second round. Three more escrow traps, a
   regression test that was a false positive, and the fact that the deployed bytecode does not
   contain the fixes. Read this before believing anything else in this repository
8. `docs/FINAL_BUILD_REPORT.md` — what an independent reviewer should attack first

## Tests

Counted so the number cannot flatter itself.

| Suite | Count |
|---|---|
| `@resurv/repo-policy` | 412 |
| `@resurv/seam-probe` (offline half) | 71 |
| `@resurv/domain` | 63 |
| `@resurv/config` | 39 |
| `@resurv/keeperhub-client` | 36 |
| `@resurv/orchestrator` | 32 |
| `@resurv/cli` | 18 |
| `apps/web` (page + timeline) | 16 |
| `apps/worker` (8 unit + 6 integration) | 14 |
| `@resurv/proof` | 13 |
| `@resurv/chain`, `@resurv/db`, `@resurv/node-runtime` | 21 |
| **TypeScript total** | **735** |
| Foundry unit and fuzz | 109 |
| Foundry invariants | 13 |
| **Foundry total** | **122** |

Fuzz: 512 runs per test. Invariants: 256 runs at depth 128. The `afterInvariant` block reports
the **last run only**, not the campaign, and now says so in its first line.

`pnpm gate` exits 0.

A clean-room clone **from the public GitHub repository**, with `git clone --recurse-submodules`,
`pnpm install --frozen-lockfile` and `TURBO_FORCE=true pnpm gate`, also exits 0 with `Cached: 0`.
Run against `fe01c43`.

GitHub Actions has run three times on clean runners and all three were green on all four jobs:
[31642439279](https://github.com/winsznx/resurv/actions/runs/31642439279),
[31653312589](https://github.com/winsznx/resurv/actions/runs/31653312589) and
[31653764278](https://github.com/winsznx/resurv/actions/runs/31653764278) on the tip.

`pnpm test:integration` and `pnpm test:e2e` are no longer empty. They were listed here as a known
defect for two phases; they now carry 14 specs between them.

## What the reviews found

Two rounds. **Six FAILs across seven reviews.**

The first round (`PHASE_06_REVIEW.md`) found two permanent-escrow-loss defects on an immutable
contract, both with working proofs. Fixed, redeployed, and the covenant re-run against the fixed
code.

The second round (`PHASE_07_FINAL_AUDIT.md`) found three more, including two shapes of the same
defect the first round had claimed to close, plus a regression test that passed with the
fund-loss guard it was named after deleted, plus an off-by-one in the reconciliation loop that
failed nothing because no test had ever counted a round. All fixed in source, each one verified
by reverting the fix and confirming exactly one test fails.

**The contracts were redeployed from current `main` and the canonical covenant re-run against
them**, twice: the first attempt shipped a mutation-testing build of the manager and Sourcify
caught it. The second is clean and all six contracts verify. `deployments/base-sepolia.json`
records commit `1d1eb9a`, and `git diff b9f8722 -- packages/contracts/` is empty. The previous
generation is archived in `deployments/historical/` and its transactions remain valid history.

Two findings are accepted rather than fixed: a verifier that runs out of gas at any budget still
has no exit, and nothing validates a verifier or an adapter at creation. Same root cause, named.

These reviewers are agents in this repository with no write access. **RESURV has had no external
audit** and says so everywhere it says anything.

## Deliberately not built

**Phase 4, the model-assisted planner.** PRD 13 specifies a model that ranks eligible actions
with a deterministic fallback. The deterministic half shipped: action order is the covenant's
committed order. The model half was cut against the deadline. Cutting it removed a component
from the demo and nothing from the safety argument, because PRD 13.4 already requires the demo
to complete with the model disabled and no model was ever in the safety path. `docs/CLAIMS.md`
carries no claim about an agent.

**Most of Phase 6's tooling.** Slither, container and dependency scanning, OpenTelemetry, alerts,
a database restore rehearsal. All need infrastructure this build does not have. The chaos cases
PRD 21.8 names are covered as unit tests against scripted transports.

**The signed receipt and the verification CLI** from PRD 18.2. The receipt exists and is
committed; it is not signed, and there is no standalone CLI. `docs/PROOF_LADDER.md` states that
qualifier on rung 9 rather than claiming the rung whole.

## Unresolved assumptions

1. **A reverted broadcast.** Never observed. Two routes tried in Phase 0.5 and both failed
   because KeeperHub refuses to broadcast a call whose gas estimation reverts. `REVERTED` is
   implemented and tested. Nothing may be said about how it presents.
2. **`safe_inner_failure`.** Documented, never observed, handled conservatively. The demo runs on
   the direct-wallet path where the hazard does not arise, so this build could not have observed
   it even in principle.
3. **The 24-hour idempotency boundary and the exact scope of a key.** Neither documented nor
   derivable from one organization. The onchain attempt id covers both.
4. **Whether a concurrent-writer store behaves.** `InMemoryAttemptStore.reserve` is synchronous,
   so the concurrency test cannot interleave. The design is right and the race is not exercised.
   Nothing that ships has two writers, so the test belongs with the shared store that would.

## Known limitations

- Testnet only. No mainnet, no external audit, not production-ready by this project's own gate.
- The requester, the admin, the pauser and the executor are one address on the live deployment.
- No database. The orchestrator persists to an `fsync`'d journal. ADR-016.
- A covenant already satisfied at trigger time can still pay a full fee if an executor runs an
  action against it. Faithful to the PRD's own illustrative `executeAttempt`; the PRD is what is
  wrong. Accepted for v1 and recorded.
- `TestUSD.mint` is permissionless on the live deployment. It is a test token and the open mint
  is what let a zero-balance wallet fund the demo.
- CI has run once on a clean GitHub runner and passed on all four jobs. One observation, not a
  guarantee about future dependency or runner changes.
- The Claude Code permission boundary is configuration checked by our own tests, not a sandbox.
- A verifier that runs out of gas at any budget has no exit, and creation validates neither the
  verifier nor the adapters. Accepted, named, not fixed.
- `Retry-After`, `X-RateLimit-*` and `X-Poll-Interval-Hint` are parsed and recorded, never acted
  on. The reconciler sleeps a fixed interval. The 429 branch was never triggered.

## The credential

`KEEPERHUB_API_KEY` in `.env` at the repository root, an organization key beginning `kh_`. It
exists on this machine and is git-ignored. Creating and rotating it stays a human step.

Nothing in `pnpm gate` needs it. The two live commands do:

```bash
pnpm --filter @resurv/cli live:contracts   # deploys
pnpm --filter @resurv/cli live:demo        # runs a new covenant
```

Both are classified as external effects in `packages/repo-policy` and reachable from no
auto-approved Claude Code command. `--dry-run` neutralizes both.

## The release pass of 2026-08-13

What changed, and what is honestly incomplete.

**Done.** All six contracts redeployed from current source under the `resurv/v4` salt namespace;
canonical covenant re-run end to end against them; the new transaction verified on two
independent RPC origins with exactly one `AttemptSucceeded` and one `CovenantSatisfied` across
the whole life of the new manager; proof artifacts regenerated by the evidence pipeline rather
than hand-edited; every stale literal replaced across eleven current-state documents; three
findings that reproduced against current `main` fixed with tests.

**Not done, and why.**

- **The first redeployment of this pass shipped a mutant** and had to be redone. A mutation
  campaign restored the manager's source with a file copy and never rebuilt, so the artifact
  cache still held the build with `maxTotalAttempts` deleted, and the deployment read it.
  Sourcify's refusal to verify that one contract was the only signal. `rebuildContracts()` now
  compiles before any artifact is read; the generation was redeployed as `resurv/v5`; all six
  contracts now verify. Archived at `deployments/historical/base-sepolia-v4-MUTANT.json`.
- **The pre-deployment contracts audit had not reported when the deployment ran.** It was
  launched first, and the deployment proceeded on the strength of 122 contract tests including
  the fuzz and invariant campaigns plus six mutation regressions each verified to fail when its
  fix is reverted. That is a real ordering compromise made against a deadline and it is recorded
  as one rather than described as a gate that passed.
- **The four specialist reviews were not all re-run against the post-deployment tree.** The
  contract source is byte-identical to what the second round reviewed and then had fixed, so the
  review surface for the contracts is unchanged; the orchestrator and CLI changes in this pass
  are covered by new tests but not by a reviewer.
- **Cloudflare is not deployed.** `wrangler deploy` is denied to Claude Code in every wrapper
  form and the policy was not weakened to work around it.

## Next exact task

Three human steps, in any order, none of them an agent's to do:

1. `pnpm build && pnpm --filter @resurv/worker deploy` — `wrangler deploy` is denied to Claude
   Code in every wrapper form, and `packages/repo-policy` fails if anyone allow-lists a path to
   it. That control backs a `VERIFIED (policy level)` row in `docs/CLAIMS.md`. Afterwards, set
   the repository homepage to the resulting URL and fill it into `README.md` and
   `docs/SUBMISSION_READY_PACKET.md`.
2. Record the demo video from `docs/DEMO_SCRIPT.md`, roughly 2:45, legible with the sound off.
   Checklist in `docs/DEMO_CAPTURE_CHECKLIST.md`.
3. Submit on DoraHacks with `docs/SUBMISSION_READY_PACKET.md`, and the onboarding bounty
   separately with `docs/bounty/README.md`. Deadline 2026-08-13 12:00 UTC+2.

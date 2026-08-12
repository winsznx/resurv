# Build state

Canonical handoff document. Read this first in a new session.

Last updated: 2026-08-12, end of the autonomous build.

## Where we are

**`BUILD COMPLETE — AWAITING INDEPENDENT FINAL REVIEW`**

| | |
|---|---|
| Completed | Phases 0, 0.5, 1, 2, 3, 5, 6 (review), 7, 8, 9 |
| Deliberately not built | Phase 4, the model-assisted planner. See below |
| Submission deadline | 2026-08-13 12:00 UTC+2 |
| Blocking for submission | a git remote, a recorded video, and a Cloudflare deploy. All three are human steps |

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
| Success transaction | `0xf7f9aace84a73bc236b2b44468026137fa5a52a96511a28f2951001a729d86ab` |
| Covenant | `0xd7250d1fd4c0f996475b78a00489ce0668bad187b342ca61d88983bf0ec7e14f` |
| Manager | `0xfcafbc81f253e62a3818ecda7a7a71e557c65b21` |
| Receipt | `docs/proof/canonical-covenant.json` |
| Manifest | `deployments/base-sepolia.json` |

## Read these, in this order

1. `README.md` — the product, the proof, and how to check it
2. `docs/phase-logs/PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md` sections 2, 8, 9 — the measured
   seam behaviour, which is authoritative over the PRD and over KeeperHub's documentation
3. `docs/DECISIONS.md` ADR-013, ADR-014, ADR-015 — the three decisions that shaped the build
4. `docs/phase-logs/PHASE_01.md` — contracts, and the mutation campaign
5. `docs/phase-logs/PHASE_02_TO_05.md` — the live build
6. **`docs/phase-logs/PHASE_06_REVIEW.md`** — three reviews, all FAIL, what was fixed and what
   was accepted. Read this before believing anything else in this repository
7. `docs/FINAL_BUILD_REPORT.md` — what an independent reviewer should attack first

## Tests

Counted so the number cannot flatter itself.

| Suite | Count |
|---|---|
| `@resurv/repo-policy` | 412 |
| `@resurv/seam-probe` (offline half) | 71 |
| `@resurv/domain` | 63 |
| `@resurv/config` | 38 |
| `@resurv/keeperhub-client` | 36 |
| `@resurv/orchestrator` | 22 |
| `@resurv/proof` | 13 |
| `apps/worker` (7 unit + 6 integration) | 13 |
| `apps/web` (e2e) | 8 |
| `@resurv/cli` | 8 |
| `@resurv/chain`, `@resurv/db`, `@resurv/node-runtime` | 21 |
| **TypeScript total** | **705** |
| Foundry unit and fuzz | 101 |
| Foundry invariants | 13 |
| **Foundry total** | **114** |

Fuzz: 512 runs per test. Invariants: 256 runs at depth 128. The `afterInvariant` block reports
the **last run only**, not the campaign, and now says so in its first line.

`pnpm gate` exits 0. A clean-room clone with `pnpm install --frozen-lockfile` and
`TURBO_FORCE=true pnpm gate` also exits 0 with `Cached: 0`.

`pnpm test:integration` and `pnpm test:e2e` are no longer empty. They were listed here as a known
defect for two phases; they now carry 14 specs between them.

## What the reviews found

Three in-repo specialist reviewers ran against the finished build. **All three returned FAIL.**
Six findings were fixed, five accepted with reasons, three deferred. Two of the fixed ones were
permanent-escrow-loss defects on an immutable contract, both reachable through ordinary
operation, both found with working proofs. The contracts were redeployed and the covenant re-run
against the fixed code.

The full list is `docs/phase-logs/PHASE_06_REVIEW.md`. The three worth attacking next are named
at the end of it.

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
- No CI run has ever happened: this repository has no git remote.
- The Claude Code permission boundary is configuration checked by our own tests, not a sandbox.

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

## Next exact task

An adversarial independent review in a fresh session, against
`docs/FINAL_BUILD_REPORT.md`. Then, if it passes: a git remote, `wrangler deploy`, the video, and
submission. None of those four is an agent's to do.

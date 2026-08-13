# Final build report

Date: 2026-08-12. Written at the end of the autonomous build, for the fresh session that will
try to break it.

---

## What was actually shipped

An outcome covenant, deployed on Base Sepolia, that has settled once.

The mechanism in one sentence: a protocol commits before an incident to a deterministic verifier
and a short ordered list of pre-authorized recovery actions, and a responder is paid only when
the verifier observes the promised state, inside the transaction that produced it.

The live run: the primary action was refused by KeeperHub's simulation because the adapter's
vault role had been revoked, so nothing was broadcast; the approved fallback executed; one
transaction carries the evacuation, the verifier result, the state transition and the fee; the
same trigger and the same attempt were then replayed and both were rejected.

## Final architecture

```text
apps/web              the public proof page (React, Vite, tokens from design.md)
apps/worker           one Cloudflare Worker: /api/* plus the SPA as static assets
packages/contracts    Foundry. Manager, two adapters, verifier, demo protocol
packages/domain       reference models: covenant state machine + measured attempt lifecycle
packages/keeperhub-client   typed transport. Parses and records, decides nothing
packages/orchestrator the attempt lifecycle executed: durable claim → send → reconcile
packages/chain        two-origin RPC quorum, receipt projection, CreateX constants
packages/proof        the committed evidence, typed, imported by the page and the Worker
packages/cli          live:contracts and live:demo, the two external-effect entry points
packages/repo-policy  executable repository policy. Tests only
packages/db           Drizzle schema and migration. Designed, unwired
packages/config       environment validation and secret redaction
packages/node-runtime the credential loader and the repository root
packages/seam-probe   the Phase 0.5 measurement harness
```

## Deviations from the PRD

| PRD says | Built as | Why |
|---|---|---|
| Railway, Fastify, Redis, BullMQ, Docker Compose | Cloudflare Workers, Hono | ADR-001, an operating constraint |
| Next.js | Vite + React SPA | One Worker, one origin, no CORS. ADR-002 |
| `forge script --broadcast` deployment | CreateX through a sponsored KeeperHub call | ADR-014. No funded deployer exists |
| `createCovenant(struct, struct[])` only | plus `createCovenantEncoded(bytes,bytes)` | ADR-015. KeeperHub's encoder cannot express a struct argument |
| `ACCEPTED` and `PENDING` attempt states | neither exists | ADR-013. Measurement falsified both |
| Model-assisted planner (Phase 4) | deterministic order only | Cut against the deadline. No model was ever in the safety path |
| Signed receipt + `resurv verify` CLI (18.2) | receipt + page + JSON endpoint | Cut. `docs/PROOF_LADDER.md` states the qualifier on rung 9 |
| `users`, `organizations`, operator auth | not built | Off the execution critical path |

## ADR-013 as implemented

The attempt lifecycle from the Phase 0.5 measurements is in `packages/domain/src/attempt-state.ts`,
judged against an independent reference model, and executed by
`packages/orchestrator/src/execute.ts`. The properties that matter:

- The durable claim precedes the first request in every path, including resume.
- A lost response is replayed under the same key. The key is never rotated, and the reconciler
  has no code path that could rotate it.
- No terminal state involving an onchain effect is reachable except through
  `classifyChainEvidence`, which requires two agreeing origins, the expected event, and no
  inner-failure signal.
- The settlement window and the log-search floor both come from the durable record, so a resumed
  process neither restarts its clock nor skips the block its transaction landed in. Both were
  defects found by review.
- Nothing promotes an attempt on elapsed time. A 409 `idempotency_in_progress` positively
  suppresses `PROVEN_NOT_BROADCAST`, because an in-flight report is evidence an effect may still
  land.

## Phases

| Phase | State |
|---|---|
| 0, source lock and foundation | complete, independently reviewed, remediated |
| 0.5, KeeperHub seam measurement | complete, `SEAM REVISE`, 16 scenarios, evidence committed |
| 1, reference model and contracts | complete, 8 mutations run |
| 2, KeeperHub client | complete, and the deployment path with it |
| 3, orchestrator and reconciliation | complete |
| 4, bounded agent | **not built**, deliberately |
| 5, product surface and receipt | complete, minus the signature and the CLI |
| 6, hardening | partial. Two review rounds, seven reviews, six FAILs, findings acted on; scanning tools not run |
| 7, public Base Sepolia proof | complete |
| 8, onboarding bounty | complete |
| 9, submission material | complete as drafts. Three human steps remain |

## Test totals

| | |
|---|---|
| TypeScript | **727** |
| Foundry unit and fuzz | **109** |
| Foundry invariants | **13** |
| `pnpm gate` | exit 0 |
| Clean room cloned from github.com/winsznx/resurv, `TURBO_FORCE=true pnpm gate` | exit 0, `Cached: 0` |
| GitHub Actions, clean runner | four jobs green, three times, most recently [31653764278](https://github.com/winsznx/resurv/actions/runs/31653764278) on the tip |

Fuzz 512 runs per test. Invariants 256 runs at depth 128, `fail_on_revert = true`. The
`afterInvariant` coverage figures describe one run, not the campaign, and say so.

## Mutation results

Two campaigns, eleven mutations.

Phase 1, eight applied to committed source: seven caught, one survived — admitting an armed but
never-triggered covenant into `executeAttempt`, which would have paid a responder for an
incident that never happened. Now caught three ways.

Phase 6, three found by the contracts review: all three survived. Removing the `EXECUTING`
allowance (dead code, documented rather than tested); removing the `feeSettled` guard (now
`test_theFeeSettledGuardIsReachableAndHolds`); permitting `ARMED -> EXPIRED` (now caught twice).
The last one is the instructive failure: `CovenantStatusLib.canTransition` had been exhaustively
tested against a reference model and was never called from production code.

## Deployed resources

Base Sepolia, chain 84532, deployed 2026-08-12 through CreateX
(`0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed`) by the KeeperHub organization wallet
`0xfd35ae935de7be93ffd585d6627268d833ed834c`, every address predicted offchain and matched.

| Contract | Address |
|---|---|
| `ResurvCovenantManager` | `0x8e4c71d6c99a10f442e70fd236c3d583d9d9d284` |
| `PauseAction` | `0x2bf292c9bceac8a2d0846a05b8b49917977c98e2` |
| `EvacuateERC20Action` | `0x196f0125e73a78438f1518e5eb46d9f03afd2197` |
| `VaultSafeStateVerifier` | `0xd71f170915bf9204033b40746ee3c5f05de712f1` |
| `DemoVault` | `0x291efc6f53559d8316761309e856772f10d0cdc4` |
| `TestUSD` | `0x42a48b758d36866ee18b117f101aafdbb49bc7c7` |

Bytecode hashes, salts, constructor arguments, compiler settings and every deployment
transaction: `deployments/base-sepolia.json`.

All six are verified on **Sourcify at `match` level**: creation and runtime bytecode both
reproduce from this repository at the pinned compiler settings, and the result is mirrored to
Blockscout. Per-contract links and the one-line `curl` reproduction are in `docs/DEPLOYMENTS.md`.
Basescan's tab may still show them unverified, because Sourcify's forwarding to Etherscan hit a
daily submission limit. No document here claims Basescan verification, and none should.

## The canonical covenant

| | |
|---|---|
| Covenant | `0xa5e71176ccfc47947d0a292bdd63fd0b8ccc64a2b62f1cfc9f1cbdb6787c9cf0` |
| Success transaction | `0xef63ee114dea86da25f1d38802be8bfbdcce166a140f322d283f22a41f9c7e22` |
| Block, gas, status | 45421180, 245,380, `0x1` |
| Terminal status | `SATISFIED` (5) |
| Verifier, read live | `satisfied: true`, observed 1,000,000 |
| Vault / recipient / responder | 0 · 1.000000 rUSD · 1.000000 rUSD |
| Fee release | in the success transaction, log 5 |
| Duplicate trigger, duplicate attempt | both rejected, zero effects |

Seventeen KeeperHub execution ids across the deployment and the demo are recorded in the
manifest and the receipt. Full step-by-step: `docs/proof/canonical-covenant.json`.

## Verified claims

`docs/CLAIMS.md` is the ledger. The rows that moved during this build:

- The action, the outcome check, the state transition and the fee release share one transaction —
  **VERIFIED (Base Sepolia)**.
- A committed primary action that cannot execute is refused before broadcast and the covenant
  falls back rather than guessing — **VERIFIED (Base Sepolia)**.
- A duplicate trigger and a duplicate attempt produce no second effect — **VERIFIED (Base
  Sepolia)**.
- RESURV deployed its own contracts with no funded deployer — **VERIFIED**.
- `msg.sender` at a RESURV contract is the organization wallet — **VERIFIED**, closing the last
  Phase 0.5 residual with a cheap experiment attached.
- A funded covenant always has a callable exit; an expiry refund is impossible while the verifier
  answers true at any caller gas; every manager transition is one the reference machine permits —
  **VERIFIED (local EVM)**, all three added by review.

## Refuted

- Base Sepolia offers a private mempool. Measured false.
- KeeperHub gives exactly-once execution. Measured false: a new key for the same action executed
  it a second time.
- HTTP 202 means an attempt was broadcast. Measured false.
- `pending`/`running` are observable on a direct execution's happy path. Measured absent.

## Unresolved assumptions

1. How a reverted broadcast presents. Two routes tried, both refused before broadcast.
2. `safe_inner_failure` in practice. Documented, never observed, handled conservatively.
3. The idempotency window boundary and the exact scope of a key.
4. Whether a genuinely concurrent store behaves. The current test cannot interleave.
5. Whether a cold-network install works. Every reproduction so far resolved from a warm store.

## Accepted limitations

Testnet only, no external audit. Requester, admin, pauser and executor are one address on the
live deployment. A covenant already satisfied at trigger time can still pay a full fee — faithful
to the PRD's own `executeAttempt`, and the PRD is what is wrong. A requester who can satisfy
their own outcome can reclaim the escrow, and a pauser can block the payout window until the
deadline; both are within the design and neither has a responder protection in v1.
`TestUSD.mint` is permissionless. There is no database; the orchestrator persists to an
`fsync`'d journal (ADR-016).

## Security findings

Six fixed, five accepted, three deferred. Full detail in
`docs/phase-logs/PHASE_06_REVIEW.md`. The two that mattered most were permanent escrow loss on an
immutable contract, both found with working proofs, both fixed and redeployed.

Found during implementation rather than by review: a cancelled DRAFT covenant would have drained
a sibling covenant's escrow (the `funded` flag), and two reconciliation defects that made the
chain-recovery route unreachable in the exact case it exists for.

## Clean-room result

```bash
git clone --recurse-submodules <path> cleanroom && cd cleanroom
pnpm install --frozen-lockfile      # exit 0
TURBO_FORCE=true pnpm gate          # exit 0, Cached: 0 across 15 + 2 + 2 + 3 tasks
```

122 Foundry tests and every TypeScript suite pass in the clone. No path in the repository depends
on `/Users/mac`, on a sibling repository, or on a credential, outside two threat-model
documents that quote a path as an example and one permission test that uses one as a fixture.

## Exact reproduction commands

```bash
pnpm gate                                            # everything, no credential needed
pnpm --filter contracts test                         # 122 Foundry tests
pnpm --filter @resurv/seam-probe test                # the Phase 0.5 findings vs their evidence

pnpm --filter @resurv/cli live:contracts --dry-run   # predicts every address, sends nothing
pnpm --filter @resurv/cli live:demo --dry-run        # simulates every step, broadcasts nothing
pnpm --filter @resurv/cli live:contracts             # deploys, needs the credential
pnpm --filter @resurv/cli live:demo                  # a new covenant, needs the credential

cast receipt 0xef63ee114dea86da25f1d38802be8bfbdcce166a140f322d283f22a41f9c7e22 \
  --rpc-url https://sepolia.base.org
cast call 0x8e4c71d6c99a10f442e70fd236c3d583d9d9d284 "statusOf(bytes32)(uint8)" \
  0xa5e71176ccfc47947d0a292bdd63fd0b8ccc64a2b62f1cfc9f1cbdb6787c9cf0 \
  --rpc-url https://sepolia.base.org                 # 5 = SATISFIED
```

## Final state

| | |
|---|---|
| Commit | see `git log -1` at the tip of `main` |
| Working tree | clean |
| Branch | `main`, pushed to https://github.com/winsznx/resurv |
| Deployed source | commit `b9f8722`, recorded in `deployments/base-sepolia.json`. `git diff b9f8722 -- packages/contracts/` is empty |
| Canonical transaction | [`0xef63ee11…`](https://sepolia.basescan.org/tx/0xef63ee114dea86da25f1d38802be8bfbdcce166a140f322d283f22a41f9c7e22), block 45421180, two origins agree |
| Source verification | five of six on Sourcify at `match`; `ResurvCovenantManager` answered `no_match` three times and is **not** verified |
| Gate | exit 0, locally and on a clean GitHub runner |

## The release pass of 2026-08-13

The contracts were redeployed from current source and the canonical covenant re-run against
them, which closes the one gap the second audit round opened.

| | |
|---|---|
| Deployed from | commit `b9f8722`, salt namespace `resurv/v4`. `git diff b9f8722 -- packages/contracts/` is empty |
| Manager | [`0x8e4c71d6…`](https://sepolia.basescan.org/address/0x8e4c71d6c99a10f442e70fd236c3d583d9d9d284) |
| Covenant | `0xa5e71176ccfc47947d0a292bdd63fd0b8ccc64a2b62f1cfc9f1cbdb6787c9cf0` |
| Canonical transaction | [`0xef63ee11…`](https://sepolia.basescan.org/tx/0xef63ee114dea86da25f1d38802be8bfbdcce166a140f322d283f22a41f9c7e22), block 45421180, gas 245,380 |
| Independent check | identical receipt from `sepolia.base.org` and `base-sepolia-rpc.publicnode.com`; six logs in the promised order |
| No second effect | paged `eth_getLogs` over the whole life of the new manager returns exactly one `AttemptSucceeded` and one `CovenantSatisfied`, both inside that transaction |
| Source verification | five of six on Sourcify at `match`; `ResurvCovenantManager` **not verified**, `no_match` three times |
| Previous generation | archived at `deployments/historical/base-sepolia-v3.json`; its transactions remain valid history |

Three findings from the last review reproduced against current `main` and were fixed here:
server rate-limit hints were parsed and then ignored, simulation and execution derived their
bodies from two separate literals, and the demo silently started a new covenant over an existing
run state. Six other findings were verified as already fixed before anything was changed.

### What this pass did not finish

- **`ResurvCovenantManager` is not source-verified.** Three Sourcify submissions, one from a
  clean build, returned `no_match` while the other five contracts verified from the same build.
  Unresolved. The `cast code` comparison in `docs/DEPLOYMENTS.md` is the check that works.
- **The pre-deployment contracts audit did not report.** It was launched before the deployment
  and stalled after running its proof-of-concept attacks, producing no findings. The deployment
  proceeded on 122 contract tests including the fuzz and invariant campaigns, plus six mutation
  regressions each verified to fail when its fix is reverted. That is a weaker gate than a
  completed audit and is recorded as one.
- **The four specialist reviews were not re-run against the post-deployment tree.**
- **Cloudflare is not deployed**, because `wrangler deploy` is denied to the build agent and the
  policy was not weakened to route around it.

## What the independent reviewer should attack first

Rewritten after the second audit round, which found three more escrow traps and one false-positive
regression test. Read `docs/phase-logs/PHASE_07_FINAL_AUDIT.md` before this list.

In this order, because this is where I think it is weakest.

1. **The manager's Sourcify `no_match`.** Five contracts from the same build verify and this one
   does not, three times. Either the verification input is wrong in a way specific to this
   contract, or the deployed bytecode is not what we think it is. The `cast code` comparison says
   it is right, but that check is ours and Sourcify's is independent. Resolve it before trusting
   the deployment further than a testnet demo.
2. **The verifier interface, still.** Two rounds of review have found four distinct ways a
   verifier the requester chose can trap that requester's own escrow: no code, a short return, a
   dirty boolean, and running out of gas at any budget. Three are fixed. The fourth is accepted
   and has no mitigation. Nothing validates a verifier or an adapter at covenant creation, which
   is the root cause of all four. That is the next real piece of engineering here and it is not
   done.
4. **The fee policy, not the fee mechanics.** The mechanics are well tested. The policy is not
   settled: `executeAttempt` discards the `satisfied` flag from its pre-state read, so an
   executor can run an action against an already-safe covenant and take the full fee rather than
   the zero-fee `finalizeAlreadySatisfied` route. That is faithful to the PRD and the PRD is
   wrong. Decide whether it is a bug.
5. **Whether a responder can be relied on at all.** A requester who can satisfy their own
   declared outcome can finalize and reclaim; a pauser can block `executeAttempt` until the
   deadline and then let expiry refund. Both are inside the design. Neither has a mitigation.
6. **The remaining 16 surviving mutants.** The second round ran 65 and killed 46. The three that
   mattered most are closed and verified. The rest are listed in that round's report and are
   mostly `nonReentrant` modifiers whose removal is masked by a second layer — which is defence
   in depth working, and also means no test observes either layer alone.
7. **The concurrency claim.** `InMemoryAttemptStore.reserve` is synchronous, so the test named
   "gives two concurrent workers one attempt between them" cannot interleave and would pass
   against a store with a genuine check-then-write race. The design is right; the test asserts
   something it cannot observe.
8. **`docs/CLAIMS.md` against the proof page, line by line.** The page is the thing a judge
   reads, and a page that says one word more than the ledger supports is the failure this whole
   apparatus exists to prevent.
9. **Everything the demo did not exercise.** `finalizeAlreadySatisfied`, `expireCovenant` and
   `cancelCovenant` have never run on chain. They are tested locally and deployed untested in
   production conditions.

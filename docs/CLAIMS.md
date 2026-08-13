# RESURV claim ledger

Update this file whenever implementation or public wording changes.

Nothing here may be stated publicly at a higher confidence than its status.

## Status vocabulary

| Status | Meaning |
|---|---|
| `DOCUMENTED` | Stated in official documentation. Not reproduced by us. |
| `MEASURED_EXTERNAL` | Reproduced live against the real system, but from a different repository (`keeperhub-flightcheck`), not by a RESURV seam test. Strong evidence, not yet ours. **No KeeperHub row carries this level any more:** Phase 0.5 re-measured every one of them from here, and each either promoted to `VERIFIED` or gained a scope limit it did not have. |
| `VERIFIED` | Reproduced by a RESURV test in this repository, with the evidence committed. |
| `ASSUMED` | Believed, untested. May not appear in any public statement. |
| `REFUTED` | Measured false. Must be actively kept out of public wording. |
| `OUT OF SCOPE` | Requires a gate this version will not reach. |

A claim never gets promoted because implementation code exists. Only evidence promotes it.

A `MEASURED_EXTERNAL` row carries no commit id, run id or artifact path, because the artifacts
live in another repository and were not copied here. A reader of this repository cannot check
one. Treat every such row as strong prior information that the Phase 0.5 seam probe has to
re-measure from here before anything is said publicly.

## KeeperHub protocol

Two things happened to this table in Phase 0.5. First a source lock gave every `DOCUMENTED` row
a page in `docs/keeperhub/SOURCE_SNAPSHOT.md`, retrieved 2026-08-12. Then the seam probe ran
live against KeeperHub and Base Sepolia, and the rows below moved on measurement.

A `VERIFIED` row here now means a RESURV test in this repository produced it and the evidence is
committed under `docs/phase-logs/evidence/phase-00-5/`. Every one of them is additionally
asserted by `packages/seam-probe/test/offline/measured-semantics.test.ts`, which reads that JSON
in `pnpm gate`, so a claim cannot drift away from its own evidence without failing a test.

| Claim | Status | Evidence | Last checked | Owner |
|---|---|---|---|---|
| Direct Execution supports simulation and idempotency | DOCUMENTED | Snapshot S2 | 2026-08-12 | Engineering |
| Idempotency replay window is 24 hours | DOCUMENTED | Snapshot S2, quoted | 2026-08-12 | Engineering |
| A replayed response carries `idempotentReplay: true` | VERIFIED | `P06` and `P11`. See the tri-state row below: the field's **absence** is equally informative | 2026-08-12 | Engineering |
| Failed marketplace workflow calls are not charged | DOCUMENTED | Official Marketplace docs. Not re-retrieved in Phase 0.5; marketplace is off the critical path | 2026-08-04 | Tim |
| There is no list-executions endpoint **for direct execution** | VERIFIED | `P11`: `GET /api/execute` and `GET /api/executions` both 404 `not_found`. Workflows do have one (Snapshot S4), so ADR-004's premise needs that qualifier | 2026-08-12 | Engineering |
| Base Sepolia is enabled for our organization | VERIFIED | `P00`: live `GET /api/chains`, chainId 84532, `isEnabled: true`, committed | 2026-08-12 | Engineering |
| Base Sepolia does **not** use a private mempool | REFUTED (as a benefit) | `P00`: `usePrivateMempoolRpc: false` on 84532, committed. Snapshot S5 adds that the field "describes a chain capability, not the route used by a specific transaction", so even a true value would not establish private routing | 2026-08-12 | Engineering |
| Gas is sponsored on Base Sepolia for this org | VERIFIED | `sponsored: true` on every execution that reached the chain, with a 0-ETH org wallet. Observed, never promised: `P09` and `P14` show the same organization getting `sponsored: false` when estimation reverts | 2026-08-12 | Engineering |
| Gas sponsorship requires a direct wallet sender, not a Safe, and a public mempool | DOCUMENTED | Snapshot S8, quoted | 2026-08-12 | Engineering |
| Testnet gas sponsorship does not consume the monthly credit allowance | DOCUMENTED | Snapshot S8: "Mainnet usage counts; testnet usage is free" | 2026-08-12 | Engineering |
| `msg.sender` at the target equals the org wallet under `sponsored: true` | VERIFIED | Every execution that reached the chain: decoded event sender `0xfd35ae935de7be93ffd585d6627268d833ed834c` while `receipt.from` was the relayer `0xDcF4…9613` and `receipt.to` the router `0x5aF5…f07D`. Access control must key on the org wallet and verification must decode the log, never read `receipt.from`. Still not measured against a **RESURV** contract, which is Phase 1 | 2026-08-12 | Engineering |
| `/contract-call` 202 carries no `transactionHash` | VERIFIED | `P05`: the 202 body keys are exactly `executionId` and `status`. The hash appears only on the status endpoint | 2026-08-12 | Engineering |
| **HTTP 202 does not mean the attempt was broadcast** | VERIFIED | `P09` and `P14` twice: HTTP 202 carrying `status: "failed"`, `transactionHash: null`, `receipts: []`, and zero onchain effect. The body's `status` is the outcome; the status code is not. This falsified the previous lifecycle's `ACCEPTED` entry condition. ADR-013 | 2026-08-12 | Engineering |
| **A call whose gas estimation reverts is never broadcast** | VERIFIED (this configuration) | `P09`, `P14` twice: three refusals, zero chain effects, `sponsored: false`, and an error naming a balance shortfall rather than the revert. Controlled comparison in the same run: the same wallet at the same zero balance executes the valid call `sponsored: true`. Scope: one organization, one chain, an unfunded wallet | 2026-08-12 | Engineering |
| `gasLimitMultiplier` below 1.0 is accepted and does not reduce the gas limit | VERIFIED | `P10` sent `"0.951"` and landed with a gas limit 0.08% below the same call with no multiplier, where the multiplier predicts 4.9%. Compared as a ratio, not an equality: two runs of the identical call differ by a few dozen gas | 2026-08-12 | Engineering |
| The sponsored route costs about 22,000 gas above a direct call | VERIFIED | About 45,850 gas used per execution against a 23,929 direct estimate for the same call. Approximate because it varies by a few dozen gas between otherwise identical calls | 2026-08-12 | Engineering |
| `unconfirmed` is a real, non-terminal status | ASSUMED | **Downgraded from DOCUMENTED (conflicting).** The cited first-verified-transaction guide could not be located on 2026-08-12; the word is absent from S2, S4, S7 and S10, and the live probe never saw it either. `status.ts` needs no change: an unrecognized status already normalizes to UNKNOWN and non-terminal | 2026-08-12 | Engineering |
| A would-revert simulation answers HTTP 400 with `wouldRevert` in the body | DOCUMENTED | Snapshot S2, with the full example body | 2026-08-12 | Engineering |
| Simulation can pass while the payer holds zero balance | VERIFIED | `P03`: `simulate: true` returned `wouldRevert: false`, `from` the 0-ETH org wallet, `gasEstimate: 23917`, zero chain effects | 2026-08-12 | Engineering |
| Simulation broadcasts nothing and returns no `executionId` | VERIFIED | `P03` and `P04`: zero chain effects for both challenges, and no `executionId` in either body | 2026-08-12 | Engineering |
| An execution settles `completed` only when all its receipts verify | VERIFIED (six of six) | Every `completed` execution carried `receipts[0].verified: true` with `receiptStatus: "success"`, and every one was confirmed at status `0x1` by two independent origins. Six observations is not a proof of the rule; it is six agreements with it | 2026-08-12 | Engineering |
| `gasUsedWei` carries gas units, not wei | VERIFIED | Byte-identical to `receipts[0].gasUsed` within every status response, and five orders of magnitude too small to be wei | 2026-08-12 | Engineering |
| An organization daily spending cap answers HTTP 403 `Daily spending cap exceeded` | DOCUMENTED | Snapshot S2. Never hit in the probe. `docs/THREAT_MODEL.md` T16 | 2026-08-12 | Engineering |
| **A reverted broadcast is distinguishable from a transport failure** | UNRESOLVED, for a measured reason | **The experiment ran and could not reach the state.** On this configuration a reverting call never becomes a broadcast: KeeperHub refuses it (`P09`, `P14`) and `gasLimitMultiplier` is ignored (`P10`). The residual is real, because the refusal came with `sponsored: false` and a balance error, so a **funded** org wallet may reach the chain and revert. RESURV implements `REVERTED` anyway. Nothing may be claimed about how a reverted broadcast presents | 2026-08-12 | Engineering |
| KeeperHub pre-simulates a `simulate: false` request and refuses a would-revert broadcast | VERIFIED (this configuration) | Three of three. See the row above for the scope limit | 2026-08-12 | Engineering |
| Replaying a key after a lost response resolves the attempt | VERIFIED | `P11`, `P13`, `P15`. 202 with the `executionId`, or 409 `idempotency_in_progress` with `retryable: true` while it runs. Every case ended with exactly one onchain effect | 2026-08-12 | Engineering |
| `idempotentReplay: true` marks a key that a previous request already committed, and its absence marks the committing request | VERIFIED | Four responses across two runs, both branches: `P06` and `P11` carry the flag, `P05` and `P13` do not, and the execution timestamps agree with that reading in each case. `readIdempotentReplay` returns a tri-state because absence is evidence | 2026-08-12 | Engineering |
| A 409 `idempotency_conflict` names the execution the first request created, in `originalExecutionId`, **when one exists** | VERIFIED, with the qualifier | `P07` and `P15`, documented nowhere. In one run `P15` recovered a lost attempt through it; in another the field was absent because the aborted request had registered the key without creating an execution. **Key registration and execution creation are separate events**, so this is a bonus route and never the one to depend on. The conflicting body executed nothing in either case | 2026-08-12 | Engineering |
| Transport idempotency does **not** bound economic effects per action | VERIFIED | `P08`: a new key for the same economic action executed it a second time, two effects for one challenge. This is why the onchain attempt id exists | 2026-08-12 | Engineering |
| A lost response is genuinely ambiguous from the client's side | VERIFIED | The identical abort at ~253 ms committed in some runs and not in others. In the one case with both timestamps, the execution was created at +264 ms and the client gave up at +255 ms: nine milliseconds decided whether an economic action happened | 2026-08-12 | Engineering |
| `pending` or `running` is observable on a direct execution | REFUTED for the happy path | The POST is synchronous and the first status poll already returns terminal with `X-Poll-Interval-Hint: 0`. The only in-flight signal observed is 409 `idempotency_in_progress` on a replay | 2026-08-12 | Engineering |

### Seam behavior encoded in `@resurv/keeperhub-client`

Added by the Phase 0 remediation, when the independent review found each of these asserted as
fact in code and in `docs/RUNBOOKS.md` with no ledger row at any level. Phase 0.5 gave each one
a committed source pointer or downgraded it. Five moved up, one is now contradicted by the
vendor's own documentation, and none has been reproduced live from this repository.

| Claim | Status | Evidence | Last checked | Owner |
|---|---|---|---|---|
| A 401 envelope is `{error}` alone, with no detail and no `request_id` | VERIFIED | `P02`, both the wrong-key and no-key branches: `{"error":"Unauthorized"}` and nothing else. `P12` shows the same bare shape on a 404 for an unknown execution id. **The official documentation is wrong**: `/api` and `/api/errors` both state that every error carries `request_id` | 2026-08-12 | Engineering |
| Three error envelope shapes exist, and `error` means different things in two of them | VERIFIED | `{error}` alone; `{error: code, detail: sentence, request_id}` on an unrouted 404; `{error: sentence, code, retryable, originalExecutionId?}` on both 409s. `errors.ts` now handles all three: `code ?? error` picks the machine value everywhere, `detail ?? error` the human one | 2026-08-12 | Engineering |
| `request_id` is present on **some** responses and worth surfacing to support | VERIFIED | Present on the unrouted 404, absent on the 401 and on the unknown-execution 404. A client must treat it as optional | 2026-08-12 | Engineering |
| The receipt status set is `success`, `reverted`, `safe_inner_failure`, `not_found`, `timeout` | DOCUMENTED | Snapshot S2. Only `success` was ever observed. The Phase 0 remediation recorded that `safe_inner_failure` "appears nowhere outside our own source"; that was wrong | 2026-08-12 | Engineering |
| `reverted` and `safe_inner_failure` mean the attempt failed onchain | ASSUMED | Never observed. What Phase 0.5 did establish is where to look: `result.executedCall.reverted` and `receipts[].receiptStatus`, not the outer receipt status. `docs/THREAT_MODEL.md` T15 | 2026-08-12 | Engineering |
| `X-Poll-Interval-Hint` carries seconds, and `0` means terminal | VERIFIED | Observed as `0` on the first status poll of every terminal execution, which is consistent with the documented meaning. A non-zero value was never seen, so the seconds half stays `DOCUMENTED` | 2026-08-12 | Engineering |
| The rate limit is 60 requests per minute per key | VERIFIED | `x-ratelimit-limit: 60` on every Direct Execution response, with `x-ratelimit-remaining` counting down. Settles the conflict: S2 said 60, S1 said 100 | 2026-08-12 | Engineering |
| `X-RateLimit-*` on every response and `Retry-After` on 429 only | DOCUMENTED | Snapshot S3. The rate limit was never hit, so `Retry-After` was never seen | 2026-08-12 | Engineering |
| A 409 carries `idempotency_conflict` for a differing body and `idempotency_in_progress` for a running attempt | VERIFIED | `P07` and `P11`, with `retryable: false` and `retryable: true` respectively, and `code` carrying the machine value | 2026-08-12 | Engineering |
| There is no list-executions endpoint for direct execution | VERIFIED | `P11`: `GET /api/execute` and `GET /api/executions` both 404 `not_found`. ADR-004's load-bearing premise, previously an absence in documentation, is now a live 404 | 2026-08-12 | Engineering |

## RESURV mechanism

| Claim | Status | Evidence | Last checked | Owner |
|---|---|---|---|---|
| The reference covenant state machine transcribes PRD 9.1, with one inferred edge | VERIFIED (model only) | `test_libraryAgreesWithTheReferenceModelOnEveryPair` and the TypeScript equivalent compare all 64 ordered pairs against an independent transcription that never calls the implementation. Nine of the ten edges are drawn in 9.1; `TRIGGERED -> SATISFIED` is inferred from 9.1's closing note and PRD 8.4, and both model files state that decision in a comment. The word "exactly" stood here until the pre-seam hardening pass and was wrong for a transcription that adds an edge the diagram does not draw | 2026-08-12 | Contracts |
| A terminal covenant state is absorbing | VERIFIED (model only) | `invariant_terminalStateIsAbsorbing` judged against the reference model's terminal set, plus `test_regression_terminalStatesReachNothingAtAll`. Adversarially checked: 5 source mutations, each detected. See `docs/phase-logs/PHASE_00_REMEDIATION.md` | 2026-08-11 | Contracts |
| Covenant status ordinals agree between Postgres and TypeScript | VERIFIED | `packages/db/test/schema.test.ts` compares `onchainStatusEnum.enumValues` against `allCovenantStatusNames()`, a genuine shared oracle | 2026-08-11 | Contracts |
| Covenant status ordinals agree between Solidity and TypeScript | VERIFIED (source level) | `packages/repo-policy/test/cross-language-state-machine.test.ts` parses the Solidity enum and compares names and ordinals against `@resurv/domain`. Source-level, not a comparison of compiled artifacts or of a live decoded event | 2026-08-11 | Contracts |
| The Solidity and TypeScript state machines permit the same transitions | VERIFIED (source level) | The same test compares the two reference model tables character for character, and each language's suite pins its implementation to its own model | 2026-08-11 | Contracts |
| **The action, the outcome check, the covenant state transition and the fee release share one transaction** | **VERIFIED (Base Sepolia)** | Transaction [`0xf7f9aace…`](https://sepolia.basescan.org/tx/0xf7f9aace84a73bc236b2b44468026137fa5a52a96511a28f2951001a729d86ab), block 45398879, status `0x1`, six logs in order: `AttemptStarted`, the vault's `Transfer` to the approved recipient, `VaultEvacuated`, `AttemptSucceeded`, the escrow's `Transfer` to the responder, `CovenantSatisfied`. Confirmed from two independent RPC origins agreeing on the receipt projection | 2026-08-12 | Contracts |
| **A committed primary action that cannot execute is refused before broadcast, and the covenant falls back rather than guessing** | **VERIFIED (Base Sepolia)** | The demo revoked the vault role `PauseAction` depends on, then simulated action 0: HTTP 400, `wouldRevert: true`, `failureKind: "revert"`, no `executionId`, no transaction. Action 1 simulated `wouldRevert: false` and executed. `docs/proof/canonical-covenant.json` | 2026-08-12 | Engineering |
| **A duplicate trigger and a duplicate attempt produce no second effect** | **VERIFIED (Base Sepolia)** | After satisfaction, the identical signed trigger and the identical `executeAttempt` were both re-simulated against the live covenant and both answered `wouldRevert: true`. Chain reads afterwards: status `SATISFIED`, vault 0, recipient 1.000000, responder 1.000000, each unchanged | 2026-08-12 | Contracts |
| **RESURV deployed its own contracts with no funded deployer** | **VERIFIED** | Six CreateX deployments and three configuration calls, all `sponsored: true` from a zero-balance organization wallet, all six addresses predicted offchain and matched. `deployments/base-sepolia.json`. ADR-014 | 2026-08-12 | Engineering |
| **`msg.sender` at a RESURV contract is the organization wallet** | **VERIFIED (against a RESURV contract)** | Closes the Phase 0.5 residual. `DemoVault`'s admin is the organization wallet and nothing else; two `grantRole` calls and one `revokeRole` through KeeperHub succeeded, which is only possible if `msg.sender` at the target was that address. Previously measured against the canary only | 2026-08-12 | Engineering |
| An atomic attempt reverts the action when the outcome is false | VERIFIED (local EVM) | `test_falseOutcomeRevertsTheActionTheCountersTheStatusAndTheFee`: the adapter's transfer, the attempt counters, the status change and the escrow all unwind together. Confirmed by mutation: removing the postcondition revert fails 8 tests. **Local Foundry, not a deployed contract.** Rung 8 is not reached | 2026-08-12 | Contracts |
| Successful action, verifier and fee release share one transaction | VERIFIED (local EVM) | `test_primaryRefused_fallbackSucceeds_andPaysInTheSameTransaction`. Same scope limit as the row above | 2026-08-12 | Contracts |
| A duplicate trigger cannot produce a second payment | VERIFIED (local EVM) | `test_duplicateTriggerIsRejectedOnTwoIndependentGrounds`, `test_noSecondActionOrPaymentAfterSatisfaction`, `invariant_feeMovesAtMostOncePerCovenant`, `invariant_triggerNonceNeverReplays`. Same scope limit | 2026-08-12 | Contracts |
| A recovery action cannot run without a trigger | VERIFIED (local EVM) | `test_anArmedButUntriggeredCovenantCannotBeAttempted` and `invariant_noAttemptWithoutATrigger`, both written because a mutation admitting `ARMED` survived the entire suite | 2026-08-12 | Contracts |
| A funded covenant has a callable exit for every verifier shape that has been tested | VERIFIED (local EVM, in source) | Seven tests, each written after a review found a proof that the escrow could be trapped: codeless verifier, short return, **dirty boolean**, **over-long return**, starved verifier, satisfied-past-deadline, **satisfied-past-deadline-under-a-global-pause**. The three in bold came from the second audit round and were live defects until it. The general form of this claim is **not** proven: a verifier that runs out of gas at any budget still has no exit, and there is no verifier validation at creation. See `docs/phase-logs/PHASE_07_FINAL_AUDIT.md` H-B and L-B, and the deployed-versus-source note below | 2026-08-12 | Contracts |
| An expiry refund is impossible while the verifier answers true, whatever gas the caller supplies and whatever shape it answers in | VERIFIED (local EVM, in source) | `test_expiryRefusesATrueOutcomeEvenWhenTheCallerStarvesTheVerifier` covers the gas axis at 60M and 2M. `test_expiryRefusesATrueOutcomeReturnedWithATrailingTail` covers the encoding axis, and was a live falsification of PRD invariant 10.14.8: an exact-length check read "not conforming" from a verifier every typed path read `true` from, and refunded. `test_expiryRefusesAVerifierContextTheCovenantDidNotCommitTo` covers the context axis, which nothing tested | 2026-08-12 | Contracts |
| Every status transition the manager performs is one the reference state machine permits | VERIFIED (local EVM) | `test_everyStatusTransitionTheManagerPerformsIsOneTheLibraryPermits` and `test_anArmedCovenantCannotBeExpired`. Added because a mutation permitting `ARMED -> EXPIRED` survived the entire suite: `CovenantStatusLib.canTransition` was exhaustively tested and never called from production code | 2026-08-12 | Contracts |
| Every review finding accepted as a defect is closed in source and pinned by a regression test that fails without the fix | VERIFIED (local EVM, in source) | `packages/contracts/test/AuditRegressions.t.sol`, 20 tests. Every one was checked by reverting its fix and confirming exactly that test fails. **The reviewers are in-repo agents with no write access, not a third-party security audit.** RESURV has had no external audit. Two findings are accepted rather than closed, and named in `docs/phase-logs/PHASE_07_FINAL_AUDIT.md` | 2026-08-12 | Contracts |
| The deployed contracts contain the second audit round's fixes | **REFUTED** | The bytecode at the six Base Sepolia addresses was compiled from commit `2ccf02f`, before the second `contracts-auditor` round. Three defects it found (H-A, M-B, M-A) are fixed in this repository and **not** in the deployed instance. Redeploying is a human step and would invalidate the canonical receipt, so it was not done. None of the three affects the canonical covenant, which uses the honest `VaultSafeStateVerifier` and was never paused. `docs/DEPLOYMENTS.md` | 2026-08-12 | Contracts |
| Escrow is conserved across covenants | VERIFIED (local EVM) | `invariant_escrowConservation` compares the contract's accounting against a ledger the handler keeps independently, in both directions | 2026-08-12 | Contracts |
| CreateX is deployed on Base Sepolia and exposes `deployCreate2(bytes32,bytes)` | VERIFIED | `cast code 0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed` returns 23 KB of runtime on chain 84532, and `cast selectors` on it contains `0x26307668`. ADR-014 | 2026-08-12 | Engineering |
| A crash between send and response cannot double-submit | VERIFIED (per idempotency key) | Three lost-response scenarios, `P11`, `P13` and `P15`, run four times, each ending with **at most one** onchain effect: one where the lost request had committed, none where it had not, never two. Scope, and it matters: this is one key within the 24-hour window. It says nothing about a second *action* under a second key, which `P08` shows executes again | 2026-08-12 | Engineering |
| The canonical attempt lifecycle is derived from measurement | VERIFIED (as a derivation) | `docs/phase-logs/PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md` sections 8 and 9, ADR-013. Every state's entry condition cites a scenario. No contract or orchestrator implements it yet, so this is a specification claim, not a behavior claim | 2026-08-12 | Engineering |

## Repository and tooling

Added by the Phase 0 remediation. These are claims the project makes about itself, and the
review found three of them stated above their evidence.

| Claim | Status | Evidence | Last checked | Owner |
|---|---|---|---|---|
| No declared secret of six characters or more survives serialization, at any nesting depth | VERIFIED | `packages/config/test/redact.test.ts`: nested objects, nested arrays, objects in arrays, Maps, Sets, Errors and cycles, against eight deterministic fake credential shapes. The length qualifier is real: `MIN_KNOWN_SECRET_LENGTH = 6` skips a known value shorter than that, so a schema-valid four-character `kh_1` survives under an innocent key while being redacted under its own. Every realistic key is far longer, and the threshold is what keeps redaction from shredding ordinary text | 2026-08-12 | Engineering |
| No credential reaches the shipped browser bundle | VERIFIED | `apps/web/dist` scanned for organization-key, webhook-key, Supabase, JWT, email and home-path shapes: no match. The one 32-byte hex value present is the public `PAUSER_ROLE` hash, quoted inside a verbatim `AccessControlUnauthorizedAccount` revert reason, which is evidence rather than a secret. Structural, not incidental: the page imports the committed receipt at build time and reads two public RPC origins from the visitor's own browser, so there is no credential in the graph to leak | 2026-08-13 | Engineering |
| The deployed Worker holds no credential | VERIFIED | `workerEnvSchema` makes `KEEPERHUB_API_KEY` optional and `apps/worker/test/health.test.ts` pins that a bare environment answers `200 ok`. Changed after a review found the Worker required a live write-capable organization key so that one health route could report its presence, with nothing else reading it | 2026-08-13 | Engineering |
| `/api/health` never echoes a secret value | VERIFIED | `apps/worker/test/health.test.ts`, plus the independent reviewer's five malformed-environment probes | 2026-08-11 | Engineering |
| The unhandled-error log line cannot carry a secret | VERIFIED | `apps/worker/test/health.test.ts` drives the error path with a binding that throws a message containing a fake key. The walker no longer throws on a hostile getter, which it did until the pre-seam hardening pass | 2026-08-12 | Engineering |
| CI fails if a secret-bearing file is ever tracked | VERIFIED | `packages/repo-policy/test/tracked-secrets.test.ts`: 28 caught fixtures, 11 permitted fixtures, plus live `git ls-files` and full-history scans. Covers every category `.gitignore` protects, compared line by line rather than by substring | 2026-08-12 | Engineering |
| Deployment, secret mutation and signing are not auto-approved for Claude Code, wrapper forms included | VERIFIED (policy level) | `packages/repo-policy/test/permission-boundary.test.ts`. This is a check of our own configuration against Claude Code's documented matching, not a sandbox. See `docs/THREAT_MODEL.md` T10 and T11 | 2026-08-11 | Engineering |
| Host credential stores outside this repository are not readable from an auto-run Bash command | VERIFIED (policy level) | `packages/repo-policy/test/credential-surfaces.test.ts` asserts `deny`, not "not allow", for `~/.wrangler`, `~/.config/gh`, `~/.npmrc`, `~/.claude.json`, `~/.docker`, gcloud, `~/.netrc`, `~/.git-credentials` and the environment-dump forms, in tilde, `$HOME` and absolute spellings. Demonstrated live: `ls -d ~/.npmrc` ran with no prompt before the change and was denied after. Residual in `docs/THREAT_MODEL.md` T13 | 2026-08-12 | Engineering |
| Every auto-approved package script still runs the reviewed command graph | VERIFIED (policy level) | `packages/repo-policy/test/approved-scripts.test.ts` enumerates all 51 scripts reachable from an allow rule, root scripts included, pins each body, and rejects any leaf outside the approved command graph. Ten mutations run, all caught, in `docs/phase-logs/PRE_SEAM_HARDENING.md`. A drift guard, not protection against a contributor who edits the policy in the same change | 2026-08-12 | Engineering |
| Every committed CI job passed on a clean GitHub runner | VERIFIED (single run) | GitHub Actions run [31642439279](https://github.com/winsznx/resurv/actions/runs/31642439279), commit `f4a9578`, 2026-08-12. All four jobs green: `format, lint, typecheck, test, build`; `forge fmt, build, test, invariant`; `no secrets in the tree, no permission bypass, no script drift`; `repository gate`. One observation on one runner, not a guarantee about future dependency or runner changes | 2026-08-12 | Engineering |
| All six deployed contracts verify on Sourcify at `match` level | VERIFIED | Creation **and** runtime bytecode both reproduce from this repository at the pinned compiler settings, propagated to Blockscout. Reproduce with `curl -s https://sourcify.dev/server/v2/contract/84532/<address>`. Per-contract links in `docs/DEPLOYMENTS.md`. Basescan may still show them unverified: Sourcify's forwarding to Etherscan hit a daily submission limit, and nothing here claims Basescan verification | 2026-08-12 | Engineering |
| A fresh clone with submodules reproduces the gate | VERIFIED | `git clone --recurse-submodules`, `pnpm install --frozen-lockfile`, `pnpm gate`, all exit 0. Reproduced by the independent reviewer and again after remediation | 2026-08-11 | Engineering |
| A genuinely cold-network install works | ASSUMED | Every reproduction so far resolved from a warm local content-addressable store and a warm solc cache | Pending | Engineering |
| The KeeperHub source snapshot and seam checklist deliverable exists | VERIFIED | `docs/keeperhub/SOURCE_SNAPSHOT.md` and `docs/keeperhub/SEAM_CHECKLIST.md`, produced in Phase 0.5 from 11 official pages retrieved 2026-08-12. Was REFUTED: PRD 28 names the deliverable and `docs/phase-logs/PHASE_00.md` marked it PASS without producing it | 2026-08-12 | Engineering |
| The seam fixture is deterministic and independently verified from this repository | VERIFIED | `cast code`, `cast selectors`, `cast call` and `cast estimate` against `https://sepolia.base.org`, recorded in `docs/phase-logs/PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md` section 5. One dispatch arm, no fallback, no receive, so both success and revert are properties of the bytecode | 2026-08-12 | Engineering |
| Seam evidence keeps transaction hashes while removing credentials | VERIFIED | `packages/seam-probe/test/offline/sanitize.test.ts` pins both halves, and `writeEvidence` re-scans the serialized output and throws rather than write a credential shape | 2026-08-12 | Engineering |
| The live seam probe cannot be reached by an auto-approved command | VERIFIED (policy level) | `packages/repo-policy/test/seam-probe-boundary.test.ts`. `vitest run --dir test/live` is classified as an external effect and appears in no allow rule. The real control is that no credential exists | 2026-08-12 | Engineering |

## Wording that is never permitted without new evidence

- Multi-transaction rollback. RESURV reverts one atomic attempt. It cannot undo a
  transaction that already confirmed.
- Trustlessness. The KeeperHub org wallet and the RESURV admin are trusted parties.
- MEV protection or private routing on Base Sepolia. Measured false.
- Permanent exactly-once from KeeperHub idempotency alone. That window is 24 hours;
  permanence comes from the onchain attempt id.
- Atomic x402 or MPP coupling. Not reproduced.
- Production readiness. Requires the mainnet gate, which v1 will not reach.
- Gas sponsorship as a promise. It was observed on one org, one chain, one run.
- Sandboxing. `.claude/settings.json` is a configured permission boundary, not a sandbox.
- Any claim that an `ask` rule stops a command. Measured 2026-08-12: under the permission mode
  this project's sessions actually run in, `ask` auto-approved. Only `deny` was observed to
  block. Anything load-bearing has to be a deny rule.
- Any claim that CI reliably or always passes. One clean-runner run is recorded, green on all
  four jobs. That is one observation, not a guarantee across future dependency or runner changes.
- Any claim of Basescan contract verification. Sourcify at `match` level is what was achieved.
- Any claim that the covenant state machine is proven at the contract level. Every
  `VERIFIED (model only)` row above is about a pure library, not about a deployed covenant.
- Any claim about how a **reverted broadcast** presents. Phase 0.5 ran the experiment and could
  not reach the state, because a reverting call never becomes a broadcast on this configuration.
  What may be said: KeeperHub refused to broadcast it, three times out of three, with an
  unfunded wallet.
- Any claim that KeeperHub gives exactly-once execution. It bounds economic effects per
  idempotency key within 24 hours. A new key for the same action executed it again, measured.
- Any claim that gas sponsorship is reliable. The same organization got `sponsored: true` on six
  executions and `sponsored: false` on three in the same run, and the deciding factor was
  whether the call estimated cleanly.
- Any claim that an HTTP 202 means an attempt was broadcast. Measured false.
- Any claim that a transaction receipt with status `0x1` proves a RESURV attempt succeeded.
  `safe_inner_failure` is a documented receipt status, so an outer transaction can succeed while
  the inner call failed. Confirmation requires the expected event, not the receipt alone.
  `docs/THREAT_MODEL.md` T15.

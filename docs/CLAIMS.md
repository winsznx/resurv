# RESURV claim ledger

Update this file whenever implementation or public wording changes.

Nothing here may be stated publicly at a higher confidence than its status.

## Status vocabulary

| Status | Meaning |
|---|---|
| `DOCUMENTED` | Stated in official documentation. Not reproduced by us. |
| `MEASURED_EXTERNAL` | Reproduced live against the real system, but from a different repository (`keeperhub-flightcheck`), not by a RESURV seam test. Strong evidence, not yet ours. |
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

Every `DOCUMENTED` row below now points at a page recorded in
`docs/keeperhub/SOURCE_SNAPSHOT.md`, retrieved 2026-08-12, rather than at an unnamed reading.
Nine rows moved during Phase 0.5 on the strength of that retrieval. **Not one row about
broadcast, revert, transport failure or reconciliation moved,** because documentation cannot
settle those and no KeeperHub call has yet been made from this repository.

| Claim | Status | Evidence | Last checked | Owner |
|---|---|---|---|---|
| Direct Execution supports simulation and idempotency | DOCUMENTED | Snapshot S2 | 2026-08-12 | Engineering |
| Idempotency replay window is 24 hours | DOCUMENTED | Snapshot S2, quoted | 2026-08-12 | Engineering |
| A replayed response carries `idempotentReplay: true` | DOCUMENTED | Snapshot S2, quoted. New to this repository; `P06` looks for it | 2026-08-12 | Engineering |
| Failed marketplace workflow calls are not charged | DOCUMENTED | Official Marketplace docs. Not re-retrieved in Phase 0.5; marketplace is off the critical path | 2026-08-04 | Tim |
| There is no list-executions endpoint **for direct execution** | DOCUMENTED | Snapshot S2 lists only `GET /api/execute/{id}/status`. Workflows do have one (S4), so ADR-004's premise needs the qualifier. Unverified against a live 404; `P11` asks | 2026-08-12 | Engineering |
| Base Sepolia is enabled for our organization | MEASURED_EXTERNAL | Live `GET /api/chains`: chainId 84532, `isEnabled: true`. No artifact committed here | 2026-08-10 | Engineering |
| Base Sepolia does **not** use a private mempool | REFUTED (as a benefit) | Live `GET /api/chains`: `usePrivateMempoolRpc: false` on 84532. Snapshot S5 adds that the field "describes a chain capability, not the route used by a specific transaction", so even a true value would not establish private routing | 2026-08-12 | Engineering |
| Gas is sponsored on Base Sepolia for this org | MEASURED_EXTERNAL | Org wallet held 0 ETH, transaction landed, `sponsored: true`. No artifact committed here | 2026-08-11 | Engineering |
| Gas sponsorship requires a direct wallet sender, not a Safe, and a public mempool | DOCUMENTED | Snapshot S8, quoted | 2026-08-12 | Engineering |
| Testnet gas sponsorship does not consume the monthly credit allowance | DOCUMENTED | Snapshot S8: "Mainnet usage counts; testnet usage is free" | 2026-08-12 | Engineering |
| `msg.sender` at the target equals the org wallet under `sponsored: true` | MEASURED_EXTERNAL | Decoded event sender `0xfd35…834c` while `receipt.from` was a relayer and `receipt.to` a router. No artifact committed here. Snapshot S8 documents the mechanism; it has still not been measured against a RESURV contract | 2026-08-12 | Engineering |
| `/contract-call` 202 carries no `transactionHash` | MEASURED_EXTERNAL | Live 202 body was `{executionId, status:"completed"}` only. Snapshot S2's contract-call write example agrees; its transfer example on the same page shows a hash, so the docs do not state it as a rule | 2026-08-12 | Engineering |
| `unconfirmed` is a real, non-terminal status | ASSUMED | **Downgraded from DOCUMENTED (conflicting).** The cited first-verified-transaction guide could not be located on 2026-08-12; the word is absent from S2, S4, S7 and S10. `status.ts` needs no change: an unrecognized status already normalizes to UNKNOWN and non-terminal | 2026-08-12 | Engineering |
| A would-revert simulation answers HTTP 400 with `wouldRevert` in the body | DOCUMENTED | Snapshot S2, with the full example body | 2026-08-12 | Engineering |
| Simulation broadcasts nothing and creates no execution row | DOCUMENTED | Snapshot S2: "No funds reserved, no transactions signed or broadcast" | 2026-08-12 | Engineering |
| Simulation can pass while the payer holds zero balance | MEASURED_EXTERNAL | `simulate: true` returned `wouldRevert: false` with a 0-ETH sender. No artifact committed here | 2026-08-11 | Engineering |
| An execution settles `completed` only when all its receipts verify | DOCUMENTED | Snapshot S2, quoted. Load-bearing for reconciliation and unmeasured | 2026-08-12 | Engineering |
| `gasUsedWei` carries gas units, not wei | MEASURED_EXTERNAL | Byte-identical to `receipts[0].gasUsed`. No artifact committed here | 2026-08-11 | Engineering |
| An organization daily spending cap answers HTTP 403 `Daily spending cap exceeded` | DOCUMENTED | Snapshot S2. New failure branch; `docs/THREAT_MODEL.md` T16 | 2026-08-12 | Engineering |
| **A reverted broadcast is distinguishable from a transport failure** | ASSUMED | **Still unmeasured.** Phase 0.5 built the experiment that settles it (`P09`, `P10`, `P11` in `packages/seam-probe`) and could not run it: no credential exists in this repository. See `docs/phase-logs/PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md` section 2 | 2026-08-12 | Engineering |
| Whether KeeperHub pre-simulates a `simulate: false` request and refuses a would-revert broadcast | ASSUMED | Not stated on any page retrieved; confirmed silent on 2026-08-12. `P09` and `P10` settle it, and the answer decides the Phase 0.5 gate | 2026-08-12 | Engineering |
| Whether replaying a key after a lost response returns the original execution | ASSUMED | The documented replay window says a response is replayed; it says nothing about a request whose response was never received. `P11` | 2026-08-12 | Engineering |
| Whether `gasLimitMultiplier` below 1.0 is honored or clamped | ASSUMED | Undocumented. `P10` depends on it and records the answer either way | 2026-08-12 | Engineering |

### Seam behavior encoded in `@resurv/keeperhub-client`

Added by the Phase 0 remediation, when the independent review found each of these asserted as
fact in code and in `docs/RUNBOOKS.md` with no ledger row at any level. Phase 0.5 gave each one
a committed source pointer or downgraded it. Five moved up, one is now contradicted by the
vendor's own documentation, and none has been reproduced live from this repository.

| Claim | Status | Evidence | Last checked | Owner |
|---|---|---|---|---|
| A 401 envelope is `{error}` alone, with no detail and no `request_id` | ASSUMED, **contradicted by official documentation** | Snapshot S1 and S3 both state that every error carries `request_id`. `errors.ts` encodes the opposite from the Phase 0 author's reading. `P02` settles which is true on the wire | 2026-08-12 | Engineering |
| The documented error envelope is `{error, detail, request_id}` with optional `hint` and `docs` | DOCUMENTED | Snapshot S3, quoted | 2026-08-12 | Engineering |
| Three different error envelope shapes appear in official examples | DOCUMENTED (conflicting) | Snapshot section 2: `{error, detail, request_id}`, `{error, field, details}`, `{error, message, required_scope, granted_scope}`. `errors.ts` parses the first only, which is a known gap | 2026-08-12 | Engineering |
| `request_id` is present on responses and worth surfacing to support | DOCUMENTED | Snapshot S1, S3 | 2026-08-12 | Engineering |
| The receipt status set is `success`, `reverted`, `safe_inner_failure`, `not_found`, `timeout` | DOCUMENTED | Snapshot S2. The Phase 0 remediation recorded that `safe_inner_failure` "appears nowhere outside our own source"; that was wrong, it is on the current Direct Execution page | 2026-08-12 | Engineering |
| `reverted` and `safe_inner_failure` mean the attempt failed onchain | ASSUMED | The mapping the probe exists to test. `safe_inner_failure` additionally implies an outer transaction that *succeeded*, which is `docs/THREAT_MODEL.md` T15 | 2026-08-12 | Engineering |
| `X-Poll-Interval-Hint` carries seconds, and `0` means terminal | DOCUMENTED | Snapshot S2, quoted: "A value of `0` means the execution has reached a terminal state (`completed` or `failed`) and you can stop polling" | 2026-08-12 | Engineering |
| The rate limit is 60 requests per minute per key | DOCUMENTED (conflicting) | Snapshot S2 says 60 per key for Direct Execution; S1 says 100 per minute for authenticated users. `constants.ts` encodes 60 and stays there, because the lower of two documented numbers is the safe one | 2026-08-12 | Engineering |
| `X-RateLimit-*` on every response and `Retry-After` on 429 only | DOCUMENTED | Snapshot S3. Also: anti-abuse endpoints omit `X-RateLimit-Remaining`, so a client must not require it | 2026-08-12 | Engineering |
| A 409 carries `idempotency_conflict` for a differing body and `idempotency_in_progress` for a running attempt | DOCUMENTED | Snapshot S3, with `retryable: false` and `retryable: true` respectively | 2026-08-12 | Engineering |

## RESURV mechanism

| Claim | Status | Evidence | Last checked | Owner |
|---|---|---|---|---|
| The reference covenant state machine transcribes PRD 9.1, with one inferred edge | VERIFIED (model only) | `test_libraryAgreesWithTheReferenceModelOnEveryPair` and the TypeScript equivalent compare all 64 ordered pairs against an independent transcription that never calls the implementation. Nine of the ten edges are drawn in 9.1; `TRIGGERED -> SATISFIED` is inferred from 9.1's closing note and PRD 8.4, and both model files state that decision in a comment. The word "exactly" stood here until the pre-seam hardening pass and was wrong for a transcription that adds an edge the diagram does not draw | 2026-08-12 | Contracts |
| A terminal covenant state is absorbing | VERIFIED (model only) | `invariant_terminalStateIsAbsorbing` judged against the reference model's terminal set, plus `test_regression_terminalStatesReachNothingAtAll`. Adversarially checked: 5 source mutations, each detected. See `docs/phase-logs/PHASE_00_REMEDIATION.md` | 2026-08-11 | Contracts |
| Covenant status ordinals agree between Postgres and TypeScript | VERIFIED | `packages/db/test/schema.test.ts` compares `onchainStatusEnum.enumValues` against `allCovenantStatusNames()`, a genuine shared oracle | 2026-08-11 | Contracts |
| Covenant status ordinals agree between Solidity and TypeScript | VERIFIED (source level) | `packages/repo-policy/test/cross-language-state-machine.test.ts` parses the Solidity enum and compares names and ordinals against `@resurv/domain`. Source-level, not a comparison of compiled artifacts or of a live decoded event | 2026-08-11 | Contracts |
| The Solidity and TypeScript state machines permit the same transitions | VERIFIED (source level) | The same test compares the two reference model tables character for character, and each language's suite pins its implementation to its own model | 2026-08-11 | Contracts |
| An atomic attempt reverts the action when the outcome is false | ASSUMED | Requires the covenant contract, a Foundry invariant, and a Base Sepolia proof | Pending | Contracts |
| Successful action, verifier and fee release share one transaction | ASSUMED | Requires a linked transaction and its events | Pending | Contracts |
| A duplicate trigger cannot produce a second payment | ASSUMED | Requires contract and live replay tests | Pending | Contracts |
| A crash between send and response cannot double-submit | ASSUMED | Idempotency key derivation and canonical body hashing exist and are unit-tested; the kill-the-network replay has not been run | Pending | Engineering |

## Repository and tooling

Added by the Phase 0 remediation. These are claims the project makes about itself, and the
review found three of them stated above their evidence.

| Claim | Status | Evidence | Last checked | Owner |
|---|---|---|---|---|
| No declared secret of six characters or more survives serialization, at any nesting depth | VERIFIED | `packages/config/test/redact.test.ts`: nested objects, nested arrays, objects in arrays, Maps, Sets, Errors and cycles, against eight deterministic fake credential shapes. The length qualifier is real: `MIN_KNOWN_SECRET_LENGTH = 6` skips a known value shorter than that, so a schema-valid four-character `kh_1` survives under an innocent key while being redacted under its own. Every realistic key is far longer, and the threshold is what keeps redaction from shredding ordinary text | 2026-08-12 | Engineering |
| `/api/health` never echoes a secret value | VERIFIED | `apps/worker/test/health.test.ts`, plus the independent reviewer's five malformed-environment probes | 2026-08-11 | Engineering |
| The unhandled-error log line cannot carry a secret | VERIFIED | `apps/worker/test/health.test.ts` drives the error path with a binding that throws a message containing a fake key. The walker no longer throws on a hostile getter, which it did until the pre-seam hardening pass | 2026-08-12 | Engineering |
| CI fails if a secret-bearing file is ever tracked | VERIFIED | `packages/repo-policy/test/tracked-secrets.test.ts`: 28 caught fixtures, 11 permitted fixtures, plus live `git ls-files` and full-history scans. Covers every category `.gitignore` protects, compared line by line rather than by substring | 2026-08-12 | Engineering |
| Deployment, secret mutation and signing are not auto-approved for Claude Code, wrapper forms included | VERIFIED (policy level) | `packages/repo-policy/test/permission-boundary.test.ts`. This is a check of our own configuration against Claude Code's documented matching, not a sandbox. See `docs/THREAT_MODEL.md` T10 and T11 | 2026-08-11 | Engineering |
| Host credential stores outside this repository are not readable from an auto-run Bash command | VERIFIED (policy level) | `packages/repo-policy/test/credential-surfaces.test.ts` asserts `deny`, not "not allow", for `~/.wrangler`, `~/.config/gh`, `~/.npmrc`, `~/.claude.json`, `~/.docker`, gcloud, `~/.netrc`, `~/.git-credentials` and the environment-dump forms, in tilde, `$HOME` and absolute spellings. Demonstrated live: `ls -d ~/.npmrc` ran with no prompt before the change and was denied after. Residual in `docs/THREAT_MODEL.md` T13 | 2026-08-12 | Engineering |
| Every auto-approved package script still runs the reviewed command graph | VERIFIED (policy level) | `packages/repo-policy/test/approved-scripts.test.ts` enumerates all 51 scripts reachable from an allow rule, root scripts included, pins each body, and rejects any leaf outside the approved command graph. Ten mutations run, all caught, in `docs/phase-logs/PRE_SEAM_HARDENING.md`. A drift guard, not protection against a contributor who edits the policy in the same change | 2026-08-12 | Engineering |
| Every committed CI job can pass on a clean GitHub runner | ASSUMED | The workspace job now installs Foundry and submodules, which it did not before, and `packages/repo-policy/test/ci-workflow.test.ts` derives that requirement from the script graph. The workflow-equivalent commands were run locally and in a fresh clone. No CI run has ever happened: this repository has no git remote | 2026-08-12 | Engineering |
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
- Any claim that a CI job passes. This repository has no git remote and no CI run has ever
  happened. The jobs are now capable of passing, which is a different statement.
- Any claim that the covenant state machine is proven at the contract level. Every
  `VERIFIED (model only)` row above is about a pure library, not about a deployed covenant.
- Any claim about what KeeperHub does when a broadcast transaction reverts, when a response is
  lost, or when a key is replayed after a crash. Phase 0.5 built the experiment and could not
  run it. Until it runs, the only honest statement is that the behavior is unmeasured.
- Any claim that a transaction receipt with status `0x1` proves a RESURV attempt succeeded.
  `safe_inner_failure` is a documented receipt status, so an outer transaction can succeed while
  the inner call failed. Confirmation requires the expected event, not the receipt alone.
  `docs/THREAT_MODEL.md` T15.

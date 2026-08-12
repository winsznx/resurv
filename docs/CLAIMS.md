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

| Claim | Status | Evidence | Last checked | Owner |
|---|---|---|---|---|
| Direct Execution supports simulation and idempotency | DOCUMENTED | Official Direct Execution API docs | 2026-08-04 | Tim |
| Idempotency replay window is 24 hours | DOCUMENTED | Official Direct Execution API docs | 2026-08-04 | Tim |
| Failed marketplace workflow calls are not charged | DOCUMENTED | Official Marketplace docs | 2026-08-04 | Tim |
| There is no list-executions endpoint | DOCUMENTED | Endpoint reference lists no such route. Load-bearing premise of ADR-004; unverified against a live 404 | 2026-08-11 | Engineering |
| Base Sepolia is enabled for our organization | MEASURED_EXTERNAL | Live `GET /api/chains`: chainId 84532, `isEnabled: true`. No artifact committed here | 2026-08-10 | Engineering |
| Base Sepolia does **not** use a private mempool | REFUTED (as a benefit) | Live `GET /api/chains`: `usePrivateMempoolRpc: false` on 84532, true only on Ethereum mainnet/Sepolia | 2026-08-10 | Engineering |
| Gas is sponsored on Base Sepolia for this org | MEASURED_EXTERNAL | Org wallet held 0 ETH, transaction landed, `sponsored: true`. No artifact committed here | 2026-08-11 | Engineering |
| `msg.sender` at the target equals the org wallet under `sponsored: true` | MEASURED_EXTERNAL | Decoded event sender `0xfd35…834c` while `receipt.from` was a relayer and `receipt.to` a router. No artifact committed here | 2026-08-11 | Engineering |
| `/contract-call` 202 carries no `transactionHash` | MEASURED_EXTERNAL | Live 202 body was `{executionId, status:"completed"}` only; hash appeared solely on the status endpoint. No artifact committed here | 2026-08-11 | Engineering |
| `unconfirmed` is a real, non-terminal status absent from the endpoint reference | DOCUMENTED (conflicting) | Endpoint reference lists four statuses; the first-verified-transaction guide describes a fifth | 2026-08-10 | Engineering |
| A would-revert simulation answers HTTP 400 with `wouldRevert` in the body | DOCUMENTED | Direct Execution docs | 2026-08-10 | Engineering |
| Simulation can pass while the payer holds zero balance | MEASURED_EXTERNAL | `simulate: true` returned `wouldRevert: false` with a 0-ETH sender. No artifact committed here | 2026-08-11 | Engineering |
| `gasUsedWei` carries gas units, not wei | MEASURED_EXTERNAL | Byte-identical to `receipts[0].gasUsed`. No artifact committed here | 2026-08-11 | Engineering |
| **A reverted broadcast is distinguishable from a transport failure** | ASSUMED | **Unmeasured. This is RESURV's core demo path and nothing has probed it yet.** | Pending | Engineering |

### Seam behavior encoded in `@resurv/keeperhub-client` with no prior status

Added by the Phase 0 remediation. The independent review found each of these asserted as fact
in code and in `docs/RUNBOOKS.md` with no ledger row at any level. None has been reproduced
from this repository. Each is an input to the Phase 0.5 seam probe, not an output of it.

| Claim | Status | Evidence | Last checked | Owner |
|---|---|---|---|---|
| A 401 envelope is `{error}` alone, with no detail and no `request_id` | ASSUMED | Encoded in `errors.ts` from the Phase 0 author's reading; no committed source pointer | Pending | Engineering |
| A 404 envelope is `{error, detail, request_id}` | ASSUMED | As above | Pending | Engineering |
| `request_id` is present on some responses and worth surfacing to support | ASSUMED | As above | Pending | Engineering |
| The receipt status set is `success`, `reverted`, `safe_inner_failure`, `not_found`, `timeout` | ASSUMED | `safe_inner_failure` appears nowhere outside our own source. Treated as a closed union by `classifyReceiptStatus`, which is a hypothesis | Pending | Engineering |
| `reverted` and `safe_inner_failure` mean the transaction reverted onchain | ASSUMED | The mapping the seam probe exists to test. Do not read a passing probe as confirmation without recording the response | Pending | Engineering |
| `X-Poll-Interval-Hint` carries seconds, and `0` means terminal | ASSUMED | Encoded in `status.ts`; no committed source pointer | Pending | Engineering |
| The rate limit is 60 requests per minute per key, with `Retry-After` honored | ASSUMED | Encoded in `constants.ts`; no committed source pointer | Pending | Engineering |
| A 409 carries `idempotency_conflict` for a differing body and `idempotency_in_progress` for a running attempt | ASSUMED | Encoded in `idempotency.ts` and `docs/RUNBOOKS.md`; no committed source pointer | Pending | Engineering |

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
| The KeeperHub source snapshot and seam checklist deliverable exists | REFUTED | PRD 2429 names it and `docs/phase-logs/PHASE_00.md` marked it PASS. No such artifact is in the repository. Outstanding input to Phase 0.5 | 2026-08-11 | Engineering |

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

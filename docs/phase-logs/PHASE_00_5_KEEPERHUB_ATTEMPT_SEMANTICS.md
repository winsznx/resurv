# Phase 0.5, KeeperHub attempt semantics

Date: 2026-08-12. Base commit: `f0958af`. Session: one.

Verdict: **`USER ACTION REQUIRED`**. No `SEAM PASS`, `SEAM REVISE` or `SEAM FAIL` is issued,
because the measurement the gate grades has not happened. Section 2 says exactly why and what
unblocks it.

Everything in this phase that does not need a credential was completed: the source-lock
deliverable Phase 0 marked PASS and never produced, independent verification of the seam
fixture from this repository, and the full probe harness with all twelve scenarios built,
typechecked and covered by offline tests. One command runs the measurement the moment a
credential exists.

No KeeperHub call was made from this repository. No transaction was broadcast. No credential
was read, printed, copied or inferred, and none was copied from any sibling repository.

---

## 1. What this phase was asked to settle

> Can RESURV distinguish the state of one semantic recovery attempt strongly enough that it
> never advances to another recovery action while the previous action could still produce an
> onchain effect?

That question decides the covenant contract's shape and the orchestrator's advancement rule, so
the PRD puts it before Phase 1 rather than inside it. `docs/CLAIMS.md` has carried the load-bearing
half of it, "a reverted broadcast is distinguishable from a transport failure", as `ASSUMED` and
unmeasured since Phase 0.

**It is still `ASSUMED`.** Documentation cannot promote it and this session did not measure it.
Section 6 explains what the current official documentation does and does not say, and section 7
says which of the twelve states each probe scenario would settle.

---

## 2. The credential boundary

The session brief stated that a local ignored KeeperHub credential was present through the
repository's established runtime configuration path. It is not present, and this was checked
before anything was built on the assumption that it was.

`packages/seam-probe/src/local-env.ts` probes every runtime configuration path this repository
establishes, reports each one by name, and reports environment variable *names* that could
carry the credential under a different spelling. Its output, verbatim, with no value anywhere
in it because the module cannot emit one:

```
USER ACTION REQUIRED
runtime configuration file found: (none)
  ENOENT  .env
  ENOENT  .env.local
  ENOENT  .dev.vars
  ENOENT  apps/worker/.dev.vars
  ENOENT  apps/worker/.env
names assigned: (none)
names already in the process environment: (none)
credential-shaped variable names visible to this process: (none)
KEEPERHUB_API_KEY is not set
```

Corroborated independently: a directory listing of the repository root shows `.env.example` and
no `.env`, and `find . -maxdepth 3 -type f -name ".*"` returns `.gitmodules`, `.gitignore` and
`.env.example` only.

Why five paths rather than the one `docs/RUNBOOKS.md` names. `wrangler dev` reads `.dev.vars`
by itself, so a credential placed for the Worker would land there, and PRD 12.2 calls the
variable `KH_API_KEY` while this repository standardized on `KEEPERHUB_API_KEY`. A session that
checked one path and one spelling could report a missing credential that was actually present,
which is a worse failure than the one being reported. `credentialShapedEnvNames()` closes the
spelling half: it matched nothing.

### What this session did not do about it

- did not copy a credential from `keeperhub-flightcheck` or any other repository;
- did not create, edit or read any environment file;
- did not ask for the value, and would not accept it in conversation if offered;
- did not proceed on a mock, a recorded fixture or a sibling repository's numbers, and did not
  promote a single claim on the strength of them.

### The unblock, in full

```bash
cp .env.example .env    # then paste the kh_ organization key with an editor
pnpm --filter @resurv/seam-probe test:seam
```

The variable is `KEEPERHUB_API_KEY`. Its value is an organization key beginning `kh_`. A `wfb_`
webhook key cannot execute and the probe rejects it before any request leaves the process. The
first command is a human step by design: Claude Code's deny rules block that path, which is the
control `docs/THREAT_MODEL.md` T13 describes.

---

## 3. What was delivered

| Deliverable | State |
|---|---|
| `docs/keeperhub/SOURCE_SNAPSHOT.md` | **new.** The PRD 28 deliverable Phase 0 marked PASS without producing. 11 official pages retrieved 2026-08-12, every behavior graded |
| `docs/keeperhub/SEAM_CHECKLIST.md` | **new.** PRD 21.4 mapped to scenarios, plus the twelve states and which scenario settles each |
| `packages/seam-probe` | **new.** 12 scenarios, credential loader, evidence sanitizer, chain reconciler, 29 offline tests |
| Fixture verification | **new.** The canary verified from this repository against a public node, section 5 |
| `packages/repo-policy` | the live suite is classified as an external effect and cannot be auto-approved. 391 tests, up from 381 |
| `docs/CLAIMS.md` | nine rows corrected against the retrieved sources. No behavioral row promoted |
| `docs/THREAT_MODEL.md` | two new threats, T15 and T16, both found by reading the documentation |
| `docs/BUILD_STATE.md`, `docs/RUNBOOKS.md`, `docs/PROOF_LADDER.md` | updated for the above |

`docs/DECISIONS.md` gains no ADR. The attempt lifecycle is the thing being measured, and
recording an architecture decision about it now would be recording a guess.

---

## 4. The probe

`pnpm --filter @resurv/seam-probe test:seam`. Deliberately outside `pnpm gate` and outside every
auto-approved command.

### It records, it does not assert

Every scenario writes an evidence file and asserts only that the evidence is complete and
credential-free. There is no expectation about what KeeperHub returns, because that is the
measurement. A probe that asserted `expect(status).toBe('failed')` for a reverted broadcast
would pass or fail on the author's prior belief rather than on the platform's behavior, which is
the same defect ADR-009 records for a property test whose generator is filtered by the
implementation under test.

The second live file, pinning the observed behavior so a future KeeperHub change fails a test,
is not written. Nothing has been observed. It is the first thing the completing session adds.

### The twelve scenarios

| Id | Question | Which of the twelve states |
|---|---|---|
| `P00` | Is the credential live, is Base Sepolia enabled, what is the org identity | preflight |
| `P01` | What is refused locally, with zero network exposure | 1 |
| `P02` | What an authentication failure returns, with a wrong key and with no key | 2 |
| `P03` | Does a simulation answer, what is `from`, does it touch chain | 3 |
| `P04` | Is a would-revert simulation an answer or an error | 3 |
| `P05` | What an accepted broadcast returns, and whether chain agrees | 4, 5, 6, 12 |
| `P06` | Does replaying the same key create a second economic effect | 10 |
| `P07` | Same key, different body | 10 |
| `P08` | Does a new key permit a second execution of the same action | 11 |
| `P09` | Does KeeperHub broadcast a call it can predict will revert | 7 |
| `P10` | A valid call starved of gas: is a reverted broadcast distinguishable | **7, and the dominant question** |
| `P11` | The client got no usable response: can RESURV find out what happened | **8, and the dominant question** |
| `P12` | What KeeperHub says about an execution id it has never seen | 9 |

`P01` is the only one measurable without a credential, and it is measured: `isApiKeyShapeValid`
rejects a `wfb_` key, an unprefixed key and a bare prefix, and `idempotencyPreimage` throws on a
field containing the `|` separator, all with zero HTTP requests.

### Two revert paths, because one may not be reachable

`P09` submits a call whose selector the canary does not implement. If KeeperHub pre-simulates
before broadcasting, it refuses and nothing lands. That is a finding, not a failure, and the
Phase 0.5 prompt anticipated it: a purpose-built fixture would not change the answer, and the
result is a `SEAM REVISE` rather than a workaround.

`P10` therefore submits a **valid** call starved of gas. The gas limit is computed at run time
from the intrinsic cost of the transaction and its measured execution cost, so estimation
succeeds and the call runs out of gas inside the contract. That produces a broadcast that
reverts onchain without a purpose-built contract, a deployer key, a faucet, or any dependence on
third-party protocol state. Both paths are recorded whatever happens, including whether
`gasLimitMultiplier` below 1.0 is honored at all, which no page documents.

### The transport-failure experiment, and its honest limit

`P11` sends a real, complete request and stops listening 250 ms later. Nothing is mocked and no
local error is substituted for a network one: the request reaches KeeperHub and KeeperHub does
whatever it does. The client is left in exactly the state T3 describes, holding an idempotency
key and a canonical body hash and no response.

What it cannot reproduce: a partition that drops the response after KeeperHub commits, at a
moment of KeeperHub's choosing rather than the client's. Inducing that needs infrastructure
manipulation this project will not perform, and saying so is more useful than a test that
pretends otherwise. A client-side abort is the nearest reproducible ambiguity case and it is
genuinely ambiguous from the client's side, which is the property under test.

`P11` then tries all three recovery routes in order and records which work:

1. list the executions, `GET /api/execute` and `GET /api/executions`;
2. replay the stored idempotency key with a byte-identical body;
3. ask chain, by searching for the attempt's own challenge word in the canary's logs.

Route 3 is the only one that cannot be taken away by an API change, which is why the fixture is
built around an attributable challenge word rather than a bare counter.

### Evidence

One JSON file per scenario under `docs/phase-logs/evidence/phase-00-5/`, plus an index. Each
carries the semantic attempt id, the request body and its hash, the idempotency key, every HTTP
status, the sanitized response body and headers, the execution id, every KeeperHub status
transition with timing, the transaction hash, the receipt from **both** pinned RPC origins with
their agreement recorded, the block number, any recoverable revert reason, and the count of
onchain effects attributable to that scenario's challenge.

### The sanitizer, and why it is not `@resurv/config`'s

`redact` in `@resurv/config` fails closed on `0x` followed by 64 hex characters, because an EVM
private key and a transaction hash are the same 66 characters. Its own source says public chain
data belongs in a proof serializer instead. A seam report whose transaction hashes are all
`[redacted]` proves nothing, so `packages/seam-probe/src/sanitize.ts` is that proof serializer:
it removes credential shapes, the exact loaded credential, and authorization-bearing headers by
name, and it keeps hashes, addresses, topics and calldata.

Both halves of that trade are pinned by `test/offline/sanitize.test.ts`, so a future change that
"hardens" the sanitizer by adding the 32-byte rule back fails a test rather than silently
gutting the evidence. `writeEvidence` then re-scans the serialized output and throws
`CredentialLeakError` rather than write a file that still matches a credential shape. The test
for that guard uses the one shape the walker genuinely cannot reach, a credential arriving as an
object *key* rather than a value.

---

## 5. The fixture, verified from this repository

`0x2A6FC8182Bf9928Ef7517dA980dC79e8107c555A` on Base Sepolia, against
`https://sepolia.base.org`, 2026-08-12:

```
cast code 0x2A6F…555A                     139 bytes of runtime
cast selectors <runtime>                  0x33d425c4  uint256  view   (one entry, only entry)
cast sig "ping(bytes32)"                  0x33d425c4
cast call  "ping(bytes32)" 0x…01          0x
cast call  "resurvSeamNoSuchFunction()"   execution reverted
cast estimate "ping(bytes32)" 0x…01       23557
```

The runtime is
`6080604052348015600e575f80fd5b50600436106026575f3560e01c806333d425c414602a575b5f80fd5b…`:
one selector compare and `5f80fd`, a bare `revert(0, 0)`, as the default arm. No fallback, no
receive. So both halves of the deterministic pair are properties of the bytecode rather than of
anyone's protocol state, which is what the Phase 0.5 prohibition on "unpredictable DeFi protocol
state" requires.

Every probe call carries value 0. The organization wallet holds no ETH under sponsorship, so a
value-carrying call to a non-payable function would revert on balance rather than on payability
and would confound the measurement.

The contract emits one LOG3 per successful `ping`, topic0
`0x4947ef22330e8e81cdedf82c33d366e9c942511f5edf79140686b33af9de7f33`, with the caller and the
challenge indexed and the chain id as data. The event's Solidity name is not published anywhere
this repository can reach, so the probe treats topic0 as opaque and decodes the two indexed
parameters by shape. That is deliberate: the alternative is to invent a name and record it as if
it were known.

Why no purpose-built contract. Deploying one needs `forge script --broadcast`, a funded deployer
key and a faucet trip. KeeperHub sponsors the calls it executes, not a Foundry deployment, so
that is a separate blocker for a fixture that adds nothing the canary lacks.

---

## 6. Source lock, and what it corrects

Full record in `docs/keeperhub/SOURCE_SNAPSHOT.md`. The findings that change how this project
behaves:

**Three documented error envelopes, not one.** `/api/errors` and `/api` both give
`{error, detail, request_id}` with optional `hint` and `docs`. `/api/direct-execution`'s generic
example gives `{error, field, details}`, with `details` rather than `detail`. Its
insufficient-scope example gives `{error, message, required_scope, granted_scope}`.
`packages/keeperhub-client/src/errors.ts` parses the first shape and none of the others. That is
a real gap and it is not closed here, because closing it without a measured response body means
guessing which shape the live endpoint actually emits.

**The 401 claim is contradicted.** `docs/CLAIMS.md` has carried "a 401 envelope is `{error}`
alone, with no detail and no `request_id`" as `ASSUMED`. Both `/api` and `/api/errors` say every
error carries `request_id`. The claim stays `ASSUMED` and now records that official documentation
disagrees with it. `P02` settles it.

**`unconfirmed` has no locatable source.** The ledger rated it `DOCUMENTED (conflicting)`,
citing "the first-verified-transaction guide". The word appears on none of `/api/direct-execution`,
`/api/executions`, `/getting-started/api` or `/keeper-runs/status-logs` as retrieved on
2026-08-12. Downgraded to `ASSUMED`. The code needs no change: `status.ts` maps every
unrecognized value to `UNKNOWN` and non-terminal, so the special case costs nothing and removing
it would gain nothing.

**`safe_inner_failure` is documented after all.** The ledger said it "appears nowhere outside our
own source". It is on the current Direct Execution page, in the documented `receiptStatus` union.
This is a correction to our own record, and section 8 explains why it matters more than a
correction usually would.

**Two official rate limits.** `/api/direct-execution` says 60 requests per minute per API key.
`/api` says 100 per minute for authenticated users. `constants.ts` encodes 60 and stays at 60:
the lower of two documented numbers is the safe one.

**`X-Poll-Interval-Hint` is documented, verbatim.** "A value of `0` means the execution has
reached a terminal state (`completed` or `failed`) and you can stop polling." Our implementation
already matches. The ledger row moves from `ASSUMED` to `DOCUMENTED`.

**Both 409 codes are documented,** with `retryable: false` for `idempotency_conflict` and
`retryable: true` for `idempotency_in_progress`. So is `idempotentReplay: true` on a replayed
response, which this repository did not know about and which `P06` now looks for.

**The list-executions premise needs a qualifier.** ADR-004 rests on "there is no list-executions
endpoint". True for direct execution. False for workflows, where
`GET /api/workflows/{workflowId}/executions` is documented. The ADR means the first and should
say so. An absence in documentation is also not a 404, which is why `P11` asks the API directly.

**`usePrivateMempoolRpc` is weaker than the name suggests.** `/api/chains` says it "describes a
chain capability, not the route used by a specific transaction". Even where true it would not
establish that a given transaction was privately routed. This strengthens the existing
`REFUTED (as a benefit)` row rather than changing it.

**Gas sponsorship has documented eligibility rules.** Fee only, never the asset. Base and its
testnets are eligible. The active sender must be the wallet, not a Safe. Private-mempool routes
are not sponsored. Testnet usage does not consume the monthly credit allowance, so neither the
probe nor the demo can exhaust it.

### Documentation is not measurement

Nine rows move in `docs/CLAIMS.md`. Not one of them is about broadcast, revert, transport
failure or reconciliation, because those are the rows the probe exists to settle and no page can
settle them. `docs/keeperhub/SOURCE_SNAPSHOT.md` section 11 lists ten behaviors the current
documentation does not state at all.

---

## 7. The attempt lifecycle, as a design under stated assumptions

The Phase 0.5 prompt asks for the canonical state machine to be derived from measured behavior
and warns against forcing evidence into a proposed model. There is no evidence yet, so what
follows is **not** presented as the canonical machine. It is the model that follows from the
documented semantics plus the one rule that holds no matter what the measurement says, with
every edge carrying the evidence level it currently has and the scenario that would settle it.

### The rule that does not depend on the measurement

> If the previous semantic attempt might still produce an economic effect, RESURV must not
> advance to the next recovery action.

This is a safety property, not an observation, so it survives any measurement outcome. What the
measurement decides is how often RESURV can *leave* the ambiguous state, and by what evidence.

### States

| State | Entry | Authority | May RESURV start another semantic action | Terminal |
|---|---|---|---|---|
| `PLANNED` | a semantic attempt id and canonical body exist, nothing sent | RESURV store | yes, this one has no effect | no |
| `REJECTED_LOCALLY` | refused before any socket opened | RESURV, offline | yes | yes |
| `SIMULATED_OK` | `simulate: true` returned `wouldRevert: false` | KeeperHub body | yes, nothing was broadcast | no |
| `SIMULATION_REJECTED` | `simulate: true` returned `wouldRevert: true` | KeeperHub body | yes, nothing was broadcast | yes |
| `SUBMITTED` | key and body hash persisted, POST in flight | RESURV store | **no** | no |
| `ACCEPTED` | a 2xx carrying an `executionId` | KeeperHub | **no** | no |
| `RECONCILIATION_REQUIRED` | any outcome that is not a chain-confirmed terminal state | nothing yet, that is the point | **no** | no |
| `CONFIRMED` | chain receipt status `0x1` **and** the expected effect present in its logs | chain, cross-origin | yes | yes |
| `REVERTED` | chain receipt status `0x0`, or a receipt reporting an inner failure | chain, cross-origin | yes, the attempt had no effect | yes |
| `PROVEN_NOT_BROADCAST` | no transaction exists after the settlement window, and the onchain attempt id was never consumed | chain | yes | yes |

`SUBMITTED` and `ACCEPTED` are separate because the persisted idempotency key is what makes
recovery possible, and it has to exist before the socket opens. `ADR-004` already rests on that
and `packages/db` already models it: `idempotency_key_hash` is `NOT NULL` and unique while
`execution_id` and `transaction_hash` are nullable.

### Edges, and what each one currently rests on

| Edge | Evidence level | Settled by |
|---|---|---|
| `PLANNED -> REJECTED_LOCALLY` | **MEASURED** | `P01`, no network involved |
| `PLANNED -> SIMULATED_OK` | `DOCUMENTED` | `P03` |
| `PLANNED -> SIMULATION_REJECTED` | `DOCUMENTED` | `P04` |
| `SIMULATED_OK -> SUBMITTED` | design | — |
| `SUBMITTED -> ACCEPTED` | `DOCUMENTED` | `P05` |
| `SUBMITTED -> RECONCILIATION_REQUIRED` on a lost response | **ASSUMED** | `P11` |
| `ACCEPTED -> CONFIRMED` | `REQUIRES MEASUREMENT` | `P05` plus the chain read |
| `ACCEPTED -> REVERTED` | **ASSUMED, the dominant question** | `P09`, `P10` |
| `ACCEPTED -> RECONCILIATION_REQUIRED` on `timeout` or `not_found` | `DOCUMENTED` receipt values, unmeasured behavior | `P05`, `P12` |
| `RECONCILIATION_REQUIRED -> CONFIRMED \| REVERTED` | `REQUIRES MEASUREMENT` | `P10`, `P11` |
| `RECONCILIATION_REQUIRED -> PROVEN_NOT_BROADCAST` | **ASSUMED** | `P11`. This is the edge that decides whether RESURV can ever safely retry |

### What each measurement would change

- If `P09` shows KeeperHub refuses to broadcast anything it predicts will revert, then
  `ACCEPTED -> REVERTED` is rare rather than routine, and the demo's "false outcome reverts the
  attempt" story has to be told through the contract's own revert rather than through a
  KeeperHub status. That is a `SEAM REVISE`.
- If `P10` shows a reverted broadcast settles as `failed` with a transaction hash and a
  `reverted` receipt status, then `ACCEPTED -> REVERTED` is directly observable, the claim is
  promoted, and the lifecycle above stands.
- If `P11` shows a key replay returns the original execution, `RECONCILIATION_REQUIRED` usually
  resolves in one request and RESURV can advance quickly. If it starts a second execution
  instead, the transport key is not a recovery mechanism at all, the only recovery is the chain
  read, and the onchain attempt id has to carry the whole burden. That is also a `SEAM REVISE`,
  and a larger one.
- If `P12` shows an unknown execution id is indistinguishable from one that is still settling,
  then `RECONCILIATION_REQUIRED` cannot be left on KeeperHub's word at all.

### One thing that is already decided

`CONFIRMED` requires a chain receipt **and** the expected effect in its logs. Not a KeeperHub
status, and not a receipt alone. PRD 12.6 already says "do not mark RESURV satisfied from
KeeperHub status alone", and section 8 turns that from a preference into a requirement.

---

## 8. Two new threats, both found by reading

### T15. A successful transaction that contains a failed attempt

The documented `receiptStatus` union includes `safe_inner_failure`, and the gas page says
sponsorship "uses direct wallet calls; applying it to Safe writes would alter `msg.sender` away
from the Safe itself", so a Safe route is a real execution mode on this platform.

When execution routes through a Safe, the outer transaction can succeed while the inner call
fails. A RESURV attempt executed that way would produce a receipt with status `0x1` while
`executeAttempt` reverted. A verifier that reads the transaction receipt would read that as
success. The entire product rests on a false outcome reverting the attempt.

Two consequences, both carried into `docs/THREAT_MODEL.md`:

1. RESURV must execute on the direct-wallet-sender path, which is also what gas sponsorship
   requires, so the constraints agree.
2. Reconciliation must treat an inner-failure receipt status as a failed attempt regardless of
   the outer receipt status, and must confirm the expected event rather than the receipt alone.

`INFERRED` from documentation, not measured. The probe records `sponsored` and the decoded
sender on every attempt so the assumption is checked rather than trusted.

### T16. A daily spending cap turns into a mid-incident refusal

`/api/direct-execution`: an organization can configure a daily spending cap in wei, and exceeding
it returns HTTP 403 with `Daily spending cap exceeded`. That is a failure mode that appears only
under load, which is exactly when a recovery covenant is executing. It is a different branch
from an authentication failure and must not be retried as one.

---

## 9. Repository changes

### New package

`packages/seam-probe`, eleven source and test files. `test` is offline and inside the gate;
`test:seam` is live and outside it.

`packages/repo-policy/src/dangerous-commands.ts` gains a `live-seam-execution` rule matching
`vitest run --dir test/live`, so the live suite is classified as an external effect. The existing
generic control, "auto-approves no workspace script that has an external effect", then covers it,
and `test/seam-probe-boundary.test.ts` names it explicitly so a change to the rule itself is
caught. `@resurv/seam-probe#test`, `#typecheck` and `#clean` were added to
`REVIEWED_AUTO_APPROVED_SCRIPTS`; `#test:seam` is reachable from no allow rule and is not in the
manifest.

**One thing this session could not do.** Adding `Bash(pnpm --filter @resurv/seam-probe test:seam)`
to the `ask` tier of `.claude/settings.json` was refused by the permission classifier, so that
file is unchanged. It costs nothing: ADR-010 already records that `ask` was measured not to
prompt in the mode this project's sessions run in, so the entry would have been documentation of
intent rather than a control. The controls that do carry weight, the absence of an allow rule and
the external-effect classification, are both in place. The real control is that no credential
exists, so the live suite cannot do anything even if it runs.

### Test counts, re-derived

| Suite | Before | After |
|---|---|---|
| `@resurv/domain` | 34 | 34 |
| `@resurv/keeperhub-client` | 30 | 30 |
| `@resurv/config` | 38 | 38 |
| `@resurv/db` | 7 | 7 |
| `@resurv/chain` | 7 | 7 |
| `@resurv/worker` | 7 | 7 |
| `@resurv/repo-policy` | 381 | 391 |
| `@resurv/seam-probe` | — | 29 |
| `@resurv/web` | 0 | 0 |
| **TypeScript substantive** | **504** | **543** |
| Foundry | 26 | 26 |

`pnpm test:integration` and `pnpm test:e2e` still contain zero specs and are still not counted.

### Gate

```
TURBO_FORCE=true pnpm gate       exit 0
  typecheck   Tasks: 11 successful, 11 total   Cached: 0 cached, 11 total
  test        Tasks: 11 successful, 11 total   Cached: 0 cached, 11 total
  contracts test            26 passed
  contracts test:invariant   5 passed
```

Eleven tasks where there were ten, which is the new package.

---

## 10. What is still open

| Item | Why |
|---|---|
| Every behavioral KeeperHub claim | No credential. Section 2 |
| The canonical attempt state machine | Section 7 is a design under stated assumptions, not a measurement |
| The second live test file, pinning observed behavior | Nothing has been observed |
| `errors.ts` parsing the other two documented envelope shapes | Would be guessing which one the live endpoint emits. `P02` decides it |
| `msg.sender` at a RESURV contract under sponsorship | Needs a RESURV contract. Phase 1, and the probe records the canary's answer meanwhile |
| Rung 5 of the proof ladder | Unchanged. Not reached from this repository |
| Whether an idempotency key is scoped per organization, per key or per endpoint | Not documented and not measurable in one run |

## 11. Next action

Create the environment file with the `kh_` organization key, then run
`pnpm --filter @resurv/seam-probe test:seam` in a fresh session with this log and
`docs/keeperhub/SEAM_CHECKLIST.md` open. That session reads the twelve evidence files, writes
the behavioral test file, replaces section 7 with the measured lifecycle, and issues the
`SEAM PASS`, `SEAM REVISE` or `SEAM FAIL` this one cannot.

Phase 1 was not started. Nothing in this session touched contracts, the orchestrator or the UI.

---

**`USER ACTION REQUIRED`** — `KEEPERHUB_API_KEY`, an organization key beginning `kh_`, in `.env`
at the repository root.

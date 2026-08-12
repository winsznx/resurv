# Phase 0.5, KeeperHub attempt semantics

Date: 2026-08-12. Base commit: `7c6281d`. Sessions: two, the second resuming after a credential
was created by a human.

Verdict: **`SEAM REVISE`**. KeeperHub is usable and a deterministic, safe RESURV attempt
lifecycle is supportable. The lifecycle this project was going to implement is not that
lifecycle, and three of its entry conditions are falsified by measurement. Section 8 states the
correction Phase 1 must implement and section 9 the exact advancement rule.

Live evidence: 16 scenarios, run four times over the session. The committed set is run label
`2026-08-12T16-18-19-787Z`; earlier runs are cited by label where they showed a branch the
committed run did not, because the transport-loss scenarios turn on a race and land differently
each time. Files in `docs/phase-logs/evidence/phase-00-5/`.

---

## 1. The question

> Can RESURV distinguish the state of one semantic recovery attempt strongly enough that it
> never advances to another recovery action while the previous action could still produce an
> onchain effect?

**Yes, with an explicit ambiguous state and a bounded reconciliation loop, and only because the
chain is consulted.** KeeperHub alone is not sufficient and never becomes sufficient: the case
that matters most, a response that never arrived, is resolvable through KeeperHub in bounded
time but is only *provable* on chain.

---

## 2. The eleven measured facts

Each one names the scenario that produced it. `packages/seam-probe/test/offline/measured-semantics.test.ts`
asserts every claim below against the committed JSON, so this section cannot drift away from its
evidence without failing `pnpm gate`.

### F1. `/api/execute/contract-call` is synchronous, and HTTP 202 is not acceptance

The POST blocks until the execution is terminal: several seconds for both the successful call
and the refused one, 4 to 8 seconds across runs. The response body carries the outcome.

A 202 can mean the attempt succeeded **or that it never happened**:

| | P05 | P09 |
|---|---|---|
| HTTP | 202 | 202 |
| body `status` | `completed` | `failed` |
| `transactionHash` | on the status endpoint | `null` |
| `receipts` | one, verified | `[]` |
| chain effects | 1 | 0 |

This falsifies the entry condition the previous design used for `ACCEPTED`, which was "a 2xx
carrying an `executionId`". P09 is a 2xx carrying an `executionId` and nothing was broadcast.

### F2. A call whose gas estimation reverts is never broadcast, deterministically

Three observations (P09, P14 twice), zero chain effects each. The refusal is reported as
`status: failed`, `sponsored: false`, `receipts: []`, and an error naming a **balance
shortfall**:

```
Insufficient BASE balance. Have: 0.0, Need: 0.000000231.
Fund 0xfd35…834c with at least 0.000000231 BASE on this chain and retry.
```

That message is misleading and a caller must not act on it. The controlled comparison is in the
same run, one variable changed: the same wallet, at the same zero balance, on the same chain,
executes the valid call with `sponsored: true`. Sponsorship is declined because gas estimation
reverts, and only then does the empty wallet matter.

**Consequence, and it is the reason this phase is `SEAM REVISE` and not `SEAM PASS`:** on this
configuration `ACCEPTED → broadcast → reverted onchain` is unreachable. Both routes to it
failed, and the second failed for a reason worth recording separately.

### F3. `gasLimitMultiplier` below 1.0 was accepted and did not reduce the gas limit

P10 sent `"0.951"`, computed at run time to land the gas limit between the transaction's
intrinsic cost (21,576) and its execution cost (23,929). It landed with a gas limit of 92,446
against 92,518 for the same call with no multiplier at all: a 0.08% difference where the
multiplier predicts 4.9%.

The comparison is a ratio and not an equality on purpose. Two runs of the identical call differ
by a few dozen gas, and an earlier version of the test asserting byte-equality passed once by
luck and failed on the next run. The gas-starvation route to an onchain revert does not exist
here, and that is the finding; the exact figures are not stable enough to quote as constants.

### F4. `completed` implies a chain receipt KeeperHub verified itself

Every `completed` execution carried `receipts[0].verified: true` with `receiptStatus: "success"`,
and every one was confirmed independently at status `0x1` by both pinned RPC origins. The
documented rule, "execution settles as `completed` only when all receipts verify successfully",
held on six of six.

### F5. Transport idempotency bounds effects to one per key

| Scenario | Key | Result | Effects |
|---|---|---|---|
| P05 | fresh | 202, execution created | 1 |
| P06 | same key, same body | 202, `idempotentReplay: true`, **same** `executionId` | still 1 |
| P07 | same key, different body | 409 `idempotency_conflict`, `retryable: false` | 0 from the new body |
| P08 | **new** key, same economic action | 202, new `executionId` | **2** |

P08 is the measurement that matters most for the contract. Replaying a key is safe; repeating
the *action* under a new key executes it again. **Transport idempotency is not semantic
idempotency, and nothing in KeeperHub provides the second.** That is what the onchain attempt id
is for, permanently, beyond the 24-hour window.

Nothing measured supports the phrase "exactly once". What was measured is "at most one economic
effect per idempotency key, within the replay window".

### F6. `idempotentReplay` is a reliable commit marker, and its absence is evidence

| Response | Meaning |
|---|---|
| 202 with `idempotentReplay: true` | an earlier request under this key was accepted |
| 202 without the field | this request is the one that committed the key |

Observed on both branches and cross-checked against timestamps every time. In the
`2026-08-12T15-35` run, P11's aborted request created its execution at `+264 ms` while the client
gave up at `+255 ms`, and the replay came back `idempotentReplay: true`. P13's aborted request
committed nothing, and its replay created the execution `575 ms` after the replay was sent, with
no flag.

The rule is what is asserted, not either outcome: the marker is present exactly when the
execution predates the replay. `measured-semantics.test.ts` checks that against the timestamps
in whichever run is committed, because which branch an abort lands on is a race and an assertion
that pinned one outcome would be a flaky test wearing a finding's clothes.

`readIdempotentReplay` in `@resurv/keeperhub-client` therefore returns a tri-state. Collapsing
absent into `false` would throw the information away.

### F7. A lost response is genuinely ambiguous, and both outcomes were observed

The same client-side observation, an abort at ~253 ms with no HTTP status at all, corresponds to
two opposite economic outcomes. Across four runs of the same scenario, the aborted request
sometimes committed and sometimes did not, and nothing available to the client at that moment
distinguishes them.

The race is narrow and real: in the one case where both timestamps are available, the execution
was created 264 ms after the request was sent and the client gave up at 255 ms. Nine
milliseconds decided whether an economic action happened.

This is the case `docs/THREAT_MODEL.md` T3 exists for, and it is no longer hypothetical.

### F8. Three recovery routes, measured, in order of strength

| Route | Result |
|---|---|
| List the executions | **Does not exist.** `GET /api/execute` and `GET /api/executions` both 404 `not_found`. ADR-004's load-bearing premise is now verified against a live 404 rather than an absence in documentation |
| Replay the key, byte-identical body | **Works.** 202 with the `executionId`, plus `idempotentReplay` telling you which side of F6 you are on; or 409 `idempotency_in_progress` with `retryable: true` while it is still running, in which case repeat the same key |
| 409 `idempotency_conflict` → `originalExecutionId` | **Sometimes works, and is documented nowhere.** P15 aborts a request, then deliberately sends a *different* body under the same key. In the `2026-08-12T15-35` run the 409 named `0uudacxzflm0nf2k9p92t`, which resolved to `completed` with a confirmed receipt. In the committed run it named nothing, because the aborted request had registered the key without creating an execution. **Key registration and execution creation are separate events**, so this is a bonus route and never the one to depend on. The conflicting body executed nothing in either case |
| Ask the chain | **Works, and is the only route that survives an API change.** P11 recovered `0x157d1e41…30326` from `eth_getLogs` alone, by searching for the attempt's own marker, in the run where the key replay reported only `idempotency_in_progress` |

Across every run, each of P11, P13 and P15 produced **at most one** onchain effect: one when the
key had committed, none when it had not, never two. That bound, not any particular outcome, is
what makes replaying a key safe.

### F9. `msg.sender` at the target is the organization wallet, and the receipt does not say so

Every transaction: `receipt.from` is a relayer `0xDcF4bac4bD805948168Ff63483BC493894A29613`,
`receipt.to` is a router `0x5aF5194B4b0909eB978e3Cf1e25333852277f07D`, and the decoded event
carries `0xfd35ae935de7be93ffd585d6627268d833ed834c`, the organization wallet, as the caller.

Access control at a RESURV contract must key on the organization wallet, and verification must
decode the log rather than read the receipt's `from`. This was `MEASURED_EXTERNAL` from a sibling
repository; it is now measured here, against a different contract.

`gasUsed` is about 45,850 on every call while a direct `ping` estimates 23,929, so the router
costs roughly 22,000 gas per attempt. That is a real number for the covenant's gas budget, and
it is quoted as approximate because it varies by a few dozen gas between otherwise identical
calls.

### F10. Three error envelope shapes, and the documentation is wrong about one

| Shape | Where | Body |
|---|---|---|
| A | 401; 404 for an unknown execution id | `{error}` **only** |
| B | 404 for an unrouted path | `{error: code, detail: sentence, request_id}` |
| C | both 409s | `{error: sentence, code, retryable, originalExecutionId?}` |

`error` is the machine code in B and the human sentence in C, on the same API. And shape A
carries no `request_id`, which both `/api` and `/api/errors` say every error carries. The
repository's own `ASSUMED` claim, written by the Phase 0 author with no source, was right and the
vendor's documentation is wrong.

`errors.ts` was updated from these observations only: `code ?? error` picks the machine value in
all three shapes, `detail ?? error` picks the human value in all three, and `retryable` and
`originalExecutionId` are now parsed because both are load-bearing. An unrecognized envelope
still normalizes rather than throwing.

### F11. Simulation is a real pre-check that touches nothing

P03: HTTP 200, `wouldRevert: false`, `from` = the organization wallet, `gasEstimate: 23917`,
zero chain effects. P04: HTTP 400, `wouldRevert: true`, `failureKind: "revert"`, no
`executionId`, zero chain effects.

Two smaller things. `failureKind` is undocumented and useful. And `revertReason` leaks an
ethers.js `CALL_EXCEPTION` string containing the whole transaction object rather than the clean
`Error(...)` string the documentation shows, so it is a diagnostic and never something to parse.

---

## 3. What could not be measured, stated plainly

| | Why it matters |
|---|---|
| A broadcast transaction reverting onchain | Both routes failed: KeeperHub refuses the call before broadcast (F2), and `gasLimitMultiplier` is ignored (F3). The residual is real: the refusal came with `sponsored: false` and a balance error, so a **funded** organization wallet might reach the broadcast and revert. RESURV must handle `REVERTED` even though this run never produced one |
| `safe_inner_failure` | Never observed. `result.executedCall.reverted` was `false` on every success. T15 stays a documented hazard, but the surface to watch is now known: `executedCall.reverted` and `receipts[].receiptStatus`, not the outer receipt |
| `pending` or `running` | The POST is synchronous, so a completed call never shows them. The only in-flight signal observed is 409 `idempotency_in_progress` on a replay |
| Behavior at the 24-hour idempotency boundary | Needs a 24-hour experiment. The onchain attempt id is what covers it regardless |
| Idempotency scope: per key, per organization, per endpoint | Not documented and not derivable from one organization |
| A partition that drops the response *after* KeeperHub commits, at KeeperHub's choosing | Needs infrastructure manipulation this project will not perform. A client-side abort reproduced the client's half, which is the half the control works from, and F7 shows it reproduced both economic outcomes |

---

## 4. One finding was my own bug, and it is recorded because it nearly became a claim

The first run reported `originsAgreed: false` on every reconciliation. That would have been a
serious finding: two independent RPC origins disagreeing about a receipt.

They did not disagree. Both returned status `0x1` at the same block. `rpcQuorum` compared the raw
JSON bodies, and OP-stack nodes differ on optional L1-fee fields, key order and hex casing.
Agreement is now judged on a projection, `receiptFingerprint`, covering the fields that decide
something: hash, status, block number, gas used, and the logs. After the fix, every scenario
reports `originsAgreed: true`.

A check that cries wolf on every single run is worse than no check, because a reader learns to
ignore it. It is written up here rather than quietly fixed because a phase log that only records
the platform's mistakes and not the author's is not an honest instrument.

---

## 5. Evidence

Sixteen JSON files plus an index in `docs/phase-logs/evidence/phase-00-5/`, 30 recorded HTTP
exchanges and 5 Base Sepolia transactions between them, each carrying the
semantic attempt id, the request body and its hash, the idempotency key, every HTTP status,
sanitized response bodies and headers, the execution id, every status transition with timing,
the transaction hash, the receipt from both pinned origins with their agreement, the decoded
event topics, and the count of onchain effects attributable to that scenario.

Transactions, confirmed independently with `cast receipt` against `https://sepolia.base.org`
after the run:

From the committed run:

| Scenario | Execution | Transaction | Block |
|---|---|---|---|
| P05 confirmed broadcast | `eu71kzol9c0f33xk5xpo6` | `0xb7159cbb942caadc2e19d973938bcb2e32757375a2a4b9c7841f50f5a780ba17` | 45391613 |
| P11 recovered **from chain alone**, after the key replay answered 409 `idempotency_in_progress` and named nothing | — | `0x157d1e41f31231420e2ba933654666e1cd8e2ff2291970ea3b7d2d3095f30326` | 45391629 |
| P13 recovered by key replay | `z1e425xr2ge2frqosir28` | `0x8ebf5e2bfa876464d72ed122d08516a6ef2a31499254ee89d231f35fd9ceb8dc` | 45391609 |

From the `2026-08-12T15-35` run, kept because it is the one that exercised the conflict channel:

| Scenario | Execution | Transaction | Block |
|---|---|---|---|
| P15 recovered via `originalExecutionId` | `0uudacxzflm0nf2k9p92t` | `0x2b21456cff034934a657be61a99ff43f1973828db056e872f8527f9e8c7b8eff` | 45390344 |

Every one: status `1`, `from` the relayer `0xDcF4bac4bD805948168Ff63483BC493894A29613`, `to` the
router `0x5aF5194B4b0909eB978e3Cf1e25333852277f07D`, and the organization wallet in the decoded
event. Confirmed with `cast receipt` against `https://sepolia.base.org` after the run, separately
from the probe's own reconciliation.

P11 in the committed run is the strongest single piece of evidence in this phase: the client had
no response, the list endpoints do not exist, the key replay reported only that something was
running, and the chain still answered.

No credential appears in any of it. The sanitizer removes credential shapes, the exact loaded
credential, authorization-bearing headers, and email addresses, and keeps hashes, addresses,
topics and calldata. `writeEvidence` re-scans its own serialized output and refuses to write a
file that still matches a credential shape.

---

## 6. Reproducing this

```bash
pnpm --filter @resurv/seam-probe test:seam     # live, spends the credential, lands transactions
pnpm --filter @resurv/seam-probe test          # offline, in the gate, asserts this report
```

The live suite is classified as an external effect in `@resurv/repo-policy` and is reachable
from no auto-approved Claude Code command. Re-running it rewrites the evidence with a new run
label and lands a handful of new canary pings; the findings reproduced identically across the
two runs performed, except where section 4 records a fix between them.

---

## 7. What this refutes in our own record

| Claim | Was | Now |
|---|---|---|
| A 401 envelope is `{error}` alone with no `request_id` | `ASSUMED`, contradicted by the docs | **VERIFIED.** The docs are wrong |
| A reverted broadcast is distinguishable from a transport failure | `ASSUMED` | **Still unresolved, for a new reason.** A reverting call never becomes a broadcast here |
| `msg.sender` equals the org wallet under sponsorship | `MEASURED_EXTERNAL` | **VERIFIED** here |
| `/contract-call` 202 carries no `transactionHash` | `MEASURED_EXTERNAL` | **VERIFIED** here |
| `gasUsedWei` carries gas units, not wei | `MEASURED_EXTERNAL` | **VERIFIED** here |
| There is no list-executions endpoint | `DOCUMENTED`, never probed | **VERIFIED** against a live 404 |
| The rate limit is 60 per minute per key | `DOCUMENTED (conflicting)`, 60 against 100 | **VERIFIED.** `x-ratelimit-limit: 60` |
| Base Sepolia has no private mempool | `MEASURED_EXTERNAL` | **VERIFIED** here |
| A crash between send and response cannot double-submit | `ASSUMED` | **VERIFIED** for one idempotency key, across three lost-response scenarios |

---

## 8. The canonical attempt lifecycle Phase 1 must implement

Derived from the measurements, not from the model this phase started with. Three of that
model's entry conditions were falsified and the differences are named at the end.

### States

| State | Entry condition | Authoritative evidence | May RESURV start another semantic action | Terminal |
|---|---|---|---|---|
| `PLANNED` | a semantic attempt id, a canonical body and its hash exist; nothing sent | RESURV store | yes | no |
| `REJECTED_LOCALLY` | refused before a socket opened | RESURV, offline | yes | yes |
| `SIMULATION_REJECTED` | HTTP 400 with `wouldRevert: true` | KeeperHub body | yes, nothing was broadcast | yes |
| `SIMULATED_OK` | HTTP 200 with `wouldRevert: false` | KeeperHub body | yes, nothing was broadcast | no |
| `KEY_COMMITTED` | idempotency key and body hash **durably written**, request not yet sent | RESURV store | **no** | no |
| `EXECUTED_NO_EFFECT` | a response whose body `status` is `failed` **and** `transactionHash` is null **and** `receipts` is empty | KeeperHub body, confirmed by a chain read finding no effect | yes | yes |
| `RECONCILIATION_REQUIRED` | anything else: no response, a 409, a timeout, an unrecognized status, or a `completed` not yet confirmed on chain | **nothing yet, and that is the definition** | **no** | no |
| `CONFIRMED` | a chain receipt with status `0x1` **and** the expected event present in its logs **and** `executedCall.reverted !== true` **and** `receiptStatus` not an inner-failure value | chain, across two origins | yes | yes |
| `REVERTED` | a chain receipt with status `0x0`, or any inner-failure signal on a receipt that otherwise succeeded | chain, across two origins | yes, the attempt had no effect | yes |
| `PROVEN_NOT_BROADCAST` | the key replay reports no prior commit **and** no effect exists on chain after the settlement window | chain, plus the absence of `idempotentReplay` | yes | yes |

### Transitions

```
PLANNED ──► REJECTED_LOCALLY
PLANNED ──► SIMULATED_OK ──► KEY_COMMITTED
PLANNED ──► SIMULATION_REJECTED

KEY_COMMITTED ──► EXECUTED_NO_EFFECT           status:failed + null hash + no receipts + chain agrees
KEY_COMMITTED ──► RECONCILIATION_REQUIRED      every other outcome, including HTTP 202

RECONCILIATION_REQUIRED ──► CONFIRMED
RECONCILIATION_REQUIRED ──► REVERTED
RECONCILIATION_REQUIRED ──► PROVEN_NOT_BROADCAST
RECONCILIATION_REQUIRED ──► RECONCILIATION_REQUIRED   (bounded retry; never leaves on a timer)
```

There is no `ACCEPTED` state and no `PENDING` state. Both were in the model this phase started
with and neither survives F1: a 2xx with an `executionId` is not acceptance, and the call is
synchronous so there is no pending phase to poll through.

### The reconciliation algorithm, derived from F6 and F8

From `RECONCILIATION_REQUIRED`, in this order. Every step is a measured behavior, not a guess.

1. **Replay the idempotency key with a byte-identical body.**
   - 409 `idempotency_conflict` (`retryable: false`) — the stored body is not what was sent.
     A programming error. Read `originalExecutionId`, go to step 3, and never rotate the key.
   - 409 `idempotency_in_progress` (`retryable: true`) — still running. Wait and repeat this
     step with the same key. Never rotate it.
   - 202 with `idempotentReplay: true` — an earlier request committed. Take its `executionId`,
     go to step 3.
   - 202 without `idempotentReplay` — this replay is the first commit. Take its `executionId`,
     go to step 3.
2. **If no execution id can be obtained**, search the chain for the attempt's onchain marker.
   Found means the effect happened; go to step 4 with that hash. Not found, after the settlement
   window, means `PROVEN_NOT_BROADCAST`.
3. **Read `GET /api/execute/{id}/status`** for the transaction hash. A body with `status: failed`,
   a null hash and empty receipts still needs step 2 before it is believed.
4. **Fetch the receipt from two independent origins** and classify by the `CONFIRMED` and
   `REVERTED` entry conditions above. Disagreement between origins is itself
   `RECONCILIATION_REQUIRED`, not a tie to break.

The loop is bounded by attempt count and wall clock. When it exhausts, the attempt stays in
`RECONCILIATION_REQUIRED` and the covenant does not advance. There is no timeout that promotes
an ambiguous attempt to a terminal state, because a timeout is not evidence.

### Two things the contract must carry, not the orchestrator

- **Semantic idempotency is onchain.** F5 measured a second economic effect from a new key for
  the same action. The covenant must reject a replayed semantic attempt id permanently,
  independently of anything KeeperHub does and long past the 24-hour window.
- **Access control keys on the organization wallet.** F9 measured `msg.sender` as the org wallet
  while the receipt's `from` was a relayer. A contract that authorizes on anything visible in the
  receipt authorizes the wrong address.

---

## 9. The advancement rule

> RESURV may begin another semantic recovery action only when the previous attempt is in
> `REJECTED_LOCALLY`, `SIMULATION_REJECTED`, `EXECUTED_NO_EFFECT`, `CONFIRMED`, `REVERTED` or
> `PROVEN_NOT_BROADCAST`, and every one of those was entered on chain evidence or on the
> absence of an effect proven on chain.
>
> From `KEY_COMMITTED` or `RECONCILIATION_REQUIRED`, RESURV may only repeat the same
> idempotency key with the same body. It may not rotate the key, may not try a different
> action, and may not advance on elapsed time.

The single sentence behind it: **an HTTP status never advances a covenant; a chain read does.**

---

## 10. Repository changes

| Change | Why |
|---|---|
| `packages/seam-probe` gains `test/live/recovery.test.ts` | P13, P14 and P15, all three demanded by the first run's results rather than planned |
| `src/rpc.ts` judges quorum on a projection | Section 4 |
| `probe.test.ts` P11 reconciles from a chain-discovered hash | A reconciler that can only start from a KeeperHub-supplied hash is useless in the case it exists for |
| `src/sanitize.ts` removes email addresses | `GET /api/keys` and `GET /api/user` return the operator's, and this evidence is committed |
| `@resurv/keeperhub-client` `errors.ts` parses `retryable`, `originalExecutionId`, `hint`, `docs` and exports `readIdempotentReplay` | F10 and F6, from observed bodies only |
| `test/offline/measured-semantics.test.ts` | 42 assertions reading the committed evidence, so this report cannot drift from it silently |

Test counts, re-derived:

| Suite | Before | After |
|---|---|---|
| `@resurv/domain` | 34 | 34 |
| `@resurv/keeperhub-client` | 30 | 36 |
| `@resurv/config` | 38 | 38 |
| `@resurv/db` | 7 | 7 |
| `@resurv/chain` | 7 | 7 |
| `@resurv/worker` | 7 | 7 |
| `@resurv/repo-policy` | 391 | 391 |
| `@resurv/seam-probe` | 29 | 71 |
| **TypeScript substantive** | **543** | **591** |
| Foundry | 26 | 26 |

```
TURBO_FORCE=true pnpm gate       exit 0
  typecheck   Tasks: 11 successful, 11 total   Cached: 0 cached, 11 total
  test        Tasks: 11 successful, 11 total   Cached: 0 cached, 11 total
  contracts test            26 passed
  contracts test:invariant   5 passed
```

---

## 11. Why `SEAM REVISE` rather than `SEAM PASS`

KeeperHub is usable. Nothing measured prevents RESURV's dominant mechanism. Every failure mode
encountered is observable and every ambiguous state is resolvable in bounded time.

The gate turns on the second clause: *the planned attempt and reconciliation architecture must
change before contracts or orchestrator implementation*. It must, in four ways:

1. **`ACCEPTED` is not a state.** Its entry condition, a 2xx carrying an `executionId`, is
   satisfied by an attempt that never reached the chain (F1).
2. **`PENDING` is not a state.** The call is synchronous (F1).
3. **`EXECUTED_NO_EFFECT` is a new terminal state** the previous model had nowhere to put, and
   it is the *common* outcome for a rejected action, not an edge case (F2).
4. **`RECONCILIATION_REQUIRED` is mandatory, not optional**, and its resolution depends on an
   undocumented response field (F8) plus a chain read.

Writing the covenant contract against the old model would have produced an orchestrator that
treats a refused attempt as an executed one. That is the failure this phase existed to prevent,
and it is worth the day it cost.

---

## 12. What Phase 1 inherits

- The lifecycle in section 8 and the rule in section 9.
- A measured gas figure for the sponsored path: about 45,850 units per attempt, roughly 22,000
  of it the router wrapper.
- Access control that must key on `0xfd35ae935de7be93ffd585d6627268d833ed834c`, never on
  anything in the receipt.
- The obligation to handle `REVERTED` despite never having observed it, because the refusal that
  prevented it came with `sponsored: false` and a funded wallet may behave differently.
- `docs/keeperhub/SEAM_CHECKLIST.md` for which of PRD 21.4 remains open: item 8, the contract
  event and fee transfer sharing one transaction, needs the covenant contract and is the first
  thing Phase 1 proves.

Phase 1 was not started. Nothing in this session touched contracts, the orchestrator or the UI.

---

**`SEAM REVISE`**

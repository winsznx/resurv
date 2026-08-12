# KeeperHub source snapshot

The deliverable PRD 28 names as "KeeperHub source snapshot and seam-test checklist". Phase 0
marked it PASS and did not produce it; `docs/CLAIMS.md` has carried that as `REFUTED` since the
Phase 0 independent review. This is the artifact.

Retrieved: **2026-08-12**. Every page below was fetched on that date from
`https://docs.keeperhub.com`.

**Amended the same day, after the live probe ran.** Section 13 lists what the measurement
confirmed, what it contradicted, and the one place where this repository's undocumented
assumption turned out to be right and the vendor's documentation wrong. Read section 13 before
relying on any row above it.

## How to read this

| Level | Meaning |
|---|---|
| `DOCUMENTED` | Stated on an official page named below. Not reproduced by us. |
| `DOCUMENTED (conflicting)` | Two official pages disagree. Both are quoted. |
| `MEASURED LIVE` | Reproduced from this repository, with committed evidence. |
| `INFERRED` | Follows from documented statements but is not itself stated. |
| `ASSUMED` | Encoded somewhere in this repository with no source and no measurement. |
| `REFUTED` | An official page or a measurement contradicts a statement we were carrying. |
| `REQUIRES MEASUREMENT` | Cannot be settled by documentation. The seam probe exists for these. |

**Documentation is not evidence of live behavior.** Every row that decides whether RESURV may
advance to another recovery action is marked `REQUIRES MEASUREMENT` even when a page states it,
because the failure this project is guarding against is the case where the platform and its
documentation disagree.

## Pages retrieved

| # | URL | What it covers |
|---|---|---|
| S1 | `https://docs.keeperhub.com/api` | Base URL, auth, rate limits, response and error shapes |
| S2 | `https://docs.keeperhub.com/api/direct-execution` | `/api/execute/*`, simulation, idempotency, status, receipts |
| S3 | `https://docs.keeperhub.com/api/errors` | Error envelope, error codes, 409 codes, rate-limit headers |
| S4 | `https://docs.keeperhub.com/api/executions` | **Workflow** executions: list, status, wait, logs |
| S5 | `https://docs.keeperhub.com/api/chains` | `GET /api/chains` fields |
| S6 | `https://docs.keeperhub.com/api/authentication` | `kh_` / `wfb_` prefixes, scopes, `GET /api/keys` |
| S7 | `https://docs.keeperhub.com/getting-started/api` | Quickstart, the `wait` endpoint, workflow status values |
| S8 | `https://docs.keeperhub.com/wallet-management/gas` | Gas sponsorship eligibility and `msg.sender` |
| S9 | `https://docs.keeperhub.com/cli/commands/kh_execute_contract-call` | CLI surface for the same endpoint |
| S10 | `https://docs.keeperhub.com/keeper-runs/status-logs` | Run status presentation |
| S11 | `https://docs.keeperhub.com/concepts` | Core concepts |

`https://docs.keeperhub.com/api/direct-execution.md` returned **404**: the site serves no raw
markdown, so every quotation below is from the rendered page.

---

## 1. Request and response schemas

### `POST /api/execute/contract-call` request (S2)

| Field | Required | Notes |
|---|---|---|
| `contractAddress` | yes | |
| `chainId` | yes | numeric |
| `functionName` | yes | |
| `functionArgs` | no | a **JSON-encoded string**, e.g. `"[\"0x742d…\"]"`, not an array |
| `abi` | no | a JSON-encoded string |
| `value` | no | decimal string in native units, e.g. `"0.1"` |
| `gasLimitMultiplier` | no | decimal string, e.g. `"1.2"` |
| `simulate` | no | strict boolean |

Headers: `Authorization: Bearer <kh_…>`, `Content-Type: application/json`, optional
`Idempotency-Key`.

### Responses (S2, quoted JSON)

Write, HTTP 202:

```json
{ "executionId": "direct_123", "status": "completed" }
```

Read function, HTTP 200:

```json
{ "result": "1500000000000000000" }
```

Simulation success, HTTP 200:

```json
{
  "success": true,
  "status": "simulated",
  "from": "0x...orgWallet",
  "to": "0x...target",
  "value": "1000000000000000000",
  "gasEstimate": "65000",
  "simulatedReturnValue": true,
  "wouldRevert": false
}
```

Simulation would-revert, HTTP 400:

```json
{
  "success": false,
  "status": "simulated",
  "from": "0x...orgWallet",
  "to": "0x...target",
  "value": "0",
  "wouldRevert": true,
  "revertReason": "Error(ERC20: transfer amount exceeds balance)",
  "error": "Error(ERC20: transfer amount exceeds balance)"
}
```

`GET /api/execute/{executionId}/status`:

```json
{
  "executionId": "direct_123",
  "status": "completed",
  "type": "transfer",
  "transactionHash": "0x...",
  "transactionLink": "https://etherscan.io/tx/0x...",
  "sponsored": false,
  "receipts": [
    {
      "hash": "0x...",
      "chainId": 11155111,
      "verified": true,
      "receiptStatus": "success",
      "blockNumber": 11413447,
      "gasUsed": "68115",
      "verifiedAt": "2024-01-01T00:00:15Z"
    }
  ],
  "gasUsedWei": "21000000000000",
  "result": {},
  "error": null,
  "createdAt": "2024-01-01T00:00:00Z",
  "completedAt": "2024-01-01T00:00:15Z"
}
```

### The transfer example carries a hash and the contract-call example does not

S2's `POST /api/execute/transfer` 202 example is
`{executionId, status, transactionHash, transactionLink}`. Its `POST /api/execute/contract-call`
write example is `{executionId, status}`. Two examples on one page, for two endpoints described
as sharing a response pattern.

`docs/CLAIMS.md` carries "`/contract-call` 202 carries no `transactionHash`" as
`MEASURED_EXTERNAL` from the sibling flightcheck spike. The documentation is consistent with
that reading and does not state it as a rule. Level: `DOCUMENTED` for the example,
`REQUIRES MEASUREMENT` for the rule.

---

## 2. Error envelopes: three documented shapes, not one

This is the most consequential inconsistency found, because a client that assumes one shape
reads `undefined` on the others.

| Shape | Source | Fields |
|---|---|---|
| A | S3, the reference envelope | `{error, detail, request_id}`, optional `hint`, `docs` |
| B | S2, generic error example | `{error, field, details}` — note `details`, not `detail` |
| C | S2, insufficient-scope example | `{error, message, required_scope, granted_scope}` |

S3, quoted: "The API returns errors in this JSON format: `{"error": "machine_readable_code",
"detail": "Human-readable description", "request_id": "correlation-id"}`. Optional fields
include `hint` and `docs`."

S1, quoted: errors include "machine-readable `error` codes, `detail` descriptions, optional
`hint` guidance, optional `docs` links, and a `request_id` for correlation."

Level: `DOCUMENTED (conflicting)`. `packages/keeperhub-client/src/errors.ts` parses `error`,
`detail`, `code` and `request_id`; it does **not** parse `details`, `message`, `field`, `hint`,
`docs`, `required_scope` or `granted_scope`. That is a gap this snapshot creates a ticket for
and does not close, because closing it without a measured response body would be guessing at
which shape the live endpoint uses.

### Documented error codes (S3)

| Code | Status |
|---|---|
| `unauthorized` | 401 |
| `insufficient_scope` | 403 |
| `invalid_input` | 400 |
| `not_found` | 404 |
| `conflict` | 409 |
| `rate_limited` | 429 |
| `internal_error` | 500 |
| `idempotency_conflict` | 409, `retryable: false` |
| `idempotency_in_progress` | 409, `retryable: true` |

Plus, from S2: HTTP 403 with the message `Daily spending cap exceeded` when an organization's
configured daily cap in wei is exceeded.

### What this refutes in our own ledger

`docs/CLAIMS.md` carries "A 401 envelope is `{error}` alone, with no detail and no
`request_id`" as `ASSUMED`. S1 and S3 both say every error carries `request_id`. The claim is
now `ASSUMED` **and contradicted by official documentation**. Which one is true on the wire is
`REQUIRES MEASUREMENT`.

---

## 3. Status semantics

### Direct execution (S2)

`pending` (queued), `running` (executing), `completed` (success), `failed` (failure).

Quoted: "A value of `0` means the execution has reached a terminal state (`completed` or
`failed`) and you can stop polling."

Level: `DOCUMENTED`.

### Workflow execution (S4, S7) — a different vocabulary for a different resource

S4: `pending`, `running`, `success`, `error`, `cancelled`; terminal are `success`, `error`,
`cancelled`. S7's quickstart `wait` example lists `success`, `error`, `system_error`,
`cancelled`.

Level: `DOCUMENTED (conflicting)` between S4 and S7, and **not applicable to direct execution**.
Recorded because conflating the two vocabularies is the obvious way to misread a status, and
because the workflow surface is the one that has list endpoints.

### `unconfirmed`

`docs/CLAIMS.md` carries "`unconfirmed` is a real, non-terminal status absent from the endpoint
reference" at `DOCUMENTED (conflicting)`, sourced to "the first-verified-transaction guide".

**That source could not be located on 2026-08-12.** The word does not appear on S2, S4, S7 or
S10. `packages/keeperhub-client/src/status.ts` treats `unconfirmed` as a known non-terminal
status on the strength of it.

Level: **`ASSUMED`, downgraded from `DOCUMENTED (conflicting)`.** The handling is still correct
and stays: `status.ts` maps every unrecognized value to `UNKNOWN` and non-terminal, so
`unconfirmed` needs no special case to be handled safely, and the special case costs nothing.
What changes is the claim, not the code.

### Receipt status (S2)

`receiptStatus` ∈ `success`, `reverted`, `safe_inner_failure`, `not_found`, `timeout`.

Quoted: "Each execution includes a `receipts` array with independently re-fetched on-chain
verification", carrying `verified`, `receiptStatus`, `blockNumber`, `gasUsed`.

And, load-bearing for everything below: **"Execution settles as `completed` only when all
receipts verify successfully."**

Level: `DOCUMENTED`. This refutes our own ledger row saying `safe_inner_failure` "appears
nowhere outside our own source" — it is on the current Direct Execution page.

### `safe_inner_failure` and what it implies for atomicity

S8, quoted: "Workflows that route through a Safe (Sender ON) are not gas sponsored", because
the sponsorship mechanism "uses direct wallet calls; applying it to Safe writes would alter
`msg.sender` away from the Safe itself."

`INFERRED`, and it is the most important inference in this document: when execution routes
through a Safe, the outer transaction can succeed while the inner call fails, which is what a
distinct `safe_inner_failure` receipt status is for. A RESURV attempt executed that way would
produce an onchain transaction with receipt status `0x1` while `executeAttempt` reverted. The
whole product rests on a false outcome reverting the attempt, and a caller reading only the
transaction receipt would read that as success.

Two consequences, both `REQUIRES MEASUREMENT`:

1. RESURV must execute on the direct-wallet-sender path, not through a Safe. That is also what
   gas sponsorship requires, so the two constraints point the same way.
2. The seam probe must record `sponsored` and the sender on every attempt, and the
   reconciliation must treat `safe_inner_failure` as a failed attempt regardless of the outer
   receipt status.

---

## 4. Simulation semantics

| Behavior | Level | Source |
|---|---|---|
| `simulate: true` returns HTTP 400 with `wouldRevert: true` when the call would fail | `DOCUMENTED` | S2 |
| "No funds reserved, no transactions signed or broadcast" | `DOCUMENTED` | S2 |
| Simulation needs only `mcp:read`; broadcast needs `mcp:write` | `DOCUMENTED` | S2 |
| Simulation `from` is the organization EOA | `DOCUMENTED` | S2, and PRD 2.1 |
| Simulation creates no execution audit row and no `executionId` | `DOCUMENTED` | PRD 2.1 restating an official source; not restated on S2 as retrieved |
| A successful simulation carries `gasEstimate` and `simulatedReturnValue` | `DOCUMENTED` | S2 |
| An underfunded sender yields `code: insufficient_balance` with `balanceWei`, `requiredWei`, `shortfallWei`, `nativeSymbol`, `originalError` | `DOCUMENTED` | S2 |
| **Whether a `simulate: false` broadcast is pre-simulated and refused when it would revert** | **`REQUIRES MEASUREMENT`** | S2 is silent. Explicitly confirmed silent on retrieval |

The last row is the one that decides Phase 0.5. If KeeperHub refuses to broadcast anything its
own pre-simulation predicts will revert, then "KeeperHub accepted execution, the transaction
reverted onchain" may be unreachable through the ordinary path, and the reconciliation model
changes. `packages/seam-probe` scenario `P09` asks exactly this, and `P10` asks it again through
a gas-starved call whose estimation succeeds.

---

## 5. Idempotency semantics

Quoted, S2: "Send `Idempotency-Key` header for safe retries. The same key replays the original
response for 24 hours. Replayed responses include `"idempotentReplay": true`." And: "Derive
stable keys from work identifier + effect fields using SHA-256 hash of canonical form."

| Behavior | Level |
|---|---|
| Replay window is 24 hours | `DOCUMENTED` |
| A replayed response carries `idempotentReplay: true` | `DOCUMENTED` (new to this repository) |
| Same key + different body → 409 `idempotency_conflict`, `retryable: false` | `DOCUMENTED` |
| Same key while the first is running → 409 `idempotency_in_progress`, `retryable: true` | `DOCUMENTED` |
| Recommended key recipe is SHA-256 over a canonical form of work identifier + effect fields | `DOCUMENTED` |
| Idempotency scope (per organization? per endpoint? per key?) | **`ASSUMED`** — not stated on any page retrieved |
| Whether a replay after a lost response returns the original `executionId` | **`REQUIRES MEASUREMENT`** |
| Whether the 24-hour window is measured from first request or last replay | **`ASSUMED`** |

### What KeeperHub idempotency is not

Nothing on any page retrieved says exactly-once execution. What is documented is **response
replay for 24 hours keyed by a header**. That is transport idempotency. It does not:

- survive the 24-hour window;
- prevent a second economic action submitted under a different key;
- prevent a second economic action submitted after the window with the same key;
- say anything about what happened onchain when the response was never received.

`docs/CLAIMS.md` already forbids "permanent exactly-once from KeeperHub idempotency alone". This
snapshot is the source that backs that prohibition rather than merely asserting it.

---

## 6. Authentication and scopes (S6)

| Behavior | Level |
|---|---|
| `Authorization: Bearer <key>` | `DOCUMENTED` |
| `kh_` is an organization key; `wfb_` is a user key restricted to `POST /api/workflows/{id}/webhook` | `DOCUMENTED` |
| Keys are SHA-256 hashed at rest and only the prefix is retained | `DOCUMENTED` |
| `GET /api/keys` returns 200 for a valid key and 401 for an invalid one | `DOCUMENTED` |
| Direct execution requires `mcp:write`; simulation accepts `mcp:read` | `DOCUMENTED` |
| Session-only endpoints reject API keys with 401 | `DOCUMENTED` |

---

## 7. Rate limits: two official numbers

| Source | Statement |
|---|---|
| S2 | "Rate limit: 60 requests per minute per API key" for Direct Execution |
| S1 | "100 requests per minute for authenticated users", "10 requests per minute for unauthenticated requests" |

Level: `DOCUMENTED (conflicting)`. The reconciling reading is that 60/min is a Direct Execution
endpoint limit inside a 100/min account limit, which is plausible and is not stated anywhere.
`packages/keeperhub-client/src/constants.ts` encodes 60 and should stay at 60, because the lower
of two documented numbers is the safe one. Its ledger row moves from `ASSUMED` to
`DOCUMENTED (conflicting)`.

Headers, S3: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` on every
response; `Retry-After` on 429 only. Recommended backoff `min(1s × 2^attempt, 30s)`, maximum 5
attempts. Level: `DOCUMENTED`. Note "Anti-abuse endpoints omit `X-RateLimit-Remaining`", so a
client must not require the header to be present.

`X-Poll-Interval-Hint`: seconds, `0` means terminal. Level: `DOCUMENTED`, quoted in section 3,
upgraded from `ASSUMED` in our ledger. `packages/keeperhub-client/src/status.ts` already
implements exactly this.

---

## 8. Chains (S5)

`GET /api/chains` returns a **bare array**, not an envelope (S1 names it as the example of that
pattern). Fields: `id`, `chainId`, `name`, `symbol`, `chainType`, `explorerUrl`,
`explorerAddressPath`, `explorerApiUrl`, `explorerApiType`, `isTestnet`, `isEnabled`,
`usePrivateMempoolRpc`. Query parameter `includeDisabled`, default false.

S5 on `usePrivateMempoolRpc`, quoted: it "describes a chain capability, not the route used by a
specific transaction."

Level: `DOCUMENTED`, and it strengthens the existing `REFUTED (as a benefit)` row: even where
the flag is true, it does not establish that a given transaction was privately routed. RESURV
may not claim private routing on any chain on the strength of this field alone.

---

## 9. Executions: which surface has a list endpoint

| Surface | List endpoint | Level |
|---|---|---|
| Workflow executions | `GET /api/workflows/{workflowId}/executions` exists (S4) | `DOCUMENTED` |
| Direct executions | none documented; only `GET /api/execute/{executionId}/status` (S2) | `DOCUMENTED` absence |

ADR-004's load-bearing premise is "there is no list-executions endpoint". That is correct **for
direct execution** and wrong as a general statement about the API, and the ADR should say which
one it means. An absence in documentation is also not a 404: the probe's `P11` requests
`GET /api/execute` and `GET /api/executions` for exactly that reason. Level:
`REQUIRES MEASUREMENT`.

S4 also documents `GET /api/workflows/executions/{executionId}/wait?timeoutMs=` with a default
of 25 seconds and a maximum of 60. There is no documented `wait` for direct execution, so a
direct-execution client polls.

---

## 10. Gas sponsorship (S8)

| Statement | Level |
|---|---|
| "Sponsorship pays the transaction fee only" | `DOCUMENTED` |
| Eligible networks include Base and its testnets | `DOCUMENTED` |
| Requires the wallet itself as active sender, **not** a Safe | `DOCUMENTED` |
| "Transactions routed through private mempools aren't sponsored" | `DOCUMENTED` |
| Requires remaining monthly gas credits; mainnet counts, "testnet usage is free" | `DOCUMENTED` |
| Sponsorship pauses and the wallet pays when credits run out | `DOCUMENTED` |
| Under sponsorship `msg.sender` at the target is the org wallet | `INFERRED` from the Safe note, `MEASURED_EXTERNAL` in our ledger, `REQUIRES MEASUREMENT` against a RESURV contract |

The credits statement matters for the demo: Base Sepolia sponsorship does not consume the
monthly allowance, so the seam probe and the demo cannot exhaust it. The mainnet path can, and
v1 does not reach mainnet.

---

## 11. What the current documentation does not say at all

Recorded so that no future session mistakes silence for confirmation.

1. Whether a `simulate: false` request is pre-simulated and refused when it would revert.
2. What `status` settles to when a broadcast transaction reverts onchain, and whether an
   `executionId` and `transactionHash` are still returned.
3. Whether the revert reason survives onto the status response for a broadcast revert.
4. Whether a replay after a lost response returns the original execution or starts a new one.
5. The scope of an idempotency key: organization, key, endpoint, or some combination.
6. What a 401 body actually contains, given three documented envelope shapes.
7. Whether `unconfirmed` exists. It is in our code and in no page retrieved.
8. Whether `gasLimitMultiplier` applies to KeeperHub's own estimate, and whether a value below
   1.0 is honored or clamped.
9. What happens to an execution whose receipts never verify: whether it settles `failed`, stays
   `running`, or reports `timeout` and later changes.
10. Any statement about ordering or atomicity across two direct executions.

Items 1, 2, 3, 4, 6, 8 and 9 are the seam probe. Items 5, 7 and 10 need KeeperHub support or a
longer experiment than Phase 0.5 justifies.

---

## 12. Corrections this snapshot makes to `docs/CLAIMS.md`

| Row | Was | Now | Why |
|---|---|---|---|
| `X-Poll-Interval-Hint` carries seconds, `0` means terminal | `ASSUMED` | `DOCUMENTED` | S2, quoted |
| 409 carries `idempotency_conflict` / `idempotency_in_progress` | `ASSUMED` | `DOCUMENTED` | S3, with `retryable` |
| Receipt status set includes `safe_inner_failure` | `ASSUMED`, "appears nowhere outside our own source" | `DOCUMENTED` | S2 |
| Rate limit is 60/min per key | `ASSUMED` | `DOCUMENTED (conflicting)` | S2 says 60, S1 says 100 |
| `unconfirmed` is a real status | `DOCUMENTED (conflicting)` | `ASSUMED` | The cited guide could not be found on 2026-08-12 |
| A 401 envelope is `{error}` alone | `ASSUMED` | `ASSUMED`, contradicted by S1 and S3 | Both say every error carries `request_id` |
| `request_id` is present on some responses | `ASSUMED` | `DOCUMENTED` | S1, S3 |
| There is no list-executions endpoint | `DOCUMENTED` | `DOCUMENTED` for direct execution only | S4 documents one for workflows |
| The source snapshot deliverable exists | `REFUTED` | `VERIFIED` | This file |

No row about broadcast, revert, transport failure or reconciliation is promoted by this
document, because documentation cannot promote them.

---

## 13. What the live probe found, added after measurement

The seam probe ran on 2026-08-12 against the real API and Base Sepolia. Full record in
`docs/phase-logs/PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md`, evidence in
`docs/phase-logs/evidence/phase-00-5/`.

### Confirmed

| Statement | Where |
|---|---|
| `simulate: true` answers a would-revert call with HTTP 400 and `wouldRevert: true` | S2 |
| Simulation runs as the organization EOA and broadcasts nothing | S2 |
| `X-Poll-Interval-Hint: 0` on a terminal execution | S2 |
| Both 409 codes, with `retryable: false` and `retryable: true` | S3 |
| `idempotentReplay: true` on a replayed response | S2 |
| An execution settles `completed` only when its receipts verify | S2, six of six |
| `usePrivateMempoolRpc: false` on Base Sepolia | S5 |
| Gas sponsorship on Base Sepolia, with a 0-ETH wallet | S8 |
| No list endpoint for direct executions, now a live 404 rather than an absence | S2 vs S4 |

### Contradicted

**The error envelope.** S1 and S3 both state that every error carries `request_id`. It does not.
A 401 on `/api/execute/contract-call` and a 404 for an unknown execution id both return
`{error}` and nothing else. This repository's own `ASSUMED` claim, written from a reading with
no source and rated below documentation, was correct and the documentation is wrong.

A third envelope exists that appears on no page retrieved: both 409s return
`{error: <sentence>, code: <machine value>, retryable, originalExecutionId?}`, in which `error`
and `code` carry the opposite roles from the documented shape.

**The rate limit.** S2 said 60 per key, S1 said 100 per authenticated user. The live header is
`x-ratelimit-limit: 60` on every Direct Execution response. S2 is right for this endpoint.

### Documented nowhere, and load-bearing

| Behavior | Why it matters |
|---|---|
| HTTP 202 is returned with `status: "failed"` for an attempt that never reached the chain | The status code carries no information about broadcast. This falsified the lifecycle RESURV was going to build |
| `POST /api/execute/contract-call` is synchronous and does not return until terminal | There is no pending phase to poll on the happy path |
| A call whose gas estimation reverts is refused before broadcast, and reported as an insufficient-balance error | The message names the wrong cause; a caller who funds the wallet and retries would loop |
| `gasLimitMultiplier` below 1.0 is accepted and ignored | Removes the only route to a deliberate onchain revert |
| A 409 `idempotency_conflict` carries `originalExecutionId` | The only KeeperHub-side handle on an execution whose id was never received |
| The absence of `idempotentReplay` is itself informative | It marks the request that committed the key |
| `result.executedCall.reverted` exists on a status body | The observable surface for the `safe_inner_failure` hazard in section 3 |
| `failureKind: "revert"` on a simulation rejection | Separates a revert from other simulation failures |
| `revertReason` leaks an ethers.js `CALL_EXCEPTION` string containing the whole transaction | It is a diagnostic, never something to parse |
| `retryCount` and `kh-minimum-cli-version` | Minor, recorded for completeness |

### Still unmeasured after the probe

Items 2 and 3 of section 11 remain open, and for a reason section 11 did not anticipate: a
reverting call never becomes a broadcast on this configuration, so there was no reverted
broadcast whose presentation could be observed. Items 5, 7 and 10 are unchanged. Item 9 was
never triggered.

# KeeperHub execution semantics: five things a Direct Execution client has to get right

A teardown, a reproduction, and the fixes. Written for the KeeperHub onboarding bounty from the
friction actually hit while building [RESURV](../../README.md), which executes every one of its
writes — including its own contract deployments — through the Direct Execution API.

Everything below was measured against the live API on 2026-08-12, from an organization key, with
the evidence committed in this repository. Where the documentation and the measurement disagree,
the measurement is quoted and the page is named.

---

## The short version

If you are writing a client right now, these are the five lines that matter:

1. **HTTP 202 does not mean broadcast.** Read `status` in the body, then confirm on chain.
2. **`POST /api/execute/contract-call` is synchronous.** There is no pending phase to poll.
3. **Idempotency bounds effects per *key*, not per action.** A new key for the same action
   executes it again.
4. **Error envelopes come in three shapes and `error` means different things in two of them.**
5. **An outer receipt with status `0x1` is not proof the inner call succeeded.**

And one that is not a gotcha but is worth knowing: **a contract call to a CREATE2 factory is a
contract call**, so you can deploy contracts through the sponsored path with a wallet that holds
no native currency at all.

---

## 1. HTTP 202 is returned by an execution that never reached the chain

**Expected:** a 2xx with an `executionId` means the transaction was accepted for broadcast.

**Actual:** it means the request was processed. Both of these are HTTP 202:

| | successful call | refused call |
|---|---|---|
| HTTP | 202 | 202 |
| body `status` | `completed` | `failed` |
| `transactionHash` | on the status endpoint | `null` |
| `receipts` | one, verified | `[]` |
| onchain effects | 1 | **0** |

**Why it bites:** the obvious client shape is `if (response.ok) markAccepted()`. That classifies a
refusal as an in-flight execution, and every retry policy built on top of it is then reasoning
about a transaction that does not exist.

**The fix:** branch on the body, never on the status class, and treat "no effect" as a claim that
still needs a chain read.

```ts
const noEffect =
  body.status === 'failed' &&
  (body.transactionHash === null || body.transactionHash === undefined) &&
  (body.receipts?.length ?? 0) === 0;
// Even this is a *candidate*. Confirm by searching chain for the effect before believing it.
```

Reference implementation: [`classifyBroadcastResponse`](../../packages/domain/src/attempt-state.ts).

---

## 2. The POST is synchronous, so there is no `pending` to poll

**Expected:** submit, receive an id, poll `pending` → `running` → `completed`.

**Actual:** the POST blocks until the execution is terminal — 4 to 8 seconds across our runs — and
the first status poll already returns terminal with `X-Poll-Interval-Hint: 0`. We never observed
`pending` or `running` on a direct execution. The only in-flight signal we saw was a 409
`idempotency_in_progress` on a replay.

**Why it bites:** you build a polling loop, it never executes a second iteration, and you never
find out that the timeout you chose for the POST is the only timeout that matters. Ours is 120
seconds.

**The fix:** treat the POST as the operation, keep the status endpoint for reconciliation, and set
a POST timeout that is longer than you think you need.

---

## 3. Transport idempotency is not semantic idempotency

**Documented, and true:** the same key replays the original response for 24 hours, and a replay
carries `idempotentReplay: true`.

**Not documented, and the one that costs money:**

| Scenario | Key | Result | Onchain effects |
|---|---|---|---|
| first send | fresh | 202, execution created | 1 |
| same key, same body | same | 202, `idempotentReplay: true`, same `executionId` | still 1 |
| same key, different body | same | 409 `idempotency_conflict`, `retryable: false` | 0 from the new body |
| **new key, same economic action** | **new** | **202, new `executionId`** | **2** |

**Why it bites:** the natural reaction to an ambiguous failure is "retry with a fresh key". That is
the one action that buys a second economic effect.

**The fix, and it is two separate mechanisms:**

- *Transport:* one key per semantic action, derived deterministically, persisted **before** the
  first POST. Recovery replays that key with a byte-identical body. Never rotate it.
- *Semantic:* something outside KeeperHub has to reject the repeated action permanently, past the
  24-hour window. For RESURV that is an onchain attempt id, burned in the same transaction as the
  effect.

```ts
// Derived once, stored once, replayed verbatim.
const semanticAttemptId = keccak256(`${label}|${generation}|${bodyHash}`);
const idempotencyKey = sha256(`resurv/v1|${semanticAttemptId}|${chainId}|${to}|${fn}|${args}`);
```

There is one more scoping detail: the recommended recipe is "work identifier + effect fields", and
if two projects share an organization they share a key space. Namespace your keys.

---

## 4. Three error envelope shapes, and `error` swaps meaning between two of them

**Documented:** `{error: "machine_code", detail: "sentence", request_id: "..."}`, with every error
carrying `request_id`.

**Actual, all three observed live:**

| Shape | Where | Body |
|---|---|---|
| A | 401; 404 for an unknown execution id | `{error}` **only**. No `detail`, no `request_id` |
| B | 404 for an unrouted path | `{error: code, detail: sentence, request_id}` |
| C | both 409s | `{error: sentence, code, retryable, originalExecutionId?}` |

In B, `error` is the machine code. In C, `error` is the human sentence and `code` is the machine
value. A client that reads `body.error` as a code is right on one and wrong on the other.

Two of those fields are load-bearing and neither is documented: `retryable` separates a 409 you
should repeat from one you must never repeat, and **`originalExecutionId` names the execution the
key already created**, which is the only KeeperHub-side handle on a response you never received.

**The fix:**

```ts
const code    = body.code   ?? body.error ?? `http_${status}`;  // machine value, all three shapes
const message = body.detail ?? body.error ?? `http_${status}`;  // human value, all three shapes
const retryable = body.retryable;              // undefined is NOT false
const original  = body.originalExecutionId;    // your lost execution, sometimes
```

Reference implementation: [`normalizeErrorBody`](../../packages/keeperhub-client/src/errors.ts).

**Suggested documentation change:** `https://docs.keeperhub.com/api/errors` states that every error
carries `request_id`. A 401 on `/api/execute/contract-call` returns `{"error":"Unauthorized"}` and
nothing else. Either the page or the API is wrong, and a client written from the page will read
`undefined`.

---

## 5. `receiptStatus: safe_inner_failure` means an outer success can contain an inner failure

**Documented:** `receiptStatus` ∈ `success`, `reverted`, `safe_inner_failure`, `not_found`,
`timeout`. And separately: sponsorship "uses direct wallet calls; applying it to Safe writes would
alter `msg.sender` away from the Safe itself".

**What follows:** when execution routes through a Safe, the outer transaction can succeed while the
inner call fails. The transaction receipt says `0x1`. Anything verifying by reading the receipt
reads that as success.

We never observed it — six successful executions and three refusals, all with
`result.executedCall.reverted: false`. So this is a documented hazard rather than a measured one,
and it is in this list because the *surface to watch* is not obvious:

```ts
const innerFailure =
  body.result?.executedCall?.reverted === true ||
  (body.receipts ?? []).some((r) => r.receiptStatus === 'safe_inner_failure');
// Never `receipt.status === '0x1'` on its own.
```

**The fix, more generally:** confirm on the *event you expected*, not on the receipt status. RESURV
requires a receipt with status `0x1`, the expected event present in its logs, no inner-failure
signal, and agreement from two independent RPC origins. Any one of those alone is weaker than it
looks.

---

## Bonus: two things that will surprise you, one of them useful

### A call whose gas estimation reverts is refused with a balance error

Submit a `simulate: false` call that would revert, and you get HTTP 202, `status: "failed"`,
`sponsored: false`, and:

```
Insufficient BASE balance. Have: 0.0, Need: 0.000000231.
Fund 0xfd35…834c with at least 0.000000231 BASE on this chain and retry.
```

The call was refused because it would revert. Estimation failed, so sponsorship was declined, so
the empty wallet became relevant. The controlled comparison is in the same run with one variable
changed: the same wallet, at the same zero balance, executes a *valid* call with `sponsored: true`.

An operator or an agent that follows that instruction funds the wallet, retries, and either loops
or — worse — succeeds in broadcasting a transaction that reverts and costs real gas.

**Suggested improvement:** when gas estimation reverts, say so. The balance is a consequence, not
the cause.

### You can deploy contracts through the sponsored path

There is no deployment endpoint, and the organization wallet holds no native currency. But
[CreateX](https://github.com/pcaversaccio/createx) is deployed at
`0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed` on Base Sepolia and its `deployCreate2(bytes32,bytes)`
is an ordinary ABI function — so a deployment is just a contract call, and it is sponsored like any
other.

RESURV deployed six contracts and ran three configuration calls this way, with a zero-balance
wallet and no faucet. Two details:

- `msg.sender` inside your constructor is the **factory**, not your wallet. Take every role as an
  explicit constructor argument. A contract that grants admin to `msg.sender` here hands a public
  factory the keys.
- The 202 carries no return data and no transaction hash, so read the deployed address from the
  `ContractCreation` event in the receipt. Predict it offchain too, and compare: two independent
  facts beat one.

Working code: [`packages/cli/src/createx.ts`](../../packages/cli/src/createx.ts) and
[`packages/cli/src/bin/contracts.ts`](../../packages/cli/src/bin/contracts.ts).

---

## Reproducing all of it

The measurements come from a probe that runs sixteen scenarios against the live API and writes one
JSON file per scenario, credentials removed and chain data intact.

```bash
git clone --recurse-submodules <url> resurv && cd resurv
pnpm install
cp .env.example .env        # then paste an organization key beginning kh_

pnpm --filter @resurv/seam-probe test        # offline: asserts the findings against committed evidence
pnpm --filter @resurv/seam-probe test:seam   # live: spends the credential, lands testnet transactions
```

The offline half runs in CI and needs no credential: 71 tests, 42 of which read the committed
evidence and assert the findings above, so a claim cannot drift away from its artifact.

| Where | What |
|---|---|
| [`docs/phase-logs/PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md`](../phase-logs/PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md) | The full report, eleven measured facts, with the scenario that produced each |
| [`docs/phase-logs/evidence/phase-00-5/`](../phase-logs/evidence/phase-00-5/) | 16 scenarios, 30 HTTP exchanges, 5 transactions |
| [`docs/keeperhub/SOURCE_SNAPSHOT.md`](../keeperhub/SOURCE_SNAPSHOT.md) | 11 official pages as retrieved, with what each does and does not say |
| [`packages/keeperhub-client`](../../packages/keeperhub-client) | The client, MIT, copy what you need |
| [`packages/orchestrator/src/execute.ts`](../../packages/orchestrator/src/execute.ts) | The reconciliation loop these findings produced |

## What we would send upstream

In priority order, and all of them are documentation rather than code:

1. **Say that 202 is not acceptance** on the Direct Execution page, next to the response example.
   It is the single most expensive misreading available.
2. **Document the three error envelope shapes**, or unify them. Today a client written from the
   errors page reads `undefined` on a 401.
3. **Document `retryable` and `originalExecutionId`.** Both are load-bearing for recovery and
   neither appears on any page we retrieved.
4. **Say that the POST is synchronous.** The status endpoint reads like the primary path and is
   not.
5. **Fix the insufficient-balance message** when the real cause is a reverting estimation.
6. **Say what idempotency does not do.** The current wording is accurate and readers extrapolate
   "exactly once" from it. One sentence — "effects are bounded per key, not per action" — closes
   it.

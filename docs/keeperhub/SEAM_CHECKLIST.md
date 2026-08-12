# KeeperHub seam-test checklist

The second half of the PRD 28 Phase 0 deliverable. `docs/keeperhub/SOURCE_SNAPSHOT.md` records
what the documentation says; this file records what has to be measured, what measures it, and
what state each item is in.

Last updated: 2026-08-12, at the end of Phase 0.5. Verdict `SEAM REVISE`; the measurements are
in `docs/phase-logs/PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md`.

Status vocabulary: `BUILT` means the probe scenario exists, typechecks and runs; `MEASURED`
means it has been run against the live API with committed evidence; `UNREACHABLE` means the
experiment ran and the state could not be produced, which is a result rather than a gap.

## Run it

```bash
pnpm --filter @resurv/seam-probe test:seam
```

Deliberately not auto-approved for Claude Code and deliberately absent from `pnpm gate`. It
spends a real organization credential and lands real Base Sepolia transactions, so it is an
explicit act. `pnpm --filter @resurv/seam-probe test` runs the offline half, which is in the
gate.

Evidence lands in `docs/phase-logs/evidence/phase-00-5/`, one JSON file per scenario plus an
index, with credentials removed and chain data intact.

## PRD 21.4, the checklist as written

| # | PRD item | Scenario | State |
|---|---|---|---|
| 1 | `GET /api/chains` and save current chain configuration | `P00` | `MEASURED`. 84532 enabled, `usePrivateMempoolRpc: false` |
| 2 | Simulate a known successful test call | `P03` | `MEASURED`. 200, `wouldRevert: false`, `from` the org wallet |
| 3 | Simulate a known role failure | `P04` | `MEASURED` as a selector failure. A *role* failure needs the covenant contract, so that half is Phase 1 |
| 4 | Broadcast an atomic RESURV attempt | `P05` | `MEASURED` against the canary. The atomic RESURV attempt itself is Phase 1 |
| 5 | Repeat exact request with same idempotency key | `P06` | `MEASURED`. Same `executionId`, `idempotentReplay: true`, no second effect |
| 6 | Reuse key with changed body and confirm conflict | `P07` | `MEASURED`. 409 `idempotency_conflict`, `retryable: false`, and it names `originalExecutionId` |
| 7 | Confirm status and explorer link | `P05` | `MEASURED`. Hash and `transactionLink` on the status endpoint, never in the 202 |
| 8 | Confirm contract event and fee transfer share the same transaction | — | **Phase 1.** No covenant contract exists. This is the first thing Phase 1 proves |
| 9 | Confirm gas sponsorship and private routing cannot be claimed together | `P00`, `P05` | `MEASURED`. `sponsored: true` with `usePrivateMempoolRpc: false` on the same chain, which is consistent with the documented rule |
| 10 | Confirm failed marketplace workflow billing before using marketplace claims | — | Out of scope for v1. Marketplace is not on the critical path |

## The twelve states Phase 0.5 has to distinguish

The dominant question: can RESURV distinguish the state of one semantic attempt strongly enough
that it never advances to another recovery action while the previous one could still produce an
onchain effect?

| # | State | Scenario | Result |
|---|---|---|---|
| 1 | local request rejection | `P01` | `MEASURED`. Three key shapes and the separator guard, zero HTTP requests |
| 2 | authentication or configuration failure | `P02` | `MEASURED`. 401 `{error}` alone, wrong key and no key alike |
| 3 | simulation rejection with no broadcast | `P04` | `MEASURED`. 400, `wouldRevert: true`, `failureKind: "revert"`, no `executionId`, zero effects |
| 4 | execution accepted | `P05`, `P09` | `MEASURED`, **and the state does not exist as designed.** HTTP 202 covers both a completed attempt and one that never reached the chain. Read the body's `status` |
| 5 | execution pending | `P05`, `P11` | `MEASURED as absent` on the happy path: the POST is synchronous and the first status poll is already terminal. The only in-flight signal is 409 `idempotency_in_progress` on a replay |
| 6 | execution confirmed successfully | `P05` | `MEASURED`. Chain receipt `0x1` from two agreeing origins, plus the expected event |
| 7 | execution broadcast but reverted onchain | `P09`, `P10`, `P14` | **`UNREACHABLE`.** A reverting call is refused before broadcast, three of three, and `gasLimitMultiplier` below 1.0 is ignored. See below |
| 8 | transport failure after possible acceptance | `P11`, `P13`, `P15` | `MEASURED`, on both sides: the same abort committed in one case and not in another |
| 9 | temporarily unknown execution state | `P12` | `MEASURED`. 404 `{"error":"Execution not found"}`, no `detail`, no `request_id` |
| 10 | repeated transport request, same key | `P06` | `MEASURED`. Same `executionId`, `idempotentReplay: true`, still one effect |
| 11 | repeated semantic action, new key | `P08` | `MEASURED`. **Two effects.** Transport idempotency is not semantic idempotency |
| 12 | chain disagreeing with or clarifying KeeperHub | every scenario | `MEASURED`. Chain clarified in `P09` (nothing broadcast) and answered alone in `P11` |

## The revert path, and why neither route reached it

`P09` submits a call whose selector the target does not implement, with `simulate: false`.
KeeperHub answered HTTP 202 with `status: "failed"`, `transactionHash: null`, `receipts: []`,
`sponsored: false`, and an error naming a balance shortfall. Nothing landed. `P14` repeated it
twice with the same result, so the refusal is deterministic.

`P10` therefore submitted a **valid** call starved of gas, with the limit computed at run time
to fall between the transaction's intrinsic cost and its execution cost. `gasLimitMultiplier`
was accepted and ignored: the transaction landed with a gas limit byte-identical to the call
that sent no multiplier.

So "accepted, then reverted onchain" was not produced. The honest reading is that on this
configuration a reverting call never becomes a broadcast, and the honest residual is that the
refusal arrived with `sponsored: false` and a balance error, so a **funded** organization wallet
might reach the chain and revert. The lifecycle carries `REVERTED` regardless.

## The transport-failure experiment, and what it actually showed

`P11` sends a real, complete request and stops listening 250 ms later. Nothing is mocked: the
request reaches KeeperHub and KeeperHub does whatever it does.

It reproduced the ambiguity on both sides, which is more than was hoped for. In `P11` the
execution was created 264 ms after the request was sent, so the aborted request had committed.
In `P13` the identical abort committed nothing and the later replay created the execution. Same
client-side observation, opposite economic outcome.

What it cannot reproduce: a partition that drops the response *after* KeeperHub commits, at a
moment of KeeperHub's choosing rather than the client's. Inducing that would need infrastructure
manipulation this project will not perform.

The three recovery routes, measured:

1. **List the executions.** `GET /api/execute` and `GET /api/executions` both 404 `not_found`.
   No such endpoint, now confirmed live rather than inferred from silence.
2. **Replay the stored key with a byte-identical body.** Works. 202 with the `executionId`, and
   `idempotentReplay` tells you whether the lost request had committed; or 409
   `idempotency_in_progress` (`retryable: true`) while it is still running, in which case repeat
   the same key and never rotate it.
3. **Ask the chain.** Works, and is the only route that survives an API change. `P11` recovered
   its transaction from `eth_getLogs` alone.

A fourth route turned up that nobody planned: a 409 `idempotency_conflict` carries
`originalExecutionId`, naming the execution the first request created. `P15` used it to recover
a lost attempt, and the conflicting body executed nothing.

Across `P11`, `P13` and `P15`: exactly one onchain effect each. Recovery never doubled anything.

## What the fixture is, and why it needs no deployment

`0x2A6FC8182Bf9928Ef7517dA980dC79e8107c555A` on Base Sepolia. Verified from this repository on
2026-08-12 against `https://sepolia.base.org`:

```
cast code                       139 bytes of runtime
cast selectors <runtime>        exactly one entry: 0x33d425c4  (ping(bytes32))
cast call "ping(bytes32)" …     returns 0x
cast call <absent selector>     execution reverted
cast estimate "ping(bytes32)"   23557
```

The runtime dispatches one selector and falls through to `5f80fd`, a bare `revert(0, 0)`. No
fallback, no receive. So the success case and the no-such-function revert case are both
properties of the bytecode rather than of anyone's protocol state, which is what "deterministic"
has to mean here.

Every call is value 0. The organization wallet holds no ETH under sponsorship, so a
value-carrying call to a non-payable function would revert on balance rather than on
payability and would confound the measurement.

The contract emits one event per successful `ping`, LOG3, topic0
`0x4947ef22330e8e81cdedf82c33d366e9c942511f5edf79140686b33af9de7f33`, with the caller and the
challenge as indexed parameters and the chain id as data. The event's Solidity name is not
published anywhere this repository can reach, so the probe treats topic0 as opaque and decodes
positionally. That is what makes "did a second onchain effect happen" answerable: each scenario
derives its own challenge word from its semantic attempt id, and `eth_getLogs` counts the
transactions carrying it.

## What is still open after Phase 0.5

| Item | Why |
|---|---|
| A broadcast transaction reverting onchain | Unreachable with an unfunded wallet. Fund the org wallet and repeat `P09` to settle it |
| `safe_inner_failure` in practice | Never observed. The surface to watch is `result.executedCall.reverted` and `receipts[].receiptStatus`, not the outer receipt |
| The 24-hour idempotency boundary | Needs a 24-hour experiment. The onchain attempt id covers it regardless |
| Idempotency scope: per key, per organization, per endpoint | Not documented and not derivable from one organization |
| `Retry-After` and the 429 branch | The rate limit was never hit |
| A non-zero `X-Poll-Interval-Hint` | Every execution was already terminal at the first poll |

## Items this checklist deliberately does not cover

- The atomic RESURV attempt, its events and its fee transfer. Phase 1.
- Marketplace billing. Out of scope for v1.
- MCP and the Claude Code plugin. Not on the execution critical path.
- Analytics and the SSE stream. Supplemental observability, PRD 12.12.
- Mainnet anything.

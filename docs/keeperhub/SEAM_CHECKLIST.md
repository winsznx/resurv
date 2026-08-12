# KeeperHub seam-test checklist

The second half of the PRD 28 Phase 0 deliverable. `docs/keeperhub/SOURCE_SNAPSHOT.md` records
what the documentation says; this file records what has to be measured, what measures it, and
what state each item is in.

Last updated: 2026-08-12, during Phase 0.5.

Status vocabulary: `BUILT` means the probe scenario exists, typechecks and runs; `MEASURED`
means it has been run against the live API with committed evidence; `BLOCKED` names what is
missing.

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
| 1 | `GET /api/chains` and save current chain configuration | `P00` | `BUILT`, `BLOCKED` on credential |
| 2 | Simulate a known successful test call | `P03` | `BUILT`, `BLOCKED` on credential |
| 3 | Simulate a known role failure | `P04` | `BUILT` as a selector failure, `BLOCKED`. A *role* failure needs the covenant contract, so this is Phase 1 |
| 4 | Broadcast an atomic RESURV attempt | `P05` | `BUILT` against the canary. The atomic RESURV attempt itself is Phase 1 |
| 5 | Repeat exact request with same idempotency key | `P06` | `BUILT`, `BLOCKED` |
| 6 | Reuse key with changed body and confirm conflict | `P07` | `BUILT`, `BLOCKED` |
| 7 | Confirm status and explorer link | `P05` | `BUILT`, `BLOCKED` |
| 8 | Confirm contract event and fee transfer share the same transaction | — | Phase 1. No covenant contract exists |
| 9 | Confirm gas sponsorship and private routing cannot be claimed together | `P00` | `BUILT`. Already `DOCUMENTED` in the snapshot section 10 |
| 10 | Confirm failed marketplace workflow billing before using marketplace claims | — | Out of scope for v1. Marketplace is not on the critical path |

## The twelve states Phase 0.5 has to distinguish

The dominant question: can RESURV distinguish the state of one semantic attempt strongly enough
that it never advances to another recovery action while the previous one could still produce an
onchain effect?

| # | State | Scenario | Authority | State |
|---|---|---|---|---|
| 1 | local request rejection | `P01` | RESURV, offline | `MEASURED` — no network involved, see below |
| 2 | authentication or configuration failure | `P02` | KeeperHub HTTP | `BUILT`, `BLOCKED` |
| 3 | simulation rejection with no broadcast | `P04` | KeeperHub body, then chain | `BUILT`, `BLOCKED` |
| 4 | execution accepted | `P05` | KeeperHub 202 | `BUILT`, `BLOCKED` |
| 5 | execution pending | `P05` transitions | KeeperHub status | `BUILT`, `BLOCKED` |
| 6 | execution confirmed successfully | `P05` | chain receipt, cross-checked | `BUILT`, `BLOCKED` |
| 7 | execution broadcast but reverted onchain | `P09`, `P10` | chain receipt | `BUILT`, `BLOCKED` |
| 8 | transport failure after possible acceptance | `P11` | nothing; that is the problem | `BUILT`, `BLOCKED` |
| 9 | temporarily unknown execution state | `P12` | KeeperHub 404 vs pending | `BUILT`, `BLOCKED` |
| 10 | repeated transport request, same key | `P06` | KeeperHub `idempotentReplay` + chain effect count | `BUILT`, `BLOCKED` |
| 11 | repeated semantic action, new key | `P08` | chain effect count | `BUILT`, `BLOCKED` |
| 12 | chain disagreeing with or clarifying KeeperHub | every scenario | chain, always | `BUILT`, `BLOCKED` |

State 1 is the only one measurable without a credential, and it is measured: `P01` exercises
`isApiKeyShapeValid` and the idempotency separator guard with zero HTTP requests. The rest are
blocked on the credential.

## Two revert paths, because one may not be reachable

`P09` submits a call whose selector the target does not implement, with `simulate: false`. If
KeeperHub pre-simulates before broadcasting, it will refuse and nothing lands, which is a
finding rather than a failure: it would mean "accepted, then reverted" is unreachable through
an obviously-invalid call.

`P10` therefore submits a **valid** call starved of gas. The gas limit is computed at run time
to fall between the intrinsic cost of the transaction and its execution cost, so estimation
succeeds and the call runs out of gas inside the contract. That produces a broadcast that
reverts onchain without needing a purpose-built contract, a deployer key or a faucet.

If both paths fail to produce a reverted broadcast, the claim "a reverted broadcast is
distinguishable from a transport failure" cannot be settled from this repository and the
architecture has to treat every accepted execution as potentially reverting.

## The transport-failure experiment, and its honest limit

`P11` sends a real, complete request and stops listening 250 ms later. Nothing is mocked: the
request reaches KeeperHub and KeeperHub does whatever it does. The client is left in exactly
the state the threat model cares about, holding an idempotency key and a body hash and no
response.

What it cannot reproduce: a network partition that drops the response *after* KeeperHub has
committed, at a moment of KeeperHub's choosing rather than the client's. Inducing that would
need infrastructure manipulation this project will not perform. A client-side abort is the
nearest reproducible ambiguity case, and it is genuinely ambiguous from the client's side,
which is the property under test.

`P11` then tries all three recovery routes in order and records which ones work:

1. list the executions — `GET /api/execute`, `GET /api/executions`;
2. replay the stored idempotency key with a byte-identical body;
3. ask chain whether the effect happened, by searching for the attempt's own challenge word.

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

## Items this checklist deliberately does not cover

- The atomic RESURV attempt, its events and its fee transfer. Phase 1.
- Marketplace billing. Out of scope for v1.
- MCP and the Claude Code plugin. Not on the execution critical path.
- Analytics and the SSE stream. Supplemental observability, PRD 12.12.
- Mainnet anything.

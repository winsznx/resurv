# RESURV claim ledger

Update this file whenever implementation or public wording changes.

Nothing here may be stated publicly at a higher confidence than its status.

## Status vocabulary

| Status | Meaning |
|---|---|
| `DOCUMENTED` | Stated in official documentation. Not reproduced by us. |
| `MEASURED_EXTERNAL` | Reproduced live against the real system, but from a different repository (`keeperhub-flightcheck`), not by a RESURV seam test. Strong evidence, not yet ours. |
| `VERIFIED` | Reproduced by a RESURV seam test in this repository, with the evidence committed. |
| `ASSUMED` | Believed, untested. May not appear in any public statement. |
| `REFUTED` | Measured false. Must be actively kept out of public wording. |
| `OUT OF SCOPE` | Requires a gate this version will not reach. |

A claim never gets promoted because implementation code exists. Only evidence promotes it.

## KeeperHub protocol

| Claim | Status | Evidence | Last checked | Owner |
|---|---|---|---|---|
| Direct Execution supports simulation and idempotency | DOCUMENTED | Official Direct Execution API docs | 2026-08-04 | Tim |
| Idempotency replay window is 24 hours | DOCUMENTED | Official Direct Execution API docs | 2026-08-04 | Tim |
| Failed marketplace workflow calls are not charged | DOCUMENTED | Official Marketplace docs | 2026-08-04 | Tim |
| Base Sepolia is enabled for our organization | MEASURED_EXTERNAL | Live `GET /api/chains`: chainId 84532, `isEnabled: true` | 2026-08-10 | Engineering |
| Base Sepolia does **not** use a private mempool | REFUTED (as a benefit) | Live `GET /api/chains`: `usePrivateMempoolRpc: false` on 84532, true only on Ethereum mainnet/Sepolia | 2026-08-10 | Engineering |
| Gas is sponsored on Base Sepolia for this org | MEASURED_EXTERNAL | Org wallet held 0 ETH, transaction landed, `sponsored: true` | 2026-08-11 | Engineering |
| `msg.sender` at the target equals the org wallet under `sponsored: true` | MEASURED_EXTERNAL | Decoded event sender `0xfd35…834c` while `receipt.from` was a relayer and `receipt.to` a router | 2026-08-11 | Engineering |
| `/contract-call` 202 carries no `transactionHash` | MEASURED_EXTERNAL | Live 202 body was `{executionId, status:"completed"}` only; hash appeared solely on the status endpoint | 2026-08-11 | Engineering |
| `unconfirmed` is a real, non-terminal status absent from the endpoint reference | DOCUMENTED (conflicting) | Endpoint reference lists four statuses; the first-verified-transaction guide describes a fifth | 2026-08-10 | Engineering |
| A would-revert simulation answers HTTP 400 with `wouldRevert` in the body | DOCUMENTED | Direct Execution docs | 2026-08-10 | Engineering |
| Simulation can pass while the payer holds zero balance | MEASURED_EXTERNAL | `simulate: true` returned `wouldRevert: false` with a 0-ETH sender | 2026-08-11 | Engineering |
| `gasUsedWei` carries gas units, not wei | MEASURED_EXTERNAL | Byte-identical to `receipts[0].gasUsed` | 2026-08-11 | Engineering |
| **A reverted broadcast is distinguishable from a transport failure** | ASSUMED | **Unmeasured. This is RESURV's core demo path and nothing has probed it yet.** | Pending | Engineering |

## RESURV mechanism

| Claim | Status | Evidence | Last checked | Owner |
|---|---|---|---|---|
| A terminal covenant state is absorbing | VERIFIED (model only) | `invariant_terminalStateIsAbsorbing`, 256 runs × 64 depth, 16,384 calls, 0 reverts | 2026-08-11 | Contracts |
| Covenant status ordinals agree across Solidity, TypeScript and Postgres | VERIFIED | `CovenantStatus.t.sol`, `covenant-status.test.ts`, `schema.test.ts` | 2026-08-11 | Contracts |
| An atomic attempt reverts the action when the outcome is false | ASSUMED | Requires the covenant contract, a Foundry invariant, and a Base Sepolia proof | Pending | Contracts |
| Successful action, verifier and fee release share one transaction | ASSUMED | Requires a linked transaction and its events | Pending | Contracts |
| A duplicate trigger cannot produce a second payment | ASSUMED | Requires contract and live replay tests | Pending | Contracts |
| A crash between send and response cannot double-submit | ASSUMED | Idempotency key derivation and canonical body hashing exist and are unit-tested; the kill-the-network replay has not been run | Pending | Engineering |

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

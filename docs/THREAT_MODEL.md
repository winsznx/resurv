# Threat model

Initial version, Phase 0. Expands each phase as real components land. Assets and trust
boundaries follow PRD 20.1 and 20.2.

Status of each control: `IN PLACE`, `PARTIAL`, `PLANNED`. Nothing is described as in place
because it is intended.

## Assets

| Asset | Where it lives | Worst case |
|---|---|---|
| Escrowed success fees | Covenant contract | Paid to the wrong party, or paid twice |
| Emergency action authority | Committed adapters | An unauthorized action executes |
| KeeperHub organization wallet | KeeperHub / Turnkey | Arbitrary execution as our organization |
| KeeperHub API key | `.env`, Worker secret | Same as above |
| Trigger authority key | Requester's control | Forged trigger |
| Action commitments and config hashes | Covenant contract | Substituted behavior at attempt time |
| Canonical receipts | Database | Fabricated proof |

## Trust boundaries

Browser → Worker → KeeperHub → Turnkey → chain, plus Worker → RPC providers, and inside the
contract: covenant manager → adapter → target protocol, and covenant manager → verifier.

The two boundaries that carry the most risk are covenant manager → adapter, where a malicious
adapter could attempt reentrancy or partial execution, and Worker → KeeperHub, where the
organization wallet can in principle transact without RESURV's involvement at all.

## Threats and controls

### T1. A false outcome is reported as success

The whole product rests on this. Control: the verifier result is read inside the same
transaction as the action, and a false result reverts the entire attempt.
Status: `PLANNED`. The state machine that forbids leaving a terminal state is `IN PLACE` and
invariant-tested; the atomic attempt itself does not exist yet.

### T2. The success fee is released more than once

Control: terminal states are absorbing, so a satisfied covenant cannot re-enter a state from
which the fee is released. Status: `IN PLACE` at the model level, machine-checked by
`invariant_terminalStateIsAbsorbing`. `PLANNED` at the contract level.

### T3. A crash between broadcast and response causes a double submission

The realistic failure, not a hypothetical one. `/api/execute/contract-call` returns HTTP 202
with no transaction hash and there is no list-executions endpoint, so a lost response is
genuinely unrecoverable by query.

Controls: the idempotency key and canonical request body hash are persisted before the first
POST; recovery replays the stored key with a byte-identical body; the onchain semantic
attempt id rejects a replay permanently, beyond KeeperHub's 24-hour transport window.
Status: `PARTIAL`. Key derivation, canonical serialization and the schema columns are
`IN PLACE` and unit-tested. The kill-the-network replay test is `PLANNED`.

### T4. A model produces raw calldata

Control: adapters are capabilities. The adapter address and its config hash are committed
before arming, so the set of possible actions is fixed before any trigger exists, and the
planner selects among them rather than composing calls. Status: `IN PLACE` at the interface
level (`IResurvAction` forbids unbounded external calls and requires revert on partial
failure). Enforcement is `PLANNED` with the covenant contract.

### T5. Prompt injection through chain data or protocol metadata

Control: the planner's output is a constrained decision schema, never calldata, and every
decision is validated before use. Status: `PLANNED`, agent phase.

### T6. Secret disclosure

Controls in place: `.gitignore` covers `.env`, `.env.*`, `.dev.vars`, keystores, `*.pem`,
`*.key` and Supabase local secrets, verified with `git check-ignore`. CI has a job that fails
if any such file is ever tracked. `@resurv/config` redacts every declared secret and a test
asserts no secret substring survives serialization. `/api/health` names failing variables but
never their values, with a test asserting the key does not appear in the response. Claude Code
permissions deny reads of `.env`, keystores, `~/.ssh` and `~/.aws`.
Status: `IN PLACE`.

Residual: the Claude Code deny list is pattern-matched on the command string. It stops the
obvious form and not a determined rewrite. It is a speed bump, not a sandbox.

### T7. The KeeperHub organization wallet bypasses RESURV

The wallet can transact independently of any covenant. Nothing in RESURV prevents this.
Control: the covenant contract must gate on covenant state and committed configuration, so a
direct call that is not a legitimate attempt fails at the contract rather than at the API.
Status: `PLANNED`. Recorded here because it is a judge-facing question, not a hidden one.

Relevant measurement: under `sponsored: true`, `msg.sender` at the target was the org wallet
even though `receipt.from` was a relayer and `receipt.to` a router. Access control keys on the
org wallet address, not on anything visible in the receipt. The `sponsored: false` path is
unmeasured and nothing is asserted about it.

### T8. Verifying a run by looking at the wrong address

Under sponsorship the org wallet neither sends nor pays, so its explorer transaction list
shows nothing. Control: verification goes transaction hash → receipt → decoded log, fetched
from a public node, never by inspecting an EOA's transaction list.
Status: `IN PLACE` as a rule; two independent RPC origins are pinned in `@resurv/chain` and
tested to be distinct hosts we do not control.

### T9. A single RPC node decides a proof

Control: quorum across at least two independent origins. Status: `PARTIAL`. The endpoints are
pinned and tested for distinctness; the quorum client is `PLANNED`.

## Residual risks accepted for v1

- The RESURV admin role and the KeeperHub organization wallet are trusted. The product is not
  trustless and must never be described as such.
- Base Sepolia has no private mempool, so nothing about MEV protection may be claimed.
- Gas sponsorship was observed once, on one organization, on one chain. It is reported as
  observed, never promised.
- No external audit. Not production-ready, by definition of the production gate.

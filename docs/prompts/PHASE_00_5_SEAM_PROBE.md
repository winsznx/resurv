# Phase 0.5 prompt: KeeperHub attempt semantics

Run in a fresh session, only after Phase 0 independent validation returns PASS.

## Prerequisites, handle these before opening the session

`.env` must exist in this repository with a valid `kh_` organization key. It does not exist
by default. The prompt below correctly forbids the session from copying a credential out of
another repository, so without this the session halts on `USER ACTION REQUIRED` immediately.

```bash
cp .env.example .env    # then paste the kh_ key
```

Nothing else is required. See the fixture note below: this probe needs no contract
deployment, no deployer key and no faucet.

## Fixture note: the revert path needs no deployment

The prompt asks for a purpose-built seam fixture. That implies `forge script --broadcast`,
a funded `DEPLOYER_PRIVATE_KEY` and a faucet trip. KeeperHub's gas sponsorship covers calls
it executes, not a Foundry deployment, so that is a real separate blocker.

There is an already-deployed target that gives the deterministic pair for free.
`0x2A6FC8182Bf9928Ef7517dA980dC79e8107c555A` on Base Sepolia exposes exactly one function,
`ping(bytes32)`, and declares no fallback and no receive.

| Case | Call | Why it is deterministic |
|---|---|---|
| guaranteed success | `ping(bytes32)` with a fresh challenge, value 0 | Already landed once, tx `0xb4098917…d452dc` |
| guaranteed revert | an ABI declaring a function the canary does not implement, value 0 | Encoding succeeds locally, no matching selector and no fallback onchain, so the call reverts at the contract |

Keep value at 0 on both. The org wallet holds 0 ETH under sponsorship, so a value-carrying
call to the non-payable `ping` would revert on balance rather than on payability and
confound the measurement.

If the probe finds KeeperHub refuses to broadcast anything its own pre-simulation predicts
will revert, a purpose-built fixture would not change that answer. That finding is itself a
`SEAM REVISE` result and should be reported as one, not worked around.

## The prompt

```text
Phase 0 has independently passed.

Before beginning Phase 1, execute one mandatory protocol-seam gate:
PHASE 0.5 - KeeperHub Attempt Semantics.

This is not a product phase and should not expand scope. Its sole purpose is to empirically
determine the authoritative state machine for a KeeperHub write attempt before RESURV's
covenant contracts and orchestrator depend on it.

Read first: CLAUDE.md, RESURV_PRD_v1.0.md, docs/CLAIMS.md, docs/BUILD_STATE.md,
docs/THREAT_MODEL.md, docs/DECISIONS.md, the existing KeeperHub client code, and the
current official KeeperHub documentation for direct contract execution, simulation,
execution status, idempotency and error responses.

Do not trust previous flightcheck results as proof for this repository.

REQUIRED QUESTION

Determine, using the smallest possible real KeeperHub experiment, whether RESURV can
reliably distinguish these states:

 1. request rejected locally before KeeperHub
 2. KeeperHub authentication or configuration failure
 3. simulation predicts revert and no transaction is broadcast
 4. KeeperHub accepts execution but the onchain transaction reverts
 5. KeeperHub accepts execution and the transaction confirms successfully
 6. HTTP or network response is lost after KeeperHub accepts the request
 7. repeated request with the same idempotency key
 8. repeated economic action with a new idempotency key
 9. status temporarily unknown or pending
10. final onchain outcome known independently from KeeperHub

SAFETY

Use the smallest safe contract and smallest-value or zero-value operation capable of
proving the semantics. Do not use production user funds. Do not build the RESURV product
yet. If a dedicated test contract is required, keep it minimal and clearly marked as a seam
fixture.

If the KeeperHub API credential is not present in this repository, stop only at that
boundary and return USER ACTION REQUIRED with the exact environment variable required and
nothing else. Never copy credentials from another repository yourself.

EXPERIMENT DESIGN

Create a deterministic fixture capable of producing at minimum a guaranteed success and a
guaranteed revert. Prefer a purpose-built test contract over relying on unpredictable
third-party protocol state.

For each scenario capture: request body hash, semantic attempt identifier, KeeperHub
idempotency key, HTTP status, KeeperHub response body with secrets redacted, execution ID
if returned, transaction hash if returned, KeeperHub execution status transitions,
independent RPC transaction receipt, independent RPC status, revert reason if recoverable,
whether retry returns the original execution or creates another, and whether any second
onchain effect occurs.

Do not infer transaction state from an HTTP response alone.

CRITICAL RESULT

Define one canonical RESURV attempt-state machine based only on observed behavior. Use
whatever states the evidence supports, not a suggested vocabulary.

Define which source is authoritative for every transition: local validation, KeeperHub API,
target-chain RPC, or the RESURV durable store.

Define exactly when the orchestrator is allowed to advance to the next recovery action.
The safe default must be: if execution state is ambiguous, DO NOT advance to the next
semantic action until reconciliation proves the previous action cannot still produce an
effect.

CLAIM LEDGER

Update docs/CLAIMS.md. The claim "a reverted broadcast is distinguishable from a transport
failure" must become VERIFIED, REFUTED, or remain ASSUMED based on the actual experiment.
Do not weaken the meaning of VERIFIED to make the architecture work. Add any other
behaviors discovered at the appropriate evidence level.

DURABLE OUTPUTS

Create docs/phase-logs/PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md.
Update docs/BUILD_STATE.md, docs/CLAIMS.md, docs/DECISIONS.md if architecture changes,
docs/THREAT_MODEL.md if new failure modes appear, and KeeperHub client fixtures or tests
only where the experiment needs them.

The phase log must contain the real execution IDs and transaction hashes where applicable.

EXIT DECISION

End with exactly one of:

SEAM PASS - the observed semantics support a deterministic RESURV attempt lifecycle without
risking duplicate semantic execution. State the exact lifecycle we will implement.

SEAM REVISE - KeeperHub behavior is usable but the planned lifecycle must change. State the
smallest architecture change required.

SEAM FAIL - the behavior cannot safely support the current dominant mechanism. State the
falsified assumption and stop.

Do not begin Phase 1 in this session.
```

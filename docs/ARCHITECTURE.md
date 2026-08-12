# Architecture

What exists today, and where the parts that do not exist yet will go. Deviations from
`RESURV_PRD_v1.0.md` section 14 are recorded in `docs/DECISIONS.md`.

## Shape

```text
resurv/
  apps/
    web/                  Vite + React 19 SPA. Design tokens from design.md. No product UI yet.
    worker/               Hono on Cloudflare Workers. Serves /api/* and the built SPA.
  packages/
    contracts/            Foundry. Solidity 0.8.36, evm_version cancun.
    repo-policy/          Executable repository policy: permission boundary, tracked secrets,
                          cross-language state machine pin. Tests only, ships nothing.
    domain/               Pure reference model: covenant + orchestration state machines.
    keeperhub-client/     Status normalization, error envelopes, idempotency derivation.
    seam-probe/           Phase 0.5 attempt-semantics probe. Offline half in the gate; live
                          half spends a credential and is auto-approved by nothing.
    chain/                Base Sepolia constants and independent RPC endpoints.
    config/               Zod environment validation and secret redaction.
    db/                   Drizzle schema, generated migration, repository interfaces.
  docs/
    keeperhub/            Official-source snapshot and the seam-test checklist.
  .claude/                Project settings, four reviewer subagents, phase-gate skill.
```

Deferred packages from PRD 14.1, each to the phase that needs it: `agent` (bounded planner),
`observability`, `sdk`, `ui`. Nothing is scaffolded before it does real work.

## Runtime

One Cloudflare Worker, three entry points:

- `fetch` answers `/api/*` and falls through to static assets for everything else. Read APIs,
  trigger ingestion, health. No long-running loop lives here (PRD 14.4).
- `scheduled` will run the reconciliation sweep. Not yet registered.
- `queue` will run attempt execution. Not yet registered.

Only `fetch` exists. `/api/health` is the sole route: it validates the environment and reports
whether configuration parsed, naming any failing variable without ever echoing its value.

## Source-of-truth boundaries (PRD 14.3, unchanged)

- Chain decides covenant status, verifier result, and payment.
- KeeperHub decides its own execution ids, status and transaction link.
- The RESURV database holds orchestration history, simulation evidence and receipts.
- The UI is never a source of truth.

## The reference state machine

`CovenantStatus` exists three times, and a fourth definition exists twice as a test-only
oracle:

| Where | What pins it |
|---|---|
| `packages/contracts/src/CovenantStatus.sol` | equivalence with the Solidity reference model over all 64 pairs |
| `packages/domain/src/covenant-status.ts` | equivalence with the TypeScript reference model over all 64 pairs |
| `packages/db` `onchain_status` enum | `schema.test.ts` compares against the domain names |
| `packages/contracts/test/model/CovenantStatusReference.sol` | compared to its TypeScript twin by `@resurv/repo-policy` |
| `packages/domain/test/model/covenant-status-reference.ts` | same test, character for character |

The contract emits the numeric ordinal and TypeScript decodes it, so a reordering is a
decoding bug, not a rename. `@resurv/repo-policy` parses the Solidity enum out of source and
compares names and ordinals against `@resurv/domain`, which is the pairing that was never
actually compared at Phase 0: each side asserted its own literals against itself.

The reference models exist because of ADR-009. A property test whose generator is filtered by
the implementation under test proves only that the implementation agrees with itself, which is
what the Phase 0 invariant suite did.

Terminal absorption is machine-checked against the model's definition of terminal, not the
library's: 256 runs at depth 64, every call a real transition attempt, with applied
transitions, rejected attempts and pair coverage reported per run. The property was confirmed
by mutation rather than by inspection. Five source mutations, each detected. See
`docs/phase-logs/PHASE_00_REMEDIATION.md`.

## What the KeeperHub client encodes

Provenance first, because the Phase 0 version of this section claimed every rule came from a
live probe contradicting the docs, and at the time none had. Phase 0.5 ran that probe: 16
scenarios, live, on 2026-08-12, evidence committed. Most rules below are now measured from this
repository, and `docs/CLAIMS.md` carries the level of each.

The three that changed the architecture rather than the client:

- **HTTP 202 is not acceptance.** A refused attempt and a successful one both answer 202 with an
  `executionId`. The body's `status` decides, and only a chain read confirms. ADR-013.
- **Transport idempotency bounds effects per key, not per action.** A new key for the same
  economic action executed it a second time, so semantic idempotency has to be onchain.
- **Ambiguity is a state.** A lost response is genuinely undecidable client-side and genuinely
  resolvable, by replaying the key and then asking the chain.

- The documented status set is a lower bound. Anything unrecognized normalizes to `UNKNOWN`
  and non-terminal, so a `switch` with `default: fail` cannot report a false failure for a
  transaction that is still settling.
- `unconfirmed` is treated as non-terminal. Phase 0.5 could not find the official page that was
  cited for it, so it is `ASSUMED` rather than `DOCUMENTED (conflicting)`. The handling stays
  because the rule above already covers it: an unrecognized status is non-terminal anyway.
- `not_found` and `timeout` receipt statuses are `UNKNOWN`, never success and never failure.
- A would-revert simulation is an *answer*, delivered as HTTP 400. Callers branch on the
  `wouldRevert` field, never on the status code.
- Error envelopes are not uniform. Three shapes were measured live: `{error}` alone on a 401 and
  on an unknown execution id; `{error: code, detail: sentence, request_id}` on an unrouted 404;
  and `{error: sentence, code, retryable, originalExecutionId?}` on both 409s, where `error` and
  `code` swap roles. `errors.ts` normalizes all three, and parses `retryable` and
  `originalExecutionId` because both are load-bearing and neither is documented.
- Idempotency keys are namespaced `resurv/v1`, because another project shares this
  organization's API key and idempotency scope is per organization and per endpoint.
- Request bodies serialize through a key-sorting canonicalizer, because a replay must be
  byte-identical or KeeperHub answers 409.

## The attempt lifecycle

Measured in Phase 0.5, specified in ADR-013, and not yet implemented anywhere.

```
PLANNED ─► REJECTED_LOCALLY | SIMULATION_REJECTED | SIMULATED_OK
SIMULATED_OK ─► KEY_COMMITTED
KEY_COMMITTED ─► EXECUTED_NO_EFFECT | RECONCILIATION_REQUIRED
RECONCILIATION_REQUIRED ─► CONFIRMED | REVERTED | PROVEN_NOT_BROADCAST | itself
```

There is no `ACCEPTED` and no `PENDING`. Both were in the design this project started with, and
the measurements removed them: a 2xx with an `executionId` is not acceptance, and the POST is
synchronous so there is no pending phase to poll.

`CONFIRMED` requires a chain receipt from two agreeing origins **and** the expected event
**and** no inner-failure signal. RESURV may start another semantic recovery action only from a
terminal state that was entered on chain evidence. Full table, reconciliation algorithm and
advancement rule: `docs/phase-logs/PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md` sections 8 and 9.

## Data layer

Schema follows PRD 15.1 for the execution critical path. `users`, `organizations` and
`organization_members` are deferred to the operator-auth phase.

Two shapes matter more than the rest:

- `keeperhub_executions.idempotency_key_hash` is `NOT NULL` and unique, while `execution_id`
  and `transaction_hash` are nullable. That asymmetry is deliberate: the key is written before
  the first POST and is the only durable evidence that a broadcast may be in flight.
- `attempts.semantic_attempt_id` is unique. Claiming an attempt must be a single
  `INSERT ... ON CONFLICT DO NOTHING`; a read-then-write races two workers into two attempts
  for one economic action.

All uint256 quantities are `numeric(78, 0)`. `bigint` would silently truncate a wei value.

## Deployment

Cloudflare only. See `docs/DEPLOYMENTS.md`.

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
    domain/               Pure reference model: covenant + orchestration state machines.
    keeperhub-client/     Status normalization, error envelopes, idempotency derivation.
    chain/                Base Sepolia constants and independent RPC endpoints.
    config/               Zod environment validation and secret redaction.
    db/                   Drizzle schema, generated migration, repository interfaces.
  docs/
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

`CovenantStatus` exists three times and all three are pinned to each other:

| Where | What pins it |
|---|---|
| `packages/contracts/src/CovenantStatus.sol` | `test_ordinalsAreStable` |
| `packages/domain/src/covenant-status.ts` | `is contiguous and gap-free` |
| `packages/db` `onchain_status` enum | `schema.test.ts` compares against the domain names |

The contract emits the numeric ordinal and TypeScript decodes it, so a reordering is a
decoding bug, not a rename. Three suites fail if anyone tries.

The absorbing property of terminal states is machine-checked by a stateful invariant, not
just asserted: 256 runs at depth 64, 16,384 handler calls, no transition ever applied after
a terminal state was reached.

## What the KeeperHub client encodes

Every rule in `packages/keeperhub-client` exists because a live probe contradicted the docs.
The seam evidence is recorded in `docs/CLAIMS.md`.

- The documented status set is a lower bound. Anything unrecognized normalizes to `UNKNOWN`
  and non-terminal, so a `switch` with `default: fail` cannot report a false failure for a
  transaction that is still settling.
- `unconfirmed` is real, non-terminal, and missing from the endpoint reference.
- `not_found` and `timeout` receipt statuses are `UNKNOWN`, never success and never failure.
- A would-revert simulation is an *answer*, delivered as HTTP 400. Callers branch on the
  `wouldRevert` field, never on the status code.
- Error envelopes are not uniform: 401 returns `{error}` alone, 404 returns
  `{error, detail, request_id}`. Both normalize to one shape and `request_id` is preserved.
- Idempotency keys are namespaced `resurv/v1`, because another project shares this
  organization's API key and idempotency scope is per organization and per endpoint.
- Request bodies serialize through a key-sorting canonicalizer, because a replay must be
  byte-identical or KeeperHub answers 409.

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

# Runbooks

## First run on a clean machine

```bash
pnpm install
cp .env.example .env          # fill in KEEPERHUB_API_KEY
pnpm gate                     # every required check, in order
```

Prerequisites: Node 24+, pnpm 11+, Foundry. Exact pins in `docs/VERSIONS.md`.

Foundry dependencies are vendored under `packages/contracts/lib` and need no install step.

## The gate

`pnpm gate` runs the full sequence. Individually:

| Command | What it covers |
|---|---|
| `pnpm format:check` | Biome formatting, all languages |
| `pnpm lint` | Biome lint, then `forge fmt --check` |
| `pnpm typecheck` | `tsc --noEmit` per package, plus `forge build --sizes` |
| `pnpm test` | Unit tests, TypeScript and Solidity |
| `pnpm test:integration` | Worker integration tests |
| `pnpm test:e2e` | Browser end-to-end tests |
| `pnpm build` | SPA build, then the Worker bundle |
| `pnpm --filter contracts test` | Foundry unit and fuzz |
| `pnpm --filter contracts test:invariant` | Stateful invariants only |

Turbo caches aggressively. `pnpm clean` if a result looks impossible.

## Local development

```bash
pnpm --filter @resurv/worker dev    # wrangler dev on :8787
pnpm --filter @resurv/web dev       # vite on :5173, proxies /api to :8787
```

## Regenerating the database migration

```bash
pnpm --filter @resurv/db migrate:generate
```

Diffs the schema and writes SQL. No connection required. Commit the generated file with the
schema change that produced it, never separately.

## Diagnosing a KeeperHub call

Read `docs/CLAIMS.md` first. The failures that look like bugs are usually documented seam
behavior:

| Symptom | Cause |
|---|---|
| `transactionHash` is `undefined` after a successful broadcast | `/contract-call` omits it from the 202. Poll `GET /api/execute/{id}/status` |
| HTTP 400 on a simulation | That is an answer. Read `wouldRevert` before classifying it |
| Bare 401 with no detail or request id | The 401 envelope carries neither. Check the key starts with `kh_`, not `wfb_` |
| 409 `idempotency_conflict` | Same key, different body. The body must be byte-identical. Use the canonical serializer |
| 409 `idempotency_in_progress` | A previous attempt with this key is still running. Do not retry with a new key |
| Status is not one of the four documented values | The documented set is a lower bound. Treat unknown as non-terminal and keep polling |
| Explorer shows nothing at the org wallet | Under sponsorship it neither sends nor pays. Verify by hash → receipt → log |

Rate limit is 60 requests per minute per key. Honor `Retry-After`. Poll cadence comes from
`X-Poll-Interval-Hint`, where `0` means terminal.

## Rotating the KeeperHub key

```bash
cd apps/worker
wrangler secret put KEEPERHUB_API_KEY
```

Then update `.env` locally. Never paste the value into a terminal echo, a log, an issue, or a
phase summary. The old key stays valid until revoked in the KeeperHub dashboard.

## If a phase gate fails

Do not weaken the check. `CLAUDE.md` forbids suppressing type, lint, security or test
failures, and a skipped test needs a written reason and a phase reference. Fix the cause,
rerun the gate, and record what happened in that phase's log.

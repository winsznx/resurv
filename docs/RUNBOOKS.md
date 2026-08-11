# Runbooks

## First run on a clean machine

```bash
git clone --recurse-submodules <url> resurv
cd resurv
pnpm install
pnpm gate                     # every required check, in order
```

Prerequisites: Node 24+, pnpm 11+, Foundry. Exact pins in `docs/VERSIONS.md`.

Foundry dependencies are **git submodules**, not vendored files. `packages/contracts/lib`
holds two gitlinks (`git ls-files -s` reports mode `160000`), so a plain `git clone` leaves
those directories empty. If you have already cloned without submodules:

```bash
git submodule update --init --recursive
```

Measured, so nobody has to guess: a plain clone still passes `pnpm gate`, because Foundry 1.7.1
runs `git submodule update` itself when `lib` is empty and prints `Updating dependencies in
.../lib` while doing it. That repair needs git and a reachable GitHub, so it is a network fetch
rather than the no-install-step property a vendored dependency would give you. On a machine
without network access, or in any tool that reads the tree without invoking forge, the empty
directories are what you get. Clone with submodules and the question does not arise.

Verify with `git submodule status`: `forge-std` at `bf647bd` (v1.16.2) and
`openzeppelin-contracts` at `5fd1781` (v5.6.1). CI does this with
`actions/checkout` and `submodules: recursive`.

A `.env` file is not required to run the gate. Nothing in the current test suite makes a
network call or reads a credential. `cp .env.example .env` and pasting a `kh_` organization
key is a Phase 0.5 step, done by a human in a terminal: Claude Code's deny rules block that
path deliberately, so do not expect an agent session to perform it.

## The gate

`pnpm gate` runs every command `CLAUDE.md` declares required, in order:

| Command | What it covers |
|---|---|
| `pnpm format:check` | Biome formatting, all languages |
| `pnpm lint` | Biome lint, then `forge fmt --check` |
| `pnpm typecheck` | `tsc --noEmit` per package, plus `forge build --sizes` |
| `pnpm test` | Unit tests, TypeScript |
| `pnpm test:integration` | Worker integration harness. **0 specs today.** See below |
| `pnpm test:e2e` | Browser end-to-end harness. **0 specs today.** See below |
| `pnpm build` | SPA build, then the Worker bundle |
| `pnpm --filter contracts test` | Foundry unit, fuzz and invariant |
| `pnpm --filter contracts test:invariant` | Stateful invariants only |

`test:integration` and `test:e2e` run with `--passWithNoTests` against directories that
contain a README and nothing else. They exit 0 while asserting nothing. Read
`apps/worker/test/integration/README.md` and `apps/web/test/e2e/README.md` before treating a
green run as coverage. Until the Phase 0 remediation, `pnpm gate` did not run these two at
all while two documents called it the full sequence.

Turbo caches aggressively, and a cached run replays the previous log rather than executing.
For evidence, force execution:

```bash
turbo run test --force
TURBO_FORCE=true pnpm gate
```

`pnpm clean` if a result looks impossible.

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

Read `docs/CLAIMS.md` first, and read it as a ledger rather than as a manual. Every row in the
table below is encoded in `@resurv/keeperhub-client` at `DOCUMENTED` or `ASSUMED`, not at
`VERIFIED`: no KeeperHub call has ever been made from this repository. The Phase 0 review
found this table presented as settled diagnosis, which it is not.

| Symptom | Expected cause | Ledger status |
|---|---|---|
| `transactionHash` is `undefined` after a successful broadcast | `/contract-call` omits it from the 202. Poll `GET /api/execute/{id}/status` | `MEASURED_EXTERNAL` |
| HTTP 400 on a simulation | That is an answer. Read `wouldRevert` before classifying it | `DOCUMENTED` |
| Bare 401 with no detail or request id | The 401 envelope carries neither. Check the key starts with `kh_`, not `wfb_` | `ASSUMED` |
| 409 `idempotency_conflict` | Same key, different body. Use the canonical serializer | `ASSUMED` |
| 409 `idempotency_in_progress` | A previous attempt with this key is still running. Do not retry with a new key | `ASSUMED` |
| Status is not one of the four documented values | The documented set is a lower bound. Treat unknown as non-terminal and keep polling | `DOCUMENTED (conflicting)` |
| Explorer shows nothing at the org wallet | Under sponsorship it neither sends nor pays. Verify by hash → receipt → log | `MEASURED_EXTERNAL` |

The rate limit (60 requests per minute per key), `Retry-After`, and the `X-Poll-Interval-Hint`
semantics where `0` means terminal are all `ASSUMED` in the ledger. Honor them, and expect the
Phase 0.5 seam probe to confirm or refute them rather than assuming it will confirm them.

## Rotating the KeeperHub key

```bash
cd apps/worker
wrangler secret put KEEPERHUB_API_KEY
```

Then update the local environment file. Never paste the value into a terminal echo, a log, an
issue, or a phase summary. The old key stays valid until revoked in the KeeperHub dashboard.
This is a human step: `wrangler secret` is denied to Claude Code, wrapper forms included.

## If a phase gate fails

Do not weaken the check. `CLAUDE.md` forbids suppressing type, lint, security or test
failures, and a skipped test needs a written reason and a phase reference. Fix the cause,
rerun the gate, and record what happened in that phase's log.

## If the permission policy blocks you

`packages/repo-policy` encodes the boundary as tests. If a legitimate command is refused, the
fix is to add a narrow, exact allow rule to `.claude/settings.json` and let
`test/permission-boundary.test.ts` confirm it does not reopen a known bypass. Widening a rule
into a prefix over a command runner (`pnpm exec`, `npx`, `turbo run`) will fail that test,
which is the point.

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

Verify with `git submodule status`, run from `packages/contracts`:

```
 bf647bd6046f2f7da30d0c2bf435e5c76a780c1b lib/forge-std (v1.16.2)
 5fd1781b1454fd1ef8e722282f86f9293cacf256 lib/openzeppelin-contracts (v4.8.0-1122-g5fd1781b)
```

The second line is the pin `docs/VERSIONS.md` records as v5.6.1, and the two do not disagree.
`git submodule status` describes the checked-out commit against the nearest reachable
annotated tag in that repository, and OpenZeppelin's history reaches `v4.8.0` that way, so the
output reads `v4.8.0-1122-g5fd1781b`: 1122 commits past `v4.8.0`, at `5fd1781b`. The version is
confirmed inside the submodule instead, where `git tag --points-at HEAD` returns `v5.6.1` and
`package.json` says `"version": "5.6.1"`. Two documents transcribed this line as `(v5.6.1)`
before the pre-seam hardening pass, which is output the command has never produced.

CI populates both with `actions/checkout` and `submodules: recursive`.

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

Read `docs/CLAIMS.md` first, and read it as a ledger rather than as a manual. Nothing below is
`VERIFIED`: no KeeperHub call has ever been made from this repository. The Phase 0 review found
this table presented as settled diagnosis, which it is not. Phase 0.5 gave most rows a real
source pointer, in `docs/keeperhub/SOURCE_SNAPSHOT.md`, which is still not the same as having
seen one.

| Symptom | Expected cause | Ledger status |
|---|---|---|
| `transactionHash` is `undefined` after a successful broadcast | `/contract-call` omits it from the 202. Poll `GET /api/execute/{id}/status` | `MEASURED_EXTERNAL` |
| HTTP 400 on a simulation | That is an answer. Read `wouldRevert` before classifying it | `DOCUMENTED` |
| 401 with fields you did not expect | The vendor documents three different error envelope shapes and `errors.ts` parses one. Log the raw body before trusting a parsed field | `DOCUMENTED (conflicting)` |
| Bare 401 with no detail or request id | Our code expects this; the docs say every error carries `request_id`. Whichever it is, check the key starts with `kh_`, not `wfb_` | `ASSUMED`, contradicted by the docs |
| 409 `idempotency_conflict` | Same key, different body. Use the canonical serializer. `retryable: false` | `DOCUMENTED` |
| 409 `idempotency_in_progress` | A previous attempt with this key is still running. Retry the same key; never rotate to a new one | `DOCUMENTED` |
| 403 `Daily spending cap exceeded` | An organization cap, not an auth problem. Do not retry on a new key, and do not advance to the next recovery action | `DOCUMENTED` |
| A response carrying `idempotentReplay: true` | This is a replay of an earlier response, not a new execution | `DOCUMENTED` |
| Status is not one of the four documented values | The documented set is a lower bound. Treat unknown as non-terminal and keep polling | `DOCUMENTED` for the four; the fifth (`unconfirmed`) has no locatable source |
| `receiptStatus: safe_inner_failure` | The outer transaction succeeded and the inner call failed. Treat the attempt as failed regardless of the receipt status | `DOCUMENTED` value, `ASSUMED` meaning. T15 |
| Explorer shows nothing at the org wallet | Under sponsorship it neither sends nor pays. Verify by hash → receipt → log | `MEASURED_EXTERNAL` |

The rate limit is documented twice and differently: 60 per minute per key on the Direct
Execution page, 100 per minute for authenticated users on the API overview. We encode 60.
`Retry-After` appears on 429 only, and `X-Poll-Interval-Hint` carries seconds with `0` meaning
terminal, both now `DOCUMENTED` rather than `ASSUMED`.

## Running the KeeperHub seam probe

```bash
cp .env.example .env    # human step, in an ordinary terminal; paste the kh_ key with an editor
pnpm --filter @resurv/seam-probe test:seam
```

Twelve scenarios, a few minutes, evidence written to `docs/phase-logs/evidence/phase-00-5/`. It
spends the organization credential and lands real Base Sepolia transactions, so it sits outside
`pnpm gate` and outside every auto-approved Claude Code command by design.
`packages/repo-policy` classifies `vitest run --dir test/live` as an external effect and fails
if anyone ever allow-lists a path to it.

Without a credential it stops at `beforeAll` with `USER ACTION REQUIRED` and prints which of the
five runtime configuration paths it checked. That message contains no value and cannot: the
loader returns variable names only.

`pnpm --filter @resurv/seam-probe test` is the offline half, runs in the gate, and touches no
network.

Read `docs/keeperhub/SEAM_CHECKLIST.md` before interpreting a run. It maps each scenario to the
attempt state it settles and records which are still open.

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

## The one local secret Phase 0.5 needs

Nothing in this repository has ever held a live credential, and `pnpm gate` does not need one.
Phase 0.5 needs exactly one, and this is the whole path.

| | |
|---|---|
| Variable | `KEEPERHUB_API_KEY` |
| Value | an organization key beginning `kh_`. A `wfb_` webhook key cannot execute |
| File | `.env` at the repository root, copied from `.env.example` |
| Who creates it | a human, in an ordinary terminal, before the session starts |
| Who reads it | the test or Worker process, at runtime |

`KEEPERHUB_API_KEY` is the only required one. `DATABASE_URL`, `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are optional in `serverSecretsSchema` and Phase 0.5 needs none of
them.

```bash
cp .env.example .env    # then paste the kh_ key with an editor
```

Why an ignored repository-local file and not an exported shell variable: a variable in the
environment is reachable by `printenv`, by `env`, and by any process that inherits it, and it
survives into every subsequent command in that terminal. A file is reachable only by something
that opens it, and `.env` is denied to `Read`, to `Edit` and to any Bash command whose text
names it. The trade is deliberate and `docs/THREAT_MODEL.md` T13 records it.

The rules that hold this up, all measured rather than assumed:

- `.gitignore` covers `.env` and `.env.*` while un-ignoring `.env.example`, and
  `@resurv/repo-policy` fails if any secret-bearing file is ever tracked, in the working tree
  or anywhere in reachable history.
- `Read(./.env)` and `Edit(./.env)` deny both file tools. `Edit` covers Write.
- `Bash(*.env*)` denies any command naming the file, so `cat`, `head`, `sed` and `grep` cannot
  print it even though Claude Code runs those without a prompt.
- `Bash(*KEEPERHUB_API_KEY*)` denies any command naming the variable, in any form, which is
  what stops `echo $KEEPERHUB_API_KEY`. A pattern cannot contain `$`, so the name is the hook.
  See ADR-011.
- `printenv`, `env`, `export -p`, `declare -p`, `set` and `compgen -v` are denied.
- Diagnostics redact on three grounds: key name, value shape, and known values pulled from the
  parsed configuration. `apps/worker/src/index.ts` serializes through `redactedJson` and
  `/api/health` names failing variables, never their values.

The loader exists now: `packages/seam-probe/src/local-env.ts`, built in Phase 0.5. Node does not
read a dotenv file by itself, `--env-file=` would put the filename on a command line the deny
rules block, and vitest only exposes `VITE_`-prefixed variables, so the file is opened with
`node:fs` at runtime by the process that needs it. It differs from the sketch this section used
to carry in three ways, each deliberate:

- it is a plain module the live suite calls, not a vitest setup file, so the offline suite and
  the gate stay hermetic;
- it probes five paths rather than one, because `wrangler dev` reads `.dev.vars` by itself and
  PRD 12.2 calls the variable `KH_API_KEY` while this repository uses `KEEPERHUB_API_KEY`. A
  loader that checked one path and one spelling could report a missing credential that was
  present;
- it returns variable *names* and never values, and never overwrites something already in the
  process environment.

`wrangler dev` still reads `.dev.vars` by itself and needs no loader.

Rules for the value, which apply for the whole life of the project:

- never committed, never pasted into a terminal, a log, an issue, a phase summary or a screenshot
- never echoed, and never named on a command line
- never copied into a durable document, including this one
- rotate through the KeeperHub dashboard, then `wrangler secret put` by hand. See below

## If the permission policy blocks you

`packages/repo-policy` encodes the boundary as tests. If a legitimate command is refused, the
fix is to add a narrow, exact allow rule to `.claude/settings.json` and let
`test/permission-boundary.test.ts` confirm it does not reopen a known bypass. Widening a rule
into a prefix over a command runner (`pnpm exec`, `npx`, `turbo run`) will fail that test,
which is the point.

Four refusals are deliberate and will not be relaxed. Work around them rather than filing them
as bugs:

| Refused | Do this instead |
|---|---|
| any Bash command naming a home dotfile, including `ls ~/.config/...` | nothing in this project needs one |
| any Bash command containing `API_KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `PRIVATE_KEY` | use the Grep tool, which is a separate surface |
| `printenv`, `env`, `set`, `export -p` | read the schema in `packages/config/src/index.ts` |
| any command naming `.env` or `.dev.vars` | the file is created and edited by a human |

If a new allow-listed script is needed, add the rule **and** add the script to
`REVIEWED_AUTO_APPROVED_SCRIPTS` in `packages/repo-policy/src/approved-scripts.ts` with its
exact body. The suite fails until both exist, which is what turns adding authority into a
reviewed act rather than a one-line edit. See `packages/repo-policy/README.md`.

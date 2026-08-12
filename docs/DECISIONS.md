# Architecture decisions

Lightweight ADRs. Each entry records what was decided, what it replaced, and what would make
us revisit it. Rejected alternatives are recorded because the reasoning is the valuable part.

---

## ADR-001: Cloudflare Workers replaces the PRD's Railway profile

Date: 2026-08-11. Status: accepted. Phase: 0.

### Context

PRD 14.2 recommends Fastify for the API, Redis plus BullMQ for jobs and locks, Docker Compose
for local infrastructure, and a Railway deployment profile. A later operating instruction
requires all web-facing infrastructure to deploy to Cloudflare and explicitly forbids Railway,
Vercel, Netlify, Render, Fly.io, AWS, GCP and Azure.

### Decision

Cloudflare Workers is the deployment target. The PRD's service *responsibilities* are kept;
its *implementations* are replaced with the Cloudflare-native equivalent.

| PRD component | Built as | Why |
|---|---|---|
| Fastify API | Hono on Workers | Fastify assumes a Node HTTP server. Hono is the Workers-native router. |
| Redis + BullMQ | Cloudflare Queues, Durable Objects for locks | Neither runs in workerd. No TCP-Redis on the edge. |
| Docker Compose | not used | Nothing local to orchestrate once the runtime is Workers. |
| Railway | Workers + Workers Static Assets | Required by the operating instruction. |
| PostgreSQL | Supabase Postgres | Required by the operating instruction. See ADR-004. |

### Consequences

The PRD's stack section is now partially superseded and should be read as intent, not as a
parts list. Queues and Durable Objects are named here but not yet provisioned: nothing is
added until the orchestrator phase proves it is needed.

### Revisit if

The deployment constraint changes, or a Workers limit (CPU time, subrequest count) turns out
to block the reconciliation loop.

---

## ADR-002: One Worker with three entry points, not two deployables

Date: 2026-08-11. Status: accepted. Phase: 0.

### Context

PRD 14.4 separates API from Worker, and is explicit that the API must contain no
long-running execution loop. A naive reading suggests two deployments.

### Decision

One Worker exporting `fetch`, and later `scheduled` and `queue`. The architectural boundary
the PRD cares about is preserved, because the execution loop lives in `queue` and `scheduled`,
which are separate entry points that a request to `fetch` cannot enter.

### Alternatives rejected

Two Workers: doubles deploy surface and introduces service-binding or CORS plumbing for no
gain in the property the PRD is protecting.

Serving the SPA from a second origin: adds CORS to the critical demo path.

### Consequences

`apps/worker/wrangler.jsonc` serves `apps/web/dist` as static assets with `run_worker_first`
scoped to `/api/*`. One deploy, one origin, no CORS.

---

## ADR-003: TypeScript 7 pinned after empirical verification

Date: 2026-08-11. Status: accepted. Phase: 0.

### Context

`typescript@latest` resolves to 7.0.2, the native rewrite. Adopting a new major on a 46-hour
deadline is a real risk. The version policy in PRD 2.3 requires resolving the current stable
release rather than picking a comfortable one.

### Decision

Pin 7.0.2, then verify by typechecking the entire workspace under the full strict option set
before committing to it. All turbo typecheck tasks pass: 9 at Phase 0, 10 after the Phase 0
remediation added `@resurv/repo-policy`. The "14 tasks" figure recorded here at Phase 0 was
wrong and did not reproduce.

### Consequences

Documented rollback to 6.0.3 in `docs/VERSIONS.md`, expected to need no source changes.

---

## ADR-004: A database is justified, and the live connection is off the Phase 0 critical path

Date: 2026-08-11. Status: accepted. Phase: 0.

### Context

The operating instruction says not to add a database merely because most applications have
one, and to prove persistent offchain state is necessary first.

### The proof

KeeperHub's `/api/execute/contract-call` executes synchronously and returns HTTP 202. There
is no list-executions endpoint. If the client dies between sending the request and reading the
response, the execution id exists nowhere locally and cannot be recovered by querying. The
documented recovery is to replay the same `Idempotency-Key` with a byte-identical body. That
requires the key and the canonical body to be durable *before* the first POST. An in-memory
or per-request store cannot provide that. Persistent offchain state is therefore necessary,
not conventional.

### Decision

Supabase Postgres, per the operating instruction. Phase 0 delivers the schema, the generated
migration, and the typed repository interfaces, with no live connection. `@resurv/db` exposes
interfaces the orchestrator depends on, so crash-recovery logic can be built and tested
against an in-memory double while real credentials remain outstanding.

### Alternatives rejected

Cloudflare D1 would remove an external credential dependency and is native to the runtime.
Rejected because the operating instruction names Supabase explicitly and forbids falling back
to another hosted database. Flagged here because it is the one place where the infrastructure
constraint and the deadline pull in opposite directions.

### Load-bearing premise, now tracked

"There is no list-executions endpoint" carries this whole ADR. It is consistent with
`packages/keeperhub-client/src/constants.ts`, but that file is ours, so it proves nothing on
its own. The claim now has a `DOCUMENTED` row in `docs/CLAIMS.md`. If the premise is wrong the
ADR weakens and the persistence argument has to be remade.

### Open item

Supabase project credentials are not available. When the orchestrator needs a live
connection this becomes a blocking `USER ACTION REQUIRED`. Connection strategy for a
serverless runtime is transaction-mode pooling or the HTTP client, never a long-lived direct
Postgres socket, and the service-role key stays server-side.

---

## ADR-005: The contracts package is named `contracts`, unscoped

Date: 2026-08-11. Status: accepted. Phase: 0.

CLAUDE.md documents `pnpm --filter contracts test` and `pnpm --filter contracts test:invariant`
as required checks. pnpm's filter matches the full package name, so `@resurv/contracts` would
not resolve those documented commands and the Phase 0 exit gate requires every documented
command to work. Every other package keeps the `@resurv/` scope.

---

## ADR-006: Library packages are consumed as TypeScript source

Date: 2026-08-11. Status: accepted. Phase: 0.

`@resurv/domain`, `keeperhub-client`, `chain`, `config` and `db` export `./src/index.ts`
directly and have no build step. Vite and wrangler both bundle from source. Emitting
declarations would produce artifacts nothing consumes, and turbo correctly warned that those
build tasks generated no output. Apps build; libraries do not.

---

## ADR-007: The reference state machine exists in Solidity and TypeScript, cross-pinned

Date: 2026-08-11. Status: accepted, amended 2026-08-11 by the Phase 0 remediation. Phase: 0.

`CovenantStatus` ordinals are consensus-relevant: the contract emits the numeric value and
the TypeScript decoder reads it.

The Phase 0 form of this ADR overstated what was cross-pinned. Each side asserted its own
literals against itself: `test/CovenantStatus.t.sol` compared the Solidity enum to constants
in the same file, and `covenant-status.test.ts` asserted the TypeScript object was contiguous.
Only the Postgres-to-TypeScript pairing had a shared oracle. The consensus-relevant pairing,
Solidity to TypeScript, rested on two people typing the same eight names in the same order.

`@resurv/repo-policy` now reads `packages/contracts/src/CovenantStatus.sol` and compares the
declared enum members and their ordinals against `@resurv/domain`, and compares the two
hand-transcribed reference models character for character. A reordering in either language now
fails a test that reads both files.

---

## ADR-008: The Claude Code permission boundary is executable policy, not a document

Date: 2026-08-11. Status: accepted. Phase: 0 remediation.

### Context

`.claude/settings.json` put deploys, secret mutation and signing behind `ask`, and the Phase 0
log presented that as a control. The independent review showed the tier was reachable anyway:
`Bash(pnpm --filter:*)`, `Bash(pnpm run:*)` and `Bash(pnpm exec:*)` were prefix rules over
command runners, so `pnpm --filter @resurv/worker deploy` ran `wrangler deploy` with no prompt,
using the command form `docs/DEPLOYMENTS.md` itself recommends. `Bash(turbo run:*)` was the
same defect and had not been noticed.

### Decision

Three changes, in order of how much they carry.

1. No allow rule may combine a command runner with a wildcard. Runner invocations are exact
   matches naming one reviewed script (`Bash(pnpm --filter contracts test)`), and the runners
   themselves sit in `ask`.
2. Deny rules match the dangerous inner command wherever it appears, since Bash patterns take
   a wildcard at any position. `Bash(*wrangler deploy*)` catches the wrapped forms the allow
   list can no longer reach.
3. `packages/repo-policy` asserts all of it. The proven bypasses are test cases; every
   workspace script is enumerated and any script with an external effect must not be
   auto-approved under any wrapper; every `pnpm --filter` allow rule must name a script that
   exists.

### What this is not

Not a sandbox. Claude Code's own documentation says permission rules apply to its built-in
tools and to file commands it recognizes in Bash, and not to arbitrary subprocesses. A script
started by an allowed root command is invisible to the engine, which is why the policy test
also reads the scripts. `docs/THREAT_MODEL.md` T10 and T11 state the residual risk.

### Revisit if

Claude Code's matching semantics change, or a phase needs a command the exact-match list
cannot express without a wildcard over a runner.

---

## ADR-009: Property tests are judged against an independent reference model

Date: 2026-08-11. Status: accepted. Phase: 0 remediation.

### Context

The Phase 0 invariant handler opened with
`if (!CovenantStatusLib.canTransition(status, to)) return;`. The implementation under test was
also the gatekeeper deciding which inputs the fuzzer was allowed to try, so the suite could
only prove the library agreed with itself. The reviewer demonstrated three defects that left
all three invariants green, including an `isTerminal` that returned false for every state,
while `pnpm --filter contracts test:invariant` exited 0.

### Decision

Every property test compares the implementation to a reference model that is transcribed from
the PRD, structurally different from production, and never calls production code. The model is
a flat character table in both languages; production is a branch chain in Solidity and a record
of name arrays in TypeScript. Handlers attempt the full pair space unconditionally and record
what the implementation allowed, rather than filtering inputs through it first.

Reported coverage is behavioral: applied transitions, rejected attempts, distinct pairs
attempted and applied, distinct states visited. A handler call that cannot mutate anything is
not depth, and the Phase 0 "16,384 calls" figure was mostly guaranteed early returns.

### Consequences

Two models now have to be kept in step, which is the cost. The cross-language test in
`@resurv/repo-policy` makes drift between them a failing test, and a model that drifts from the
implementation fails the equivalence test in its own language.

### Revisit if

The covenant contract lands and the state machine gains real preconditions. The model then has
to describe those preconditions too, or it stops being an oracle for anything but the graph.

---

## ADR-010: Only `deny` is a control; `ask` is documentation of intent

Date: 2026-08-12. Status: accepted. Phase: pre-seam hardening.

### Context

The Phase 0 remediation put interpreters, package installs, deploy tooling and signing behind
`ask`, and both the remediation log and the independent review reasoned about `ask` as "the
user is prompted". Two probes in a live session on 2026-08-12 disagreed. `jq --version` and
`sed -n 1p package.json` both executed with no prompt under `Bash(jq *)` and `Bash(sed *)`,
while `ls -d ~/.npmrc` under a new deny rule was blocked outright.

The permission mode a session starts in is resolved by the client. The VS Code extension picks
it, and `defaultMode` in `.claude/settings.json` does not decide it. So the project cannot
assert which tier prompts, and it should stop pretending it can.

### Decision

Anything the project relies on goes in `deny`. `ask` stays where it is, for the value it has
under a mode that honors it and as a record of what we consider risky, and nothing is
described as controlled because it is in `ask`.

Concretely: every host credential store, every declared secret variable name, and every
environment-dump form is a deny rule.
`packages/repo-policy/test/credential-surfaces.test.ts` asserts `decide(...) === 'deny'` rather
than `not.toBe('allow')`, and a separate assertion fails if any of those surfaces resolves to
`ask`.

### Alternatives rejected

Setting `permissions.disableAutoMode: "disable"` would force `ask` to mean ask. Rejected: the
session order in `docs/BUILD_STATE.md` includes a long autonomous run, and disabling the mode
that run depends on to rescue a weaker tier trades a real capability for a control we can get
by writing `deny` instead.

Moving the interpreters (`sed`, `jq`, `awk`, `rg`, `node -e`) to `deny`. Rejected: they are
ordinary tools, and the thing they could reach is already denied by path. The cost is daily and
the benefit is covered.

### Revisit if

A future Claude Code release makes the effective mode readable from the session, or the
operator standardizes on a mode where `ask` prompts.

---

## ADR-011: A Bash permission pattern may not contain `$`

Date: 2026-08-12. Status: accepted. Phase: pre-seam hardening.

### Context

`Bash(*~/.*)` blocked `ls -d ~/.zshrc`. The sibling rule `Bash(*$HOME/.*)`, written in the same
commit and intended to cover the other spelling, did not block `ls -d $HOME/.zshrc`.
`Bash(*echo $*)` did not block `echo $HOME`. Measured, not inferred. The shape is consistent
with the pattern being compiled to a regular expression without escaping `$`, which then
anchors at end-of-input, but the cause does not matter to us. The effect does: such a rule
looks like a control in the file and blocks nothing.

Nothing in the vendor's permissions reference mentions this.

### Decision

No Bash pattern in `.claude/settings.json` contains `$`. Where a rule needs to stop a shell
variable expansion, it names the variable instead: `Bash(*KEEPERHUB_API_KEY*)` rather than
`Bash(*echo $KEEPERHUB_API_KEY*)`, backed by the generic `Bash(*API_KEY*)`, `Bash(*SECRET*)`,
`Bash(*_TOKEN*)` and their siblings. Where a rule needs to stop a home path, it names the part
that survives every spelling: `.npmrc`, `.wrangler`, `HOME/.`, `/Users/*/.`.

`patternIsInert` in `packages/repo-policy/src/bash-rules.ts` models the behavior, `decide`
ignores an inert pattern the way the engine does, and a test fails if any committed rule
carries one.

### Consequences

`grep -rn API_KEY packages/` is no longer available from Bash. The Grep tool is unaffected,
because file-tool rules and Bash rules are separate surfaces.

### Revisit if

A vendor release fixes the escaping. The inert-pattern test would then be over-strict, and the
right change is to delete it and the model together, not to weaken one of them.

---

## ADR-012: CI is split by toolchain need, with one aggregate gate

Date: 2026-08-12. Status: accepted. Phase: pre-seam hardening.

### Context

The Phase 0 `javascript` job ran `pnpm typecheck` and `pnpm build` while installing no Foundry
toolchain and checking out no submodules. Both commands are cross-stack: turbo fans `typecheck`
out to `contracts#typecheck` (`forge build --sizes`), `build` to `contracts#build`, `test` to
`contracts#test` and `lint` to `contracts#lint`. The job could not have passed on a clean
runner. Nobody had seen it fail because this repository has no git remote and no CI run has
ever happened. The job also worked around its own gap by running `pnpm exec biome check .`
instead of `pnpm lint`, which is the same command minus the contracts half.

### Decision

`pnpm typecheck`, `pnpm test`, `pnpm lint` and `pnpm build` stay cross-stack. They are the
commands `CLAUDE.md` declares required and the ones a developer runs, and splitting them so CI
can avoid a toolchain would make CI test something other than the gate.

So the job that runs them installs the whole toolchain, and the workflow is organized by what
each job needs:

| Job | Installs | Runs |
|---|---|---|
| `workspace` | pnpm, Node, Foundry, submodules | `format:check`, `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build` |
| `contracts` | Foundry, submodules | `forge fmt --check`, `forge build --sizes`, `forge test`, the invariant run |
| `policy` | pnpm, Node, full git history | `@resurv/repo-policy` |
| `gate` | nothing | fails unless the other three succeeded |

`gate` is the job to require on a branch protection rule, and it runs `if: always()` so a
failed dependency is reported rather than skipped.

`packages/repo-policy/test/ci-workflow.test.ts` derives "needs Foundry" from the same script
graph the permission policy walks, so adding `forge` to a script CI runs fails the suite until
the job installs the toolchain. It also asserts that `policy` installs no Foundry, which keeps
the split from decaying into "install everything everywhere".

### Consequences

`forge build` runs in two jobs. That costs a minute of runner time and buys attribution: a
Solidity failure surfaces in `contracts` rather than inside a turbo task in `workspace`.

### Revisit if

A remote is added and the duplicated compile becomes the slowest part of the pipeline, or a
job gains a command whose toolchain the script graph cannot see.

---

## ADR-013: A covenant advances on chain evidence, never on an HTTP status

Date: 2026-08-12. Status: accepted. Phase: 0.5.

### Context

The attempt lifecycle this project was going to implement had `ACCEPTED` entered by "a 2xx
carrying an `executionId`", a `PENDING` state polled through, and `REVERTED` reached from
`ACCEPTED`. The Phase 0.5 seam probe measured KeeperHub live and falsified three of those.

`POST /api/execute/contract-call` is synchronous, and HTTP 202 is not acceptance. The successful
call and the refused call both answered 202 with an `executionId`; the refused one carried
`status: "failed"`, a null transaction hash, an empty `receipts` array, and produced no onchain
effect at all. So the entry condition for `ACCEPTED` was satisfied by an attempt that never
reached the chain. There is no `PENDING` phase to poll, because the POST does not return until
the execution is terminal. And `ACCEPTED -> REVERTED` was unreachable in this environment:
KeeperHub refuses to broadcast a call whose gas estimation reverts, deterministically, three
times out of three.

Separately, a new idempotency key for the same economic action executed it a second time.
KeeperHub bounds economic effects per *key*, not per action.

Full measurements and evidence: `docs/phase-logs/PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md`.

### Decision

Three rules, in order of how much they carry.

1. **A covenant advances on chain evidence, never on an HTTP status.** `CONFIRMED` requires a
   receipt with status `0x1` from two independent origins *and* the expected event in its logs
   *and* no inner-failure signal. A receipt alone is not enough, because `safe_inner_failure` is
   a documented status in which the outer transaction succeeds and the inner call does not.
2. **Ambiguity is a state, not an error.** `RECONCILIATION_REQUIRED` is entered by anything that
   is not a chain-confirmed terminal outcome, including every HTTP 202, and it is left only by a
   chain read or by proof that no effect exists. Nothing promotes an attempt out of it on
   elapsed time, because a timeout is not evidence.
3. **Semantic idempotency is onchain and permanent.** The transport key is a 24-hour convenience
   that bounds effects per key. The covenant rejects a replayed semantic attempt id forever.

The full state table, transitions and reconciliation algorithm are section 8 of the phase log,
and the advancement rule is section 9. They are the specification Phase 1 implements.

### Alternatives rejected

Treating HTTP 202 as acceptance and reconciling afterwards. Rejected on the measurement: the
common outcome for a refused action is a 202, so this would classify most refusals as executed
attempts and stall every covenant behind a reconciliation that had nothing to reconcile.

Polling `GET /api/execute/{id}/status` as the primary path. Rejected: the POST is synchronous, so
the first poll already returns a terminal status with `X-Poll-Interval-Hint: 0`. Polling stays in
the reconciliation loop, where it is genuinely needed, and is not on the happy path.

Relying on KeeperHub's idempotency for exactly-once. Rejected on the measurement, and
`docs/CLAIMS.md` already forbids the wording.

### Consequences

`packages/domain` gains a second state machine, for attempts, alongside the covenant one, and it
needs the same reference-model treatment ADR-009 requires. `packages/db`'s
`keeperhub_executions` schema already supports it: the idempotency key hash is `NOT NULL` and
unique while the execution id and transaction hash are nullable, which is exactly the shape
`KEY_COMMITTED` needs.

The orchestrator's happy path gets shorter and its recovery path gets longer, which is the right
trade for a system whose failure mode is paying twice.

### Revisit if

The organization wallet is funded and a would-revert call reaches the chain, which would make
`REVERTED` reachable from a broadcast rather than only in principle. The lifecycle already
carries that state; what would change is how often it is entered.

---

## ADR-014: Contracts are deployed by a CREATE2 factory through a sponsored KeeperHub call

Date: 2026-08-12. Status: accepted. Phase: 1.

### Context

RESURV has no funded deployer. The KeeperHub organization wallet holds zero native currency and
gets its gas sponsored, and sponsorship pays a transaction fee rather than giving the wallet a
balance. `forge script --broadcast` needs a funded key and a faucet trip, both of which are
human steps this build cannot perform. KeeperHub's Direct Execution API has endpoints for a
transfer, a contract call and a check-and-execute, and none for a deployment.

### Decision

Deploy through **CreateX** at `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed`, which is already
deployed on Base Sepolia and whose `deployCreate2(bytes32 salt, bytes initCode)` is an ordinary
ABI function. A KeeperHub contract call to that function is a contract call like any other, so
it is sponsored like any other, and RESURV deploys its own contracts with no funding at all.

Verified before adopting it: `cast code` returns 23 KB of runtime at that address on chain
84532, and `cast selectors` finds `0x26307668`, which is `deployCreate2(bytes32,bytes)`.

### Consequences, and one of them shaped every constructor

`msg.sender` inside a constructor is the factory, not the operator. Every contract in this
repository therefore takes its admin, pauser and executor as explicit constructor arguments,
and none of them reads `msg.sender`. A contract that granted `DEFAULT_ADMIN_ROLE` to
`msg.sender` here would have handed a public factory the keys to the escrow.

The deployed address is read from the receipt's logs rather than from a return value, because a
KeeperHub write response carries neither return data nor, in the 202 body, a transaction hash.

Explorer verification uses Sourcify, which needs no API key. Basescan's v2 API does, and that
key is a user-owned credential this build does not have.

### Alternatives rejected

The canonical deterministic-deployment proxy at `0x4e59b448…` is also present on Base Sepolia
and is cheaper, but it takes raw calldata with no ABI. KeeperHub's `/contract-call` builds
calldata from a function name and an ABI, so there is no way to express a bare `salt ++ initCode`
payload through it.

Asking for a funded deployer key. Rejected as the *first* option rather than as an option: it
is the fallback if this path fails, and it is a `USER ACTION REQUIRED` that costs a round trip
and a faucet.

### Revisit if

KeeperHub adds a deployment endpoint, or a funded deployer becomes available and reproducibility
would be better served by a plain `forge script`.

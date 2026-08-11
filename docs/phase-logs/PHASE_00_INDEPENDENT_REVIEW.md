# Phase 0 independent validation

Date: 2026-08-11. Reviewer: fresh session, no participation in the Phase 0 build.
Verdict: **FAIL**.

Nothing in the repository was changed by this review. Two artifacts created during probing
were removed and `git status` was confirmed empty at the end
(`packages/contracts/lib/openzeppelin-contracts/.claude`, created by a shell invocation inside
the submodule, and a temporary `.probe-tmp/` directory). All destructive experiments ran
against copies under the session scratchpad and a fresh clone.

## Method

Everything below was re-executed, not read off the phase log.

| What | How |
|---|---|
| Gate | `pnpm gate` (exit 0), then `TURBO_FORCE=true pnpm gate` (exit 0, 0 cached), then the same in a fresh clone |
| Fresh clone | `git clone --recurse-submodules` into a scratch dir, `pnpm install --frozen-lockfile`, `pnpm gate`, `pnpm test:integration`, `pnpm test:e2e` |
| Invariants | 4 source mutations against a scratch copy of `packages/contracts`, plus 2 against the TypeScript mirror |
| Redaction and health | 6 runtime probes against `@resurv/config` and the Worker `fetch` handler |
| Ignore rules | `git check-ignore` on 14 paths; the CI regex evaluated against the same 14 |
| Lint and type gates | 3 deliberate defects injected to confirm the gates actually fail |
| TypeScript 7 | full workspace typecheck and test run under a `typescript: 6.0.3` workspace override |
| Subagents | `test-reviewer`, `keeperhub-integrator`, `claim-auditor`, each run independently; every claim they made that appears below was reproduced by this session before being recorded |

A note on the first gate run, because it matters for anyone repeating this. `pnpm gate` on a
warm machine returns `FULL TURBO`, 9 of 9 tasks cached, replaying the previous session's logs
rather than executing. The Phase 0 report's `exit 0` may itself have been a cache replay. The
results below come from the forced run and the fresh clone, both of which show `Cached: 0`.

## The untrusted hints

`docs/prompts/PHASE_00_VALIDATION.md` appends five author-flagged weak points. Four are
confirmed and one is confirmed and materially worse than stated.

| Hint | Independent result |
|---|---|
| Zero-spec integration and E2E suites | Confirmed. Honestly documented in three places. |
| Proof-ladder rungs 2 and 3 PARTIAL | Confirmed and correctly rated. |
| Six KeeperHub claims are `MEASURED_EXTERNAL` | Confirmed. There are eight such rows, and none carries a pointer into the source repository. |
| Deny list is pattern-matched, not a sandbox | Confirmed, and understated. See F6. |
| The invariant handler may prove only that it agrees with itself | Confirmed, and worse than stated. It also fails to detect two illegal transitions and a completely broken `isTerminal`. See F4. |

Problems the author did not flag are in F1, F5, F6, F7 and F8.

---

## Item-by-item results

### 1. Do the required commands fail, skip work, or pass vacuously? **FAIL** (severity: MEDIUM)

Commands executed: `pnpm gate`, `TURBO_FORCE=true pnpm gate`, `pnpm test:integration`,
`pnpm test:e2e`, `pnpm --filter contracts test`, `pnpm --filter contracts test:invariant`, and
three injected-defect runs.

What holds. All nine commands CLAUDE.md declares required exist and exit 0. Counts reproduce
exactly: 73 TypeScript tests (17 domain, 30 keeperhub-client, 7 config, 7 db, 7 chain, 5
worker, 0 web) and 12 Foundry tests (9 unit and fuzz, 3 invariant), 85 total. The lint and type
gates are real, not decorative: a plain unused variable trips
`lint/correctness/noUnusedVariables`, an `any` trips `lint/suspicious/noExplicitAny`, a bad
assignment trips `error TS2322`, and a misformatted Solidity contract trips `forge fmt --check`
with exit 1. Each was injected and observed.

F1-A. `pnpm gate` does not run two of the nine required commands.
`package.json:21` chains `format:check`, `lint`, `typecheck`, `test`, contracts `test`,
contracts `test:invariant`, `build`. `test:integration` and `test:e2e` are absent.
`docs/BUILD_STATE.md:107` states "`pnpm gate` runs the whole sequence and exits 0" and
`docs/RUNBOOKS.md:17` states "`pnpm gate` runs the full sequence". Both are false as written.
Harmless today because both suites are empty. It stops being harmless the moment the first real
spec lands, because the canonical one-command gate will not run it.

F1-B. The zero-spec suites are emptier than "zero specs" suggests. `test:integration` is
defined only by `@resurv/worker` and points at `test/integration`, which does not exist.
`test:e2e` is defined only by `@resurv/web` and points at `test/e2e`; `apps/web/test` does not
exist at all. `@resurv/web`'s ordinary `test` script also carries `--passWithNoTests`, so one
of the eight packages in `pnpm test` can never fail.

F1-C. The task count in the evidence trail is wrong. `docs/phase-logs/PHASE_00.md:88`,
`docs/VERSIONS.md:54` and `docs/DECISIONS.md:87` all state that `pnpm typecheck` runs 14 tasks.
Forced re-execution reports `Packages in scope: 8`, `Running typecheck in 8 packages`,
`Tasks: 9 successful, 9 total`. The figure is not reproducible.

Must be fixed before the seam probe: no.

### 2. Are any claims rated above their evidence? **FAIL** (severity: HIGH)

F2-A. "Covenant status ordinals agree across Solidity, TypeScript and Postgres" is rated
`VERIFIED` at `docs/CLAIMS.md:43`, and `docs/ARCHITECTURE.md:57` says "Three suites fail if
anyone tries." Only one of the three pairings is actually cross-checked.
`packages/db/test/schema.test.ts:12` compares `onchainStatusEnum.enumValues` against
`allCovenantStatusNames()`, which is a genuine shared oracle. `test_ordinalsAreStable`
(`packages/contracts/test/CovenantStatus.t.sol:14`) asserts the Solidity enum against literals
hardcoded in the same file. `covenant-status.test.ts:21` asserts the TypeScript object is
contiguous, against itself. Nothing anywhere compares the Solidity enum to the TypeScript one.
The Solidity-to-TypeScript link, which is the consensus-relevant one because the contract emits
the ordinal and TypeScript decodes it, rests on two people typing the same eight names in the
same order. Correct level: `VERIFIED` for Postgres to TypeScript, `ASSUMED` for Solidity to
TypeScript.

F2-B. "A terminal covenant state is absorbing | VERIFIED (model only)" at `docs/CLAIMS.md:42`
cites `invariant_terminalStateIsAbsorbing` and a call count. The cited evidence does not
support the claim. Proof in F4-C: with `isTerminal` rewritten to never return true, the entire
invariant suite still passes 3 of 3. The `(model only)` qualifier is honest about scope and
says nothing about whether the invariant can detect a defect.

F2-C. Eight `MEASURED_EXTERNAL` rows (`docs/CLAIMS.md:27-35`) cite live measurements from
`keeperhub-flightcheck` with specific detail (a hex sender prefix, a byte-identical
`gasUsedWei`) and no commit, run id, or artifact path. A repo-wide grep finds only narrative
mentions of that project. The vocabulary table at `docs/CLAIMS.md:12` is honest that these are
"not yet ours", but as cited these rows cannot be checked by anyone reading this repository.

F2-D. Several behaviors are asserted as fact in code and prose with no ledger row at any
level. Confirmed by grep against `docs/CLAIMS.md`: no row exists for the 401 or 404 error
envelope shapes, `request_id`, any `receiptStatus` literal, `X-Poll-Interval-Hint` semantics,
the 60/minute rate limit, `Retry-After`, or the `idempotency_conflict` and
`idempotency_in_progress` 409 codes. `docs/RUNBOOKS.md:56-65` presents all of them as settled
diagnosis. `docs/CLAIMS.md:3` requires that nothing be stated above its status; these have no
status.

F2-E. `docs/THREAT_MODEL.md:98-100` rates T8 `IN PLACE` on the strength of two pinned RPC
constants and a naming rule, while T9, which depends on the same two constants, is correctly
`PARTIAL` because the quorum client does not exist. No code in the repository fetches a
receipt from either endpoint. The `packages/chain` test that supposedly establishes "hosts we
do not control" checks that each URL starts with `https://` and does not contain the string
`resurv` (`packages/chain/test/chains.test.ts:39-44`).

F2-F. `docs/phase-logs/PHASE_00.md:184` marks the exit-gate row "KeeperHub source snapshot and
seam checklist" as PASS. `RESURV_PRD_v1.0.md:2429` names that deliverable verbatim. No snapshot
and no checklist file exists anywhere in the repository; a substitute artifact was graded as
the named one. This is a deliverable rather than one of the PRD's four exit-gate criteria, so
it does not by itself sink the gate, but a self-graded PASS on an artifact that does not exist
is the exact failure mode the claim ledger is meant to prevent.

Clean result worth recording: the forbidden-wording prohibitions hold. Every occurrence of
trustless, MEV, private mempool, atomic rollback, production ready and exactly-once in the
repository is a negative usage stating that the wording is forbidden or refuted.

Must be fixed before the seam probe: no, but F2-B and F2-D must be fixed before any submission
text reuses them.

### 3. Does the KeeperHub client encode unmeasured behavior? **FAIL** (severity: MEDIUM)

F3-A. `packages/keeperhub-client/src/status.ts:4` states "Every rule in this file exists
because a live probe contradicted the documentation. See docs/CLAIMS.md and the Phase 2 seam
record." Three problems. No KeeperHub call has been made from this repository. There is no
Phase 2 seam record; Phase 2 has not happened. And the statement is false for at least one
rule: `status.ts:15` describes `unconfirmed` as "Observed live", while `docs/CLAIMS.md:32`
rates it `DOCUMENTED (conflicting)` with the evidence being two official documents disagreeing
with each other. `docs/ARCHITECTURE.md:65` repeats the same sentence.

F3-B. `classifyReceiptStatus` (`status.ts:67-80`) maps `reverted` and `safe_inner_failure` to a
terminal `REVERTED` verdict. `docs/CLAIMS.md:36` marks the underlying claim, that a reverted
broadcast is distinguishable from a transport failure, `ASSUMED` and explicitly unmeasured, and
`docs/BUILD_STATE.md:117` calls it the assumption that will bite first. The string
`safe_inner_failure` appears nowhere in `docs/`; grep returns zero hits outside the source file.
The `UNKNOWN` default keeps this conservative rather than dangerous, but the code presents a
closed union of receipt statuses and a confident revert verdict for a seam nobody has probed.
Phase 0.5 should treat `classifyReceiptStatus` as the hypothesis under test, not as ground
truth to validate against.

F3-C. The package is imported by nothing else in the monorepo, and all of `constants.ts` is
untested. `errors.ts:62` and `errors.ts:69` hardcode `'wfb_'` and `'kh_'` rather than importing
`WEBHOOK_KEY_PREFIX` and `ORG_API_KEY_PREFIX`, so even the one path that would exercise those
constants transitively does not.

F3-D. The error-envelope tests (`test/status.test.ts:114-137`) assert against fixtures
hand-written to match the docstring in the file under test. They confirm the code agrees with
its own comment.

Must be fixed before the seam probe: no. The seam probe is what settles F3-B, and the probe
should record its answer rather than assume the current mapping.

### 4. Can the Foundry invariants falsely pass? **FAIL** (severity: HIGH)

This was the sharpest question and the answer is yes, demonstrably.

The mechanism. `CovenantStatusHandler.attempt`
(`packages/contracts/test/invariant/CovenantStatusInvariant.t.sol:17-19`) opens with
`if (!CovenantStatusLib.canTransition(status, to)) return;`. Every fuzzer-chosen target that
the library does not already bless is discarded before any mutation. The handler can therefore
only replay whatever graph `canTransition` currently defines as legal. It cannot construct an
invalid, adversarial, or boundary transition, because the thing under test is also the
gatekeeper. The invariants can detect an internal contradiction inside
`canTransition`/`isTerminal`, and nothing else.

Mutations run by this session against a scratch copy. Baseline restored and re-verified at 12
of 12 after each.

| Mutation | Result |
|---|---|
| `DRAFT -> EXECUTING` permitted (skips ARMED and TRIGGERED entirely) | **12 of 12 tests pass.** Nothing detects it. |
| `EXECUTING -> ARMED` permitted (rewinds a covenant with an attempt in flight) | **12 of 12 tests pass.** Nothing detects it. |
| `ARMED -> SATISFIED` permitted (settles without ever triggering) | Caught, by the unit test `test_cannotSkipTheTrigger`. All 3 invariants still pass. |
| `isTerminal` rewritten to never return true | **All 3 invariants pass, 16,384 calls, 0 failures.** Caught only by the unit tests `test_terminalStatesAreExactlyThree` and `testFuzz_terminalStatesAreAbsorbing`. |

The fourth row is the important one. `pnpm --filter contracts test:invariant` is a CLAUDE.md
required check and is the sole evidence cited for `docs/CLAIMS.md:42`. It exits 0 with a
completely broken definition of what "terminal" means.

F4-A. `invariant_terminalFlagAgreesWithStatus` is a tautology. `everTerminal` is set inside
`attempt`, immediately after `status = to`, using the same `isTerminal` call the invariant then
checks against. It is true by straight-line construction for any implementation of
`isTerminal`, correct or not, which the mutation above confirms empirically.

F4-B. `invariant_neverReturnsToNone` can fail, but is strictly redundant with
`testFuzz_nothingReturnsToNone`, which covers the same 8-value domain directly at 512 runs.

F4-C. `invariant_terminalStateIsAbsorbing` can fail on a `canTransition` mutation, and is
redundant with `testFuzz_terminalStatesAreAbsorbing` over the same exhaustively enumerable
64-pair domain. It is blind to `isTerminal`.

F4-D. The call count is not evidence. The longest legal chain is five mutating edges
(`NONE -> DRAFT -> ARMED -> TRIGGERED -> EXECUTING -> SATISFIED`), so at depth 64 at most 5 of
64 calls per run can mutate anything and every call after absorption is a guaranteed early
return. `0 reverts` is structurally guaranteed: `attempt` contains no revert-capable path, the
guard is an early `return`, and the local `bound` uses modulo. Citing "16,384 handler calls, 0
reverts" as strength of evidence, in `docs/CLAIMS.md:42`, `docs/ARCHITECTURE.md:60-62`,
`docs/BUILD_STATE.md:102` and `docs/phase-logs/PHASE_00.md:98`, overstates what ran.

F4-E. The same blind spots exist in the TypeScript mirror, tested independently in the fresh
clone. Adding `EXECUTING` to `TRANSITIONS.DRAFT`: 17 of 17 pass. Adding `ARMED` to
`TRANSITIONS.EXECUTING`: 17 of 17 pass.

F4-F. Neither language pins the full 8x8 transition table, and nothing compares the Solidity
`canTransition` to the TypeScript `canTransition`. The two implementations of the same state
machine can drift apart silently, which compounds F2-A.

F4-G. `fail_on_revert = false` (`foundry.toml:36`) hides nothing today because the handler
cannot revert. It will silently swallow every `require` the moment a handler wraps a real
stateful contract, which is exactly what Phase 1 needs.

What a real handler looks like: keep an independent ground-truth adjacency table transcribed
from PRD 9.1, call `attempt` unconditionally without gating on `canTransition`, use the library
only to record what it allowed, and assert library agreement against the ground truth for every
attempted pair. That structure catches `canTransition` bugs, `isTerminal` bugs, and illegal
skips. The current one catches none of the three cases above.

Must be fixed before the seam probe: no. Must be fixed before any covenant contract is written
in Phase 1, and before `docs/CLAIMS.md:42` is relied on for anything public.

### 5. Are ADR-001 and ADR-004 genuine or post-hoc? **PASS**

ADR-001 is genuine. The constraint is external and hard: the operating instruction requires
Cloudflare and forbids Railway, and Fastify assumes a Node HTTP server while Redis and BullMQ
need TCP that workerd does not offer. The ADR keeps the PRD's service responsibilities and
replaces implementations, names the mapping component by component, and records that the PRD's
stack section is now partially superseded rather than quietly ignoring it. Verified against the
tree: no Fastify, Redis, BullMQ, Docker Compose or Railway config exists, and Queues and Durable
Objects are named but deliberately not provisioned.

ADR-004 is genuine and unusually specific. The argument is that `/api/execute/contract-call`
returns 202 synchronously with no transaction hash, there is no list-executions endpoint, and
the documented recovery is an idempotency replay with a byte-identical body, so the key and
canonical body must be durable before the first POST. That is a real necessity argument rather
than "applications have databases." It is reinforced by the schema:
`keeperhub_executions.idempotency_key_hash` is `NOT NULL` while `execution_id` and
`transaction_hash` are nullable, and `packages/db/test/schema.test.ts:21-31` asserts exactly
that asymmetry. Rejecting Cloudflare D1 and recording the reason, including that the constraint
and the deadline disagree, is the opposite of rationalization.

One caveat. The load-bearing premise "there is no list-executions endpoint" has no
`docs/CLAIMS.md` row and no cited documentation. It is consistent with
`packages/keeperhub-client/src/constants.ts:3-11`, but that file is our own. If the premise is
wrong the whole ADR weakens, so it deserves a ledger row at `DOCUMENTED`.

### 6. Are the ignore rules, permissions, CI checks and redaction weaker than documented? **FAIL** (severity: HIGH)

F6-A. The Claude Code permission model does not do what `docs/THREAT_MODEL.md:76-77` implies,
and the gap is larger than the "speed bump" caveat at line 80. The deny list blocks
`Read(./.env)` and friends. The allow list, which auto-approves without a prompt, contains
`Bash(node -e:*)`, `Bash(grep:*)`, `Bash(rg:*)`, `Bash(find:*)` and `Bash(jq:*)`, every one of
which can read and print an arbitrary file. The `Read` deny rule creates an appearance of
protection that the `Bash` allow list removes.

Worse, the allow list contains `Bash(pnpm --filter:*)`, `Bash(pnpm run:*)` and
`Bash(pnpm exec:*)`. These are prefix matches, so they auto-approve any script in any
workspace package. `apps/worker/package.json` defines `"deploy": "wrangler deploy"`. So
`pnpm --filter @resurv/worker deploy` is auto-approved and deploys, while
`Bash(wrangler deploy:*)` sits in `ask`. The same bypass reaches `wrangler secret`,
`cast send`, `forge script` and `forge create` through `pnpm exec`. The `ask` tier for
everything touching money, secrets and deploys, which `docs/phase-logs/PHASE_00.md:40-41`
presents as a deliberate control, is bypassable by a command form the repository itself
documents in `docs/DEPLOYMENTS.md:23`.

This is the one finding that bears directly on Phase 0.5, because Phase 0.5 is the step that
puts a live `kh_` organization key into `.env`.

F6-B. `redactEnv` is shallow and the documentation overstates it. `packages/config/src/index.ts:77-83`
iterates one level of `Object.entries` and matches exact declared key names. Probed directly:

```
redactEnv({ inner: { KEEPERHUB_API_KEY: 'kh_LEAK_1' } })  ->  {"inner":{"KEEPERHUB_API_KEY":"kh_LEAK_1"}}
redactEnv({ list: ['kh_LEAK_3'] })                        ->  {"list":["kh_LEAK_3"]}
```

`docs/THREAT_MODEL.md:75` says "a test asserts no secret substring survives serialization."
The test (`packages/config/test/env.test.ts:57-60`) asserts that only for a declared key at the
top level. The general statement is not true of the function.

F6-C. The CI secret job is narrower than its description. `.github/workflows/ci.yml:79` uses
`(^|/)\.env($|\.)|\.(pem|key|p12|pfx|keystore)$`. Evaluated against the same paths
`.gitignore` protects:

| Path | `.gitignore` | CI regex |
|---|---|---|
| `.env`, `.env.local`, `supabase/.env` | IGNORED | CAUGHT |
| `foo.pem`, `foo.key`, `foo.p12`, `foo.pfx`, `foo.keystore` | IGNORED | CAUGHT |
| `.dev.vars` | IGNORED | **MISSED** |
| `secrets/x.json` | IGNORED | **MISSED** |
| `keystores/k.json` | IGNORED | **MISSED** |
| `deployer.json` | IGNORED | **MISSED** |
| `account.json` | IGNORED | **MISSED** |

`docs/THREAT_MODEL.md:72-75` describes the gitignore coverage and then says "CI has a job that
fails if any such file is ever tracked." It does not, for five of the categories listed in the
same sentence.

F6-D. The two controls disagree on one case. `.gitignore:6` un-ignores `.env.*.example`, so
`.env.staging.example` may be committed, and the CI regex would fail the build on it (the
exclusion is `\.env\.example$` only).

What holds, verified independently. `.gitignore` itself is strong: all 12 secret-bearing paths
tested return IGNORED via `git check-ignore`, and `.env.example` correctly does not.
`/api/health` does not leak values, probed with five malformed environments including a
`wfb_SECRETVALUE` key, an invalid enum, an invalid URL, a wrong-typed value and an undeclared
extra key. Zod's messages name the variable and never echo the value, and unknown keys are
stripped rather than reflected. `docs/THREAT_MODEL.md`'s claim on the health endpoint is
accurate.

Must be fixed before the seam probe: **F6-A yes.** F6-B is recommended before the probe,
because the probe will be the first code to log real KeeperHub responses. F6-C and F6-D are
documentation and CI fixes that can follow.

### 7. Fresh-clone reproduction **PASS**

Commands executed, in a scratch directory with no relationship to the source checkout:

```
git clone --recurse-submodules /Users/mac/resurv <scratch>/resurv     exit 0
pnpm install --frozen-lockfile                                        exit 0
pnpm gate                                                             exit 0   Cached: 0
pnpm test:integration                                                 exit 0
pnpm test:e2e                                                         exit 0
```

Submodules resolve to the recorded commits (`forge-std` at `bf647bd`, tagged v1.16.2;
`openzeppelin-contracts` at `5fd1781`, tagged v5.6.1, `package.json` version 5.6.1, which
confirms the VERSIONS.md pin). Test counts in the clone match the source exactly. No untracked
or ignored state from the source checkout is required: everything ignored in the source
(`node_modules`, `dist`, `.turbo`, `packages/contracts/out`, `packages/contracts/cache`) is
regenerated.

Two caveats worth recording rather than hiding.

F7-A. `docs/VERSIONS.md:45` says forge-std is "Installed with `--no-git`, vendored under
`packages/contracts/lib`" and `docs/RUNBOOKS.md:13` repeats "Foundry dependencies are vendored
under `packages/contracts/lib` and need no install step." Both are false. `git ls-files -s`
returns mode `160000` for both entries, and `git ls-files packages/contracts/lib` returns
exactly 2 tracked entries. They are gitlinks. A plain `git clone` without `--recurse-submodules`
produces empty `lib` directories and an unbuildable contracts package. `.gitignore:43-44` and
`.github/workflows/ci.yml:56` both get this right, so the defect is confined to those two docs.
Given that RUNBOOKS is the file a new contributor reads first, this is the reproduction risk
that would actually bite.

F7-B. `pnpm install --frozen-lockfile` resolved 138 packages entirely from the local
content-addressable store, and `forge` found solc 0.8.36 already in the local svm cache. The
lockfile is proven complete and frozen; a genuinely cold-network install is not proven by this
run.

### 8. Is TypeScript 7.0.2 defensible? **PASS**

`pnpm exec tsc --version` confirms 7.0.2 is actually in use, not merely declared.

The concrete evidence that keeping it is defensible is the rollback, which I executed rather
than accepted. In the fresh clone, with `overrides: typescript: 6.0.3` in `pnpm-workspace.yaml`
and nothing else changed:

```
pnpm exec tsc --version                    Version 6.0.3
turbo run typecheck --force                Tasks: 9 successful, 9 total
turbo run test --force                     Tasks: 9 successful, 9 total, all suites green
```

Zero source changes were needed, which is exactly what `docs/DECISIONS.md:91` and
`docs/VERSIONS.md:59-60` predict. That is the answer to the question the item actually asks:
nothing in the workspace depends on TypeScript 7 specific behavior, because the entire thing
compiles and tests clean on 6.0.3. The risk of the new major is bounded by a demonstrated exit
rather than by an assurance, so the pin is defensible on its own terms and no downgrade is
warranted.

One qualification. `tsconfig.base.json:31` sets `skipLibCheck: true`, so dependency declaration
files are not checked.  `docs/VERSIONS.md:53-55` says the workspace typechecks "across React 19,
Hono, Drizzle, viem, Vite 8 and the Workers types". What was verified is RESURV's own source
compiled against those types, not those packages' declarations. Setting `skipLibCheck: false`
produces errors in `@vitest/utils`, `tinybench` and `vite` declarations, but they are missing
DOM globals under the deliberate `lib: ["ES2023"]` setting and would appear identically under
TypeScript 6, so they are a configuration consequence and not a TS7 defect. The wording
overstates; the decision does not.

The "14 tasks" figure in `docs/DECISIONS.md:87` and `docs/VERSIONS.md:54` is wrong, per F1-C.

### 9. Are the zero-spec suites honestly represented? **PASS**

`docs/phase-logs/PHASE_00.md:90-91` marks both as "0 specs, see limitations"; lines 162-164 say
plainly that they pass with `--passWithNoTests`, that the commands existing is what the gate
requires, and "that is not coverage." `docs/BUILD_STATE.md:127-129` repeats it and adds that a
green result must not be mistaken for coverage. This is the standard the rest of the ledger
should have been held to.

Two small gaps. `docs/PROOF_LADDER.md` does not mention them at all, and
`docs/RUNBOOKS.md:25-26` describes them as "Worker integration tests" and "Browser end-to-end
tests" with no note that both are empty, which combined with F1-A means a reader of RUNBOOKS
alone would believe the gate covers them.

### 10. Can a fresh session continue from BUILD_STATE? **PASS**

Verified against the repository rather than read. Phase 0 complete and Phase 1 not started:
correct, no covenant contract exists (`packages/contracts/src` holds only `CovenantStatus.sol`
and two interfaces). Deployed resources none: correct, no `broadcast/`, no deploy script, no
wrangler deployment. `.env` does not exist, so the blocking prerequisite at
`docs/BUILD_STATE.md:29-37` is real and correctly flagged. The session order and the committed
prompts under `docs/prompts/` mean no step depends on conversational memory. Test counts
reproduce exactly. Scope cuts and known defects are recorded rather than omitted.

Defects: `docs/BUILD_STATE.md:107` per F1-A, and lines 102 and 88 repeat the call-count framing
per F4-D. Neither prevents continuation.

---

## Failure summary

| ID | Finding | Severity | Fix before seam probe? |
|---|---|---|---|
| F6-A | Allow-listed `pnpm --filter/run/exec` and `node -e`/`grep`/`rg` bypass the `ask` tier and the `.env` read deny | HIGH | **Yes** |
| F4-A..G | Invariant handler gates on the code under test; 2 illegal transitions and a broken `isTerminal` pass all tests | HIGH | No. Before Phase 1 contracts. |
| F2-A | Solidity-to-TypeScript ordinal agreement rated `VERIFIED`, never cross-tested | HIGH | No |
| F2-B | `CLAIMS.md:42` cites an invariant that cannot detect a broken `isTerminal` | HIGH | No. Before any public wording. |
| F6-B | `redactEnv` is shallow; nested and array secrets survive verbatim | MEDIUM | Recommended |
| F6-C | CI secret job misses `.dev.vars`, `secrets/`, `keystores/`, `deployer.json`, `account.json` | MEDIUM | Recommended |
| F2-D | Six encoded KeeperHub behaviors have no ledger row at any level | MEDIUM | No |
| F2-F | Exit-gate row PASS for a deliverable that does not exist | MEDIUM | No |
| F3-A | "Every rule exists because a live probe contradicted the docs" is false; cites a record that does not exist | MEDIUM | No |
| F3-B | `classifyReceiptStatus` encodes the revert distinction `CLAIMS.md` marks unmeasured | MEDIUM | No. The probe settles it. |
| F7-A | VERSIONS and RUNBOOKS call submodules "vendored, no install step" | MEDIUM | No |
| F1-A | `pnpm gate` omits 2 of the 9 required commands; two docs call it the full sequence | MEDIUM | No |
| F2-C | Eight `MEASURED_EXTERNAL` rows carry no source pointer | LOW | No |
| F2-E | T8 rated `IN PLACE` on the same evidence T9 correctly rates `PARTIAL` | LOW | No |
| F1-B | `test/integration` and `test/e2e` directories do not exist | LOW | No |
| F1-C / F8 | "14 tasks" is 9; `skipLibCheck` qualification | LOW | No |
| F6-D | `.gitignore` permits `.env.*.example`, CI regex fails on it | LOW | No |

## Verdict

The foundation is real. Versions are pinned and resolved from live sources, the fresh clone
reproduces exactly, the lint and type gates bite when tested with injected defects, the ignore
rules are verified rather than asserted, the health endpoint genuinely does not leak, the
forbidden-wording discipline holds throughout, and the TypeScript 7 decision is backed by a
rollback that I executed and that works. ADR-001 and ADR-004 are honest engineering, not
rationalization. The two known-limitation sections are more candid than most shipped projects.

It fails on the thing this project claims as its discipline. The evidence trail is stronger in
its wording than in its substance in specific, demonstrable places: an invariant suite that
exits 0 with a broken definition of "terminal" and misses two illegal transitions, a `VERIFIED`
cross-language claim where two of the three pairings are never compared, six encoded behaviors
with no ledger status at all, and a permission configuration whose `ask` tier is bypassable by
a command form the repository's own deployment doc recommends.

F6-A is the only finding that blocks Phase 0.5, and it blocks it because Phase 0.5 is the step
that first places a live organization key on this machine. Everything else can be corrected in
sequence, but F4 and F2-A/F2-B must be closed before any covenant contract is written, because
Phase 1's exit gate depends on invariants of exactly the kind this review just proved
ineffective.

**PHASE 0 INDEPENDENT VALIDATION: FAIL**

# Phase 0 remediation

Date: 2026-08-11. Answers `docs/phase-logs/PHASE_00_INDEPENDENT_REVIEW.md`, which returned
**FAIL** on the self-graded Phase 0 gate.

No product implementation was started. No KeeperHub call was made, no key was added, nothing
was deployed, no funded transaction was executed. The seam probe has not begun.

## What was actually wrong

The foundation held. The evidence trail did not, in four specific places, and one of them was
load-bearing for the next phase:

- A permission boundary whose `ask` tier was reachable by a command form the repository's own
  deployment doc recommends.
- An invariant suite that exited 0 with a definition of "terminal" that was false for every
  state, cited as the sole evidence for a `VERIFIED` claim.
- A redaction function that stopped at the first level of an object.
- A CI secret check narrower than the sentence describing it.

Everything else in the review is documentation catching up with what the code actually does.

## Finding by finding

Severity and IDs are the reviewer's. `Fix` names what changed, `Evidence` names the command
that shows it, `Regression` names the test that fails if it comes back.

### F6-A — permission bypass through a wrapper. HIGH. Blocked Phase 0.5. **ACCEPTED**

The allow list carried `Bash(pnpm --filter:*)`, `Bash(pnpm run:*)`, `Bash(pnpm exec:*)` and
`Bash(turbo run:*)`, all prefix rules over command runners. `apps/worker` defines
`"deploy": "wrangler deploy"`, so `pnpm --filter @resurv/worker deploy` deployed with no
prompt while `Bash(wrangler deploy:*)` sat in `ask`. The same route reached `wrangler secret`,
`cast send`, `forge script` and `forge create`.

`Bash(turbo run:*)` was the same defect, in the same file, and the review did not catch it.
`turbo run deploy` would have run the worker's deploy script in every package that defined one.

**Fix.** `.claude/settings.json` rebuilt on three rules. No allow rule combines a runner with a
wildcard: runner invocations are exact matches naming one reviewed script, and the runners
themselves moved to `ask`. Deny rules match the dangerous inner command at any position, since
Bash patterns take a wildcard anywhere, so `Bash(*wrangler deploy*)` catches every wrapping.
Ordinary development stays autonomous through about sixty exact-match rules covering lint,
format, typecheck, unit, invariant, integration and E2E runs, builds, local Anvil, both dev
servers and read-only git.

The matching semantics were taken from Claude Code's official permissions reference rather than
guessed, and `packages/repo-policy/src/bash-rules.ts` models them: deny then ask then allow,
wildcards at any position, `:*` as a trailing wildcard only, compound commands split on seven
separators with every subcommand matched independently, and a fixed wrapper set stripped.

**Evidence.** `pnpm --filter @resurv/repo-policy test`, 157 passing.

**Regression.** `test/permission-boundary.test.ts` holds all fourteen proven bypasses as cases,
enumerates every workspace script and fails if one with an external effect is auto-approved
under any wrapper, and fails if a `pnpm --filter` allow rule names a script that no longer
exists. `test/workspace-scripts.test.ts` covers the indirection the permission engine cannot
see: `pnpm build` is auto-approved and turbo then runs scripts the engine never inspects, so
every reachable script is asserted to have no external effect and the one that names
`wrangler deploy` must carry `--dry-run`.

**Residual.** This is configuration, not a sandbox, and `docs/THREAT_MODEL.md` T10 says so. The
enumeration covers the runners and effects we thought of. A new runner inside a script, or a
Makefile, would need a new rule and the policy test would not know to ask for one.

### F6-B — shallow redaction. MEDIUM. **ACCEPTED**

`redactEnv` iterated one level of `Object.entries` and matched exact declared key names, so
`{ inner: { KEEPERHUB_API_KEY: 'kh_LEAK' } }` and `{ list: ['kh_LEAK'] }` both survived
verbatim, while `docs/THREAT_MODEL.md` said "a test asserts no secret substring survives
serialization".

**Fix.** `packages/config/src/redact.ts`: recursive, cycle-safe, redacting on three independent
grounds. The key name, matched against seventeen patterns rather than four declared names. The
value shape, seven patterns covering KeeperHub organization and webhook keys, Supabase keys and
JWTs, 32-byte hex, PEM blocks, connection strings carrying a password, and Cloudflare tokens.
And known values pulled from the parsed configuration, which is what catches a secret quoted
back under an innocuous key. Objects, arrays, Maps, Sets, Errors, Dates, bigints, functions and
symbols are all handled; cycles resolve to `[circular]` and a depth bound to `[max-depth]`.

Emitting paths audited: the only log call site in the repository is the Worker's `onError`,
which now serializes through `redactedJson`, and the health endpoint's validation issues now
pass through `redactString` with the known secrets of the current environment. `knownSecretValues`
tolerates a binding object that throws on property access, because diagnostics must not be the
thing that takes the Worker down.

**Evidence.** `pnpm --filter @resurv/config test`, 33 passing.

**Regression.** `packages/config/test/redact.test.ts` asserts against eight deterministic fake
credentials, every one containing TEST, in flat objects, nested objects, arrays, nested arrays,
objects inside arrays, Maps, Sets, Error messages and stacks, and a cyclic graph. Every
assertion is made against the serialized output, because the bytes are what reaches a log.
`apps/worker/test/health.test.ts` drives the unhandled-error path with a binding that throws a
message containing a fake key and asserts the log line does not carry it.

**Residual.** Shape-based redaction misses a shape nobody anticipated. It fails closed on what
it knows, including over-redacting transaction hashes, which are the same 66 characters as a
private key; that decision is recorded as a test rather than discovered later by whoever builds
the proof page.

### F6-C, F6-D — CI secret check narrower than described. MEDIUM, LOW. **ACCEPTED**

The job matched one regex and missed `.dev.vars`, `secrets/`, `keystores/`, `deployer.json` and
`account.json`, five of the categories the sentence above it claimed to cover. It would also
have failed the build on the `.env.staging.example` that `.gitignore` deliberately un-ignores.

**Fix.** `packages/repo-policy/src/tracked-secrets.ts`: thirteen rules, one per `.gitignore`
block, each with a reason. Directory rules are not waived by an `.example` suffix; file rules
are. The CI job now checks out full history and runs the package's tests, so the same detector
covers `git ls-files` and every path ever added in reachable history. A file committed and then
ignored is still tracked and still a leak, which a working-tree scan cannot see.

**Evidence.** `pnpm --filter @resurv/repo-policy test`.

**Regression.** `test/tracked-secrets.test.ts`: 28 fixtures that must be caught, including every
row of the reviewer's table, 11 that must not be, including all three example-file forms, plus
a test asserting the detection rules and `.gitignore` still name the same categories, plus live
scans of this repository. The history scan reports a shallow clone rather than passing quietly,
which is why the CI job sets `fetch-depth: 0`.

### F4-A through F4-G — self-referential invariants. HIGH. **ACCEPTED**

The handler opened with `if (!CovenantStatusLib.canTransition(status, to)) return;`. The
implementation under test also decided which inputs the fuzzer was allowed to try, so the suite
could prove only that the implementation agreed with itself. `invariant_terminalFlagAgreesWithStatus`
was a straight-line tautology. The other two were redundant with unit tests. And the call count
was not evidence: the longest legal chain is five edges, so at depth 64 almost every call was a
guaranteed early return.

**Fix.** ADR-009. Two reference models, one per language, transcribed by hand from PRD 9.1 as a
flat character grid, in a representation deliberately unlike production, calling nothing from
production. The handler now attempts the full pair space unconditionally, lets the library drive
the state, and judges every outcome against the model. Five invariants replace three:
transition agreement, terminal-predicate agreement, no illegal transition applied, terminal
absorption judged by the model's terminal set, and never returning to NONE.

Depth was made real rather than reported. The fuzzer restarts a settled covenant only when it
chooses to, so all 16,384 calls are transition attempts instead of half of them being resets,
and `afterInvariant` prints applied transitions, rejected attempts, covenants started, distinct
pairs attempted, distinct pairs applied and states visited. A typical run: 64 attempts, 8 to 15
applied, 3 to 5 covenants, 20 to 33 distinct pairs, 4 to 6 states.

`fail_on_revert` moved to `true` in both profiles. It hides nothing while the handler cannot
revert and would swallow every `require` the moment one wraps a real contract, which is exactly
what Phase 1 needs.

**Evidence.** `pnpm --filter contracts test` (26 tests), `pnpm --filter contracts test:invariant`
(5 invariants), `pnpm --filter @resurv/domain test` (34 tests), and the mutation results below.

**Regression.** Exhaustive equivalence over all 64 ordered pairs in both languages, plus named
regression tests for each defect class the reviewer named: `DRAFT -> EXECUTING`,
`DRAFT -> SATISFIED`, `ARMED -> SATISFIED`, `EXECUTING -> ARMED`, terminal to non-terminal,
terminal to a different terminal, SATISFIED reachable only from TRIGGERED and EXECUTING, and
irreversible expiry and cancellation.

**Residual.** The model is a transcription. A misreading of PRD 9.1 would be mirrored in both
languages and no test would object, so the transcription decisions are stated in a comment in
both files. The model describes a graph and not the covenant contract's real preconditions,
which do not exist yet.

### F2-A — cross-language ordinals rated VERIFIED, never compared. HIGH. **ACCEPTED**

Only the Postgres-to-TypeScript pairing had a shared oracle. `test_ordinalsAreStable` compared
the Solidity enum to literals in the same file and `covenant-status.test.ts` asserted the
TypeScript object was contiguous against itself. The consensus-relevant pairing rested on two
people typing the same eight names.

**Fix.** `packages/repo-policy/test/cross-language-state-machine.test.ts` parses the enum out of
`CovenantStatus.sol` and compares names and ordinals against `@resurv/domain`, and compares the
two reference model tables character for character. `foundry.toml` sets `fs_permissions = []`,
so the comparison is done from TypeScript rather than by giving Solidity tests filesystem
access.

**Evidence.** Verified by mutation: changing one character in the TypeScript model table fails
`agrees row for row on the transition table` in `@resurv/repo-policy` and two tests in
`@resurv/domain`. Restored and re-verified green.

**Ledger.** Split into two rows. Postgres to TypeScript stays `VERIFIED`. Solidity to TypeScript
is `VERIFIED (source level)`, with the qualifier stated: it compares source text, not compiled
artifacts and not a live decoded event.

### F2-B — a claim citing evidence that could not fail. HIGH. **ACCEPTED**

`docs/CLAIMS.md:42` cited `invariant_terminalStateIsAbsorbing` and a call count for "a terminal
covenant state is absorbing". With `isTerminal` rewritten to never return true, that invariant
still passed.

**Fix.** The claim keeps `VERIFIED (model only)` but its evidence is now the reference-model
invariant, the exhaustive regression test, and the mutation results, and the ledger's forbidden
wording list gained a line: no `VERIFIED (model only)` row may be read as saying anything about
a deployed covenant. A new row above it states the stronger and more useful fact, that the
reference machine matches PRD 9.1 on all 64 pairs.

### F2-C — MEASURED_EXTERNAL rows with no source pointer. LOW. **ACCEPTED**

Eight rows cite live measurements from `keeperhub-flightcheck` with specific detail and no
commit, run id or artifact path, so a reader of this repository cannot check one.

**Fix.** The artifacts were not copied here and inventing a pointer would be worse than saying
so. The vocabulary section now states plainly that a `MEASURED_EXTERNAL` row is uncheckable from
this repository and must be re-measured by the seam probe before anything is said publicly, and
each row carries "No artifact committed here".

**Residual.** Unchanged in substance. This is a disclosure fix, not an evidence fix.

### F2-D — six encoded behaviors with no ledger row. MEDIUM. **ACCEPTED**

The 401 and 404 envelope shapes, `request_id`, the `receiptStatus` literals,
`X-Poll-Interval-Hint`, the 60-per-minute rate limit, `Retry-After`, and both 409 idempotency
codes were asserted as fact in code and in `docs/RUNBOOKS.md` with no status anywhere.

**Fix.** Eight rows added to `docs/CLAIMS.md` under a heading that says what they are: seam
behavior encoded with no prior status, all `ASSUMED`, none reproduced from this repository, each
an input to the seam probe rather than an output of it. `docs/RUNBOOKS.md` no longer presents
them as settled diagnosis; its table carries the ledger status of each row.

Rating them `DOCUMENTED` would have required a source pointer this session cannot produce
without contacting KeeperHub, which is out of scope here. `ASSUMED` is the honest floor.

### F2-E — T8 rated above its evidence. LOW. **ACCEPTED**

T8 was `IN PLACE` on two pinned constants and a naming rule while T9, depending on the same
constants, was correctly `PARTIAL`. No code fetches a receipt from either endpoint.

**Fix.** T8 downgraded to `PARTIAL`, with the reason recorded, including what the `@resurv/chain`
distinctness test actually asserts.

### F2-F — an exit-gate row PASS for a deliverable that does not exist. MEDIUM. **ACCEPTED**

**Fix.** The row is corrected to **FAIL** in `docs/phase-logs/PHASE_00.md`, and a `REFUTED` row
was added to the ledger. Fabricating a snapshot now would repeat the substitution. It is an
outstanding input to Phase 0.5.

### F3-A — a false provenance claim in source. MEDIUM. **ACCEPTED**

`status.ts` opened with "Every rule in this file exists because a live probe contradicted the
documentation. See docs/CLAIMS.md and the Phase 2 seam record." No KeeperHub call has been made
from this repository, there is no Phase 2 seam record, and the `unconfirmed` rule the comment
covered is rated `DOCUMENTED (conflicting)`.

**Fix.** The comment now states the provenance accurately and points at the ledger. The same
sentence in `docs/ARCHITECTURE.md` is corrected. The `unconfirmed` docstring says two official
documents disagree rather than "observed live".

### F3-B — an unmeasured revert mapping presented as ground truth. MEDIUM. **ACCEPTED**

**Fix.** `classifyReceiptStatus` carries a docstring naming itself as the hypothesis the seam
probe exists to test, and warning against reading a passing probe as confirmation without
recording the response. Two ledger rows added, including one noting that `safe_inner_failure`
appears nowhere outside our own source.

### F3-C — constants duplicated instead of imported. MEDIUM. **ACCEPTED**

`errors.ts` hardcoded `'wfb_'` and `'kh_'` rather than importing `WEBHOOK_KEY_PREFIX` and
`ORG_API_KEY_PREFIX`, so the one path that would exercise those constants did not.

**Fix.** Imported. The package's tests now transitively cover them.

### F3-D — tests asserting a file agrees with its own docstring. MEDIUM. **REFUTED as a defect, ACCEPTED as a limitation**

The error-envelope tests do confirm the code agrees with its own comment, and that is all a
unit test can do for a seam nobody has probed. The correct fix is not a different test, it is a
status. The behavior now has ledger rows at `ASSUMED` and the probe settles it. No test changed.

### F1-A — the gate omitted two required commands. MEDIUM. **ACCEPTED**

`pnpm gate` chained seven of the nine commands `CLAUDE.md` requires. `test:integration` and
`test:e2e` were absent while `docs/BUILD_STATE.md` and `docs/RUNBOOKS.md` called it the full
sequence. Harmless while both suites are empty, and not harmless the moment a spec lands.

**Fix.** Both added to the gate. **Regression.** `test/workspace-scripts.test.ts` asserts the
gate script contains all nine.

### F1-B — the harness directories did not exist. LOW. **ACCEPTED**

`test:integration` and `test:e2e` pointed at directories that were not there.

**Fix.** Both created, each with a README stating that the emptiness is deliberate, what the
command does and does not prove, and which phase the first real specs belong to.

### F1-C — an unreproducible task count. LOW. **ACCEPTED**

"14 tasks" appeared in three documents. A forced run reported 9 at the time, 10 now.

**Fix.** Corrected in `docs/VERSIONS.md` and `docs/DECISIONS.md`, with a correction notice in
the Phase 0 log rather than a silent edit.

### F7-A — submodules described as vendored. MEDIUM. **ACCEPTED, with one stated consequence corrected**

`docs/VERSIONS.md` said forge-std was "installed with `--no-git`, vendored" and
`docs/RUNBOOKS.md` said Foundry dependencies "need no install step". Both are gitlinks at mode
`160000`, and populating them is a network fetch. The documentation defect is real and RUNBOOKS
is the file a new contributor reads first.

The reviewer's stated consequence, "a plain `git clone` produces empty `lib` directories and an
unbuildable contracts package", is half right and was measured rather than repeated. A plain
clone does leave both directories empty: `ls -A packages/contracts/lib/forge-std` returns 0
entries. It is not unbuildable. Foundry 1.7.1 runs `git submodule update` itself when `lib` is
empty, printing `Updating dependencies in .../lib`, so `forge build` succeeds and a plain clone
passes `pnpm gate` end to end on a networked machine. Reproduced twice in the scratchpad.

That does not rescue the word "vendored". A vendored dependency needs no network; this one
repairs itself by fetching from GitHub, which fails offline and does not happen at all for a
tool that reads the tree without invoking forge.

**Fix.** Both documents corrected, including the measured behavior so the next reader does not
have to rediscover it. `docs/RUNBOOKS.md` opens with `git clone --recurse-submodules`, gives
`git submodule update --init --recursive` for an already-cloned repository, and names the two
commits to verify with `git submodule status`. No conversion away from submodules: pinning an
audited dependency to an exact commit is the reason they are submodules.

### F7-B — a warm-store install is not a cold-network install. **ACCEPTED**

**Fix.** Recorded as an `ASSUMED` ledger row and a known limitation rather than fixed. Every
reproduction here resolved from a local content-addressable store and a warm solc cache.

### F8 — skipLibCheck qualification. LOW. **ACCEPTED**

**Fix.** `docs/VERSIONS.md` now says what was verified: RESURV's own source compiled against
those types, not those packages' declaration files, and why the `skipLibCheck: false` errors are
a configuration consequence rather than a TS-7 defect.

### Item 9 — zero-spec suites honestly represented. **PASS, with two gaps closed**

`docs/PROOF_LADDER.md` did not mention them and `docs/RUNBOOKS.md` described them as tests with
no note that both are empty. Both now say so, and `docs/BUILD_STATE.md` splits the counts.

### Items 5, 8, 10 — ADRs genuine, TypeScript 7 defensible, BUILD_STATE continuable. **PASS**

No change beyond the caveats above: the list-executions premise now has a ledger row, the
TypeScript 7 section records the reviewer's executed rollback, and BUILD_STATE's defects were
corrected.

## Adversarial mutation check

Run against scratch copies under the session scratchpad, never against the committed tree.
`packages/contracts` was copied with its `lib` symlinked; `packages/domain` was copied with its
`node_modules` symlinked. Baseline confirmed green in each copy before mutating, and each
mutation was reverted before the next.

The "Phase 0 suite" column is the reviewer's result, reproduced in their session against the
same three mutations.

| # | Mutation | Phase 0 suite | Remediated suite |
|---|---|---|---|
| A | Solidity: `DRAFT -> EXECUTING` permitted | 12 of 12 pass, 3 of 3 invariants pass | **4 failures.** 2 unit tests, 2 invariants: `canTransition disagrees with PRD 9.1`, `illegal transition applied` |
| B | Solidity: `EXECUTING -> ARMED` permitted | 12 of 12 pass, 3 of 3 invariants pass | **4 failures.** Same two invariants, plus the exhaustive equivalence test and the named regression |
| C | Solidity: `isTerminal` returns false for every state | 3 of 3 invariants pass at 16,384 calls | **5 failures**, including `isTerminal disagrees with PRD 9.1`. Invariant-only run exits 1 |
| D | Solidity: `SATISFIED -> EXPIRED` permitted | not run by the reviewer | **6 failures**, including `transition applied out of a terminal state` |
| E | Solidity: `ARMED -> SATISFIED` permitted | caught by one unit test; all 3 invariants pass | **6 failures**, including both invariants and `satisfiedIsReachableOnlyFromTriggeredAndExecuting` |
| F | TypeScript: `EXECUTING` added to `TRANSITIONS.DRAFT` | 17 of 17 pass | **3 failures** |
| G | TypeScript: `ARMED` added to `TRANSITIONS.EXECUTING` | 17 of 17 pass | **3 failures** |
| H | TypeScript: `isTerminalStatus` always false | caught at Phase 0 | **3 failures** |
| I | One character changed in the TypeScript reference model table | no such test existed | **3 failures**, one of them the cross-language comparison |

The row that matters is C. `pnpm --filter contracts test:invariant` is a required check and was
the sole cited evidence for a `VERIFIED` claim; it now exits 1 on a completely broken definition
of terminal, where before it exited 0.

Every scratch copy was left mutated only for the duration of its run. The committed tree was
touched once, for mutation I, and restored from a backup taken before the edit;
`git status --short` and a full re-run confirmed the restoration.

## Validation

Forced execution, not a cache replay:

```
TURBO_FORCE=true pnpm gate       exit 0    Cached: 0 of 10, 0 of 10, 0 of 2, 0 of 2, 0 of 3
```

The nine required commands, all exit 0, now all inside `pnpm gate`:

```
pnpm format:check
pnpm lint
pnpm typecheck                          10 turbo tasks
pnpm test                               275 TypeScript tests
pnpm test:integration                   0 specs, harness only
pnpm test:e2e                           0 specs, harness only
pnpm build
pnpm --filter contracts test            26 tests
pnpm --filter contracts test:invariant  5 invariants
```

Counts, split so no number can flatter itself:

| Suite | Count |
|---|---|
| `@resurv/domain` | 34 |
| `@resurv/keeperhub-client` | 30 |
| `@resurv/config` | 33 |
| `@resurv/db` | 7 |
| `@resurv/chain` | 7 |
| `@resurv/worker` | 7 |
| `@resurv/repo-policy` | 157 |
| `@resurv/web` | 0 |
| TypeScript substantive | **275** |
| Foundry unit and fuzz | **21** |
| Foundry invariants | **5** |
| integration harness | **0 specs** |
| E2E harness | **0 specs** |

Phase 0 reported 73 TypeScript, 12 Foundry and 3 invariants. The growth is 202 TypeScript tests,
157 of them parameterized repository-policy fixtures, and 14 Foundry tests.

## Fresh-clone reproduction

Run after the remediation commit, into a scratch directory with no relationship to the source
checkout:

```
git clone --recurse-submodules /Users/mac/resurv resurv     exit 0
git submodule status                                        bf647bd v1.16.2, 5fd1781 v5.6.1
pnpm install --frozen-lockfile                              exit 0
pnpm gate                                                   exit 0   Cached: 0 of 10
```

Test counts in the clone match the source exactly, including the 157 repository-policy tests,
which means the permission-boundary and tracked-secret checks travel with the repository rather
than depending on this machine. The history scan is not shallow in a local clone, so it runs for
real rather than reporting that it cannot answer.

Two plain clones without `--recurse-submodules` were also run, to check the reviewer's stated
consequence rather than repeat it. See F7-A.

The caveat the reviewer recorded still stands and was not fixed, because it cannot be fixed
from here: every install so far resolved from a warm local content-addressable store with a warm
solc cache. A genuinely cold-network install remains unproven and is an `ASSUMED` ledger row.

## Secrets

No live secret entered this repository at any point. No environment file exists. The
tracked-secret detector reports zero findings against `git ls-files` and against every path ever
added in reachable history, and it runs on every CI job. Every credential-shaped string in the
test suite is a deterministic fake containing TEST.

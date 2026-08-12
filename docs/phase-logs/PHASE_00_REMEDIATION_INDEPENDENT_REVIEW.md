# Phase 0 remediation, independent re-validation

Date: 2026-08-11. Reviewer: fresh session, no participation in the Phase 0 build and no
participation in the remediation. Commit under review: `864dd7f`.

Verdict: **PASS**, with eight new findings, none of them blocking.

Nothing in the repository was modified by this review except this file. `git status --short`
was empty before the first command and after the last, and `HEAD` is still `864dd7f`. Every
destructive experiment ran in scratch clones under the session scratchpad. No KeeperHub call
was made, no credential was created or read, no deployment happened, and Phase 0.5 was not
started.

## Method

Nothing below was read off `PHASE_00_REMEDIATION.md` and accepted. The remediation's own
numbers were treated as claims to be re-measured.

| What | How |
|---|---|
| Permission semantics | Fetched the official permissions reference and transcribed the matching rules a second time, independently of `packages/repo-policy/src/bash-rules.ts` |
| Permission boundary | 68 adversarial command forms evaluated against the committed `.claude/settings.json` by that second matcher |
| Repo-policy coverage | 16 mutations that reintroduce a real regression, run against the committed suite |
| State machine | 20 source mutations (12 Solidity, 8 TypeScript) plus 3 composite cases, each of the four suites run separately per mutation |
| Invariant reachability | Coverage counters read at depth 64 and at the CI profile's depth 128; `fail_on_revert` tested by injecting a revert into the handler |
| Redaction | 34 adversarial cases through the real `redactedJson`, plus 6 edge probes, deterministic fakes only |
| Tracked secrets | 17 fixtures actually `git add -f`'d in a scratch clone, then committed and untracked to exercise the history scan |
| Submodules | Three clone modes measured, including `forge build` in a plain clone with full output captured |
| Gate | `TURBO_FORCE=true pnpm gate` in the source tree and again in a fresh `--recurse-submodules` clone, cache summaries captured both times |

Scratch clones: `clones/a` (`--recurse-submodules`, installed, used for mutations after its
clean run was recorded), `clones/b3` (plain clone, submodule behavior), `clones/c` (plain clone
plus `git submodule update --init --recursive`, installed, used for the secret and redaction
probes).

One incidental measurement worth recording, because it is the only live evidence anyone has
that these rules do anything: this session's own harness denied two of my commands. A compound
command whose second element was `rm -rf "$BASE/b2"` was denied, and a `git rm --cached` line
naming `.env` was denied. Deny rules and compound splitting are live, not just modeled.

---

## 1. Permission-boundary adversarial review — **PASS**, two findings

### What was checked

`.claude/settings.json` was not merely inspected. I fetched
`https://code.claude.com/docs/en/permissions` and wrote a second matcher from it without
reading the repository's own model first, then evaluated 68 command forms against the
committed rule set. The documented semantics I transcribed:

- deny, then ask, then allow; first match wins; specificity does not reorder.
- `*` is a glob at any position, including the beginning, and spans spaces.
- A trailing ` *` enforces a word boundary. `:*` is the same thing and is recognized only at
  the end of a pattern.
- Separators `&&`, `||`, `;`, `|`, `|&`, `&` and newlines; every subcommand must match
  independently.
- Stripped wrappers: `timeout`, `time`, `nice`, `nohup`, `stdbuf`, `command`, `builtin`,
  `noglob`, and bare `xargs`. Environment runners such as `npx` and `pnpm exec` are not
  stripped.
- An allow rule does not match past an unknown leading assignment; a deny or ask rule does.
- `watch`, `setsid`, `ionice`, `flock` and `find -exec`/`-delete` always prompt.
- A built-in read-only set (`ls`, `cat`, `echo`, `pwd`, `head`, `tail`, `grep`, `find`, `wc`,
  `which`, `diff`, `stat`, `du`, `cd`, read-only `git`) runs with no prompt in every mode and
  cannot be removed from that set except by an ask or deny rule.

`packages/repo-policy/src/bash-rules.ts` agrees with the reference on the first six. The
seventh and eighth are absent from it, which is finding N1 below.

### External writes

Every indirection path I could construct reaches `deny`. None reaches `allow`.

| Form | Verdict |
|---|---|
| `wrangler deploy`, `wrangler secret put …`, `cast send …`, `forge create …`, `forge script … --broadcast` | deny |
| `pnpm --filter @resurv/worker deploy`, `--filter=`, quoted filter, `-F`, `-C`, `--dir`, `--prefix … run deploy` | deny |
| `pnpm run deploy`, `pnpm exec wrangler deploy`, `pnpm dlx wrangler deploy`, `pnpm -r deploy`, `pnpm -r exec wrangler deploy`, `pnpm --recursive exec wrangler deploy` | deny |
| `turbo run deploy`, `turbo run deploy --filter=…`, `npx wrangler deploy`, `npm run deploy`, `npm exec wrangler deploy`, `bunx wrangler deploy` | deny |
| `./node_modules/.bin/wrangler deploy` | deny |
| `pnpm exec wrangler  deploy` (double space) | deny |
| `wrangler deploy --dry-run` | deny |
| `make deploy`, `node node_modules/wrangler/bin/wrangler.js deploy` | ask |
| `turbo deploy` (turbo's no-`run` shorthand), `yarn deploy`, `wrangler  deploy`, `cast  send 0x1` | prompt |

The exact-match strategy holds up. Every allow rule is either an exact string or a narrow
wildcard over a read-only binary, and the test at `permission-boundary.test.ts:125` fails if
any allow rule is a command runner with a wildcard tail. That test bites: reintroducing
`Bash(pnpm --filter:*)` or `Bash(turbo run:*)` fails the suite (section 2, C1 and C2).

Ordinary development stays autonomous: the eight forms the remediation names, plus
`pnpm --filter @resurv/db migrate:generate`, `forge test -vv`, `anvil --port 8545`,
`cast call`, and read-only git, all resolve to `allow`.

### Secret reads

`cat .env`, `head -n 5 .dev.vars`, `sed -n 1p .env`, `grep KEEPERHUB_API_KEY .env`,
`rg kh_ .env`, `jq . .dev.vars`, the `node -e` readFileSync form, `find … -exec cat`,
`cat secrets/…`, `cat keystores/…`, `cat ~/.foundry/keystores/deployer`, `printenv` and `env`
all reach `deny`. The interpreters that are not in the built-in read-only set (`node -e`,
`bash -c`, `python3 -c`, `rg`, `jq`, `base64`, `xxd`, `sed`, `awk`) are in `ask`.

**N1. MEDIUM. Host credential paths outside the deny list are read with no prompt, and the
repository's model cannot see that they are.**

Claude Code's built-in read-only set runs without a prompt in every mode. The only thing that
stops `cat` and `grep` is a deny rule naming the path, which `docs/THREAT_MODEL.md` T11 says
correctly. The list of named paths is narrower than the asset table implies:

| Command | Real outcome |
|---|---|
| `cat ~/.wrangler/config/default.toml` | runs, no prompt |
| `cat ~/.config/gh/hosts.yml` | runs, no prompt |
| `cat ~/.npmrc` | runs, no prompt |
| `cat ~/.docker/config.json` | runs, no prompt |
| `cat ~/.config/gcloud/credentials.db` | runs, no prompt (denied for the Read tool, not for Bash) |
| `cat /Users/mac/.claude.json` | runs, no prompt |
| `echo $KEEPERHUB_API_KEY` | runs, no prompt |

The first row matters most. `~/.wrangler/config/default.toml` holds the Cloudflare OAuth
token, and `docs/THREAT_MODEL.md` lists "KeeperHub API key: `.env`, Worker secret" as an
asset. The credential that governs that Worker secret is on neither the Bash deny list nor
the Read deny list.

This does not defeat the boundary for the asset Phase 0.5 actually introduces. That key lands
in `.env` or `.dev.vars`, both of which are denied for Read, Edit, Write and Bash at any
position in the string. T11 already states the general residual, and `docs/BUILD_STATE.md`
repeats it. What is new is that these commands name a path and are still not covered, which
sits between the protected-path list and the stated residual rather than inside either.

Second half of the finding: `decide()` returning `prompt` in `packages/repo-policy` is not
the same as "Claude Code will prompt". For the built-in read-only set the real outcome is
"runs immediately". No test encodes that set, so the suite's `not.toBe('allow')` assertions
are weaker than they read.

**N2. LOW. Three deny patterns miss a trivially different spelling.**

`turbo deploy` (turbo accepts a task name without `run`), `wrangler  deploy` and
`cast  send 0x1` with two spaces all fall through the deny rules. All three land on `prompt`,
so the failure is safe rather than silent, and none of them is a bypass. Recorded as
hardening, not as a defect.

### On the wording

Nothing in `docs/`, `.claude/` or the source calls `.claude/settings.json` a sandbox. The
forbidden-wording list in `docs/CLAIMS.md` names the word explicitly, T10 and T11 both say
what the configuration is, and `docs/BUILD_STATE.md` says it a third time. I am not
describing it as a sandbox either. It is a configured permission boundary whose rules I
verified against the vendor's own documented matching behavior.

---

## 2. Repo-policy package — **PASS**, two coverage gaps

157 passing tests were treated as a number, not as evidence. I ran 16 mutations that
reintroduce a real regression and asked whether the committed suite notices.

| # | Mutation | Result |
|---|---|---|
| C1 | `Bash(pnpm --filter:*)` back in allow | caught: *never combines a command runner with an open wildcard tail* |
| C2 | `Bash(turbo run:*)` back in allow | caught: same test |
| C3 | `Bash(node -e:*)` and `Bash(rg:*)` back in allow | caught: two tests |
| C4 | deny rule `Bash(*wrangler deploy*)` deleted | caught: *blocks wrangler deploy*, *blocks npx wrangler deploy* |
| C5 | deny rule `Bash(*.env*)` deleted | caught: four secret-read cases |
| C6 | `@resurv/domain`'s allow-listed `test` script gains `&& wrangler deploy` | caught: three tests |
| C7 | worker `build` loses `--dry-run` | caught: three tests |
| C9 | the gate loses `pnpm test:e2e` | caught: *includes pnpm test:e2e* |
| C10 | an allow rule names a script that no longer exists | caught: *names only workspace scripts that exist* |
| C11 | `foundry.toml` sets `ffi = true` | caught: *leaves ffi disabled* |
| C13 | the `dev-vars` detection rule is deleted | caught: three fixtures |
| C14 | a new package script that deploys, plus an exact allow rule for it | caught: *auto-approves no workspace script that has an external effect* |
| **C8** | the allow-listed root script `pnpm lint` gains `&& wrangler deploy` | **SURVIVED** |
| **C8b** | a new root script `"ship": "wrangler versions upload"` plus `Bash(pnpm ship)` in allow | **SURVIVED** |
| **C12** | `.gitignore` comments out `secrets/` | **SURVIVED** |
| **C12b** | `.gitignore` deletes the `secrets/` line | **SURVIVED** |

**N3. MEDIUM. Root `package.json` scripts are auto-approved and are enumerated by nothing.**

`permission-boundary.test.ts` iterates `workspacePackages()`, which reads `apps/*` and
`packages/*`. `workspace-scripts.test.ts` reads root scripts only to assert that `gate`
contains nine substrings. Eleven root scripts are auto-approved by exact-match rules
(`format`, `format:check`, `lint`, `lint:fix`, `typecheck`, `test`, `test:integration`,
`test:e2e`, `build`, `gate`, `clean`) and no test asserts anything about what they contain.

This is the same shape as F6-A. It is not a live bypass: I read all eleven bodies and none has
an external effect today, and the one nested runner (`lint` calls
`pnpm --filter contracts lint`, which is `forge fmt --check`) is harmless. It is a hole in the
regression net that closed F6-A, and closing it is a two-line change to an existing test.

**N4. LOW. The ".gitignore and the detection rules agree" test is a substring check that a
sibling line can satisfy.**

`tracked-secrets.test.ts:86-105` asserts `expect(gitignore).toContain('secrets/')`. Deleting
line 31 of `.gitignore` leaves the assertion satisfied, because line 32 is `.secrets/` and
contains the substring. The same holds for `keystore/` under `keystores/` and for `.env`
under `.env.*`. Practical impact is small, because a file added under a no-longer-ignored
directory becomes tracked and the detector then fires, which C13 confirms still works. The
control is weaker than the remediation describes it.

On the question of tests shaped like the implementation: I looked for that specifically and
mostly did not find it. `PROVEN_BYPASSES`, `SECRET_READ_PATHS` and `MUST_STAY_AUTONOMOUS` are
command strings that the rules must classify, not fixtures derived from the rules. The
`hasExternalEffect || isCommandRunner` assertion at line 99 keeps the bypass list from rotting
into a list of strings nobody checks. The one place where a fixture mirrors the
implementation's shape is N4.

---

## 3. Solidity state-machine model — **PASS**, one wording note

### Independence

`packages/contracts/test/model/CovenantStatusReference.sol` imports exactly one thing:
`{CovenantStatus}` from `../../src/CovenantStatus.sol`, which is the enum type, not the
library. It never references `CovenantStatusLib`, `canTransition`, `isTerminal`, any
production transition table, or any generated artifact. Production is a branch chain; the
model is a flat `bytes` grid indexed by ordinal. The two representations are genuinely
different, which is what makes an identical typo in both unlikely.

The Solidity model is the reference for the invariant handler and for
`CovenantStatusReference.t.sol`, and it is compared character for character against the
TypeScript model by `@resurv/repo-policy`, which is what stops the two languages drifting.

### The complete matrix, checked by hand against PRD 9.1

PRD 9.1 draws:

```
DRAFT -> ARMED -> TRIGGERED -> EXECUTING -> SATISFIED
   |       |          |            |
   |       |          |            -> EXPIRED
   |       |          -> EXPIRED
   |       -> CANCELLED
   -> CANCELLED
```

| From \ To | NONE | DRAFT | ARMED | TRIGGERED | EXECUTING | SATISFIED | EXPIRED | CANCELLED |
|---|---|---|---|---|---|---|---|---|
| NONE | . | X | . | . | . | . | . | . |
| DRAFT | . | . | X | . | . | . | . | X |
| ARMED | . | . | . | X | . | . | . | X |
| TRIGGERED | . | . | . | . | X | X | X | . |
| EXECUTING | . | . | . | . | . | X | X | . |
| SATISFIED | . | . | . | . | . | . | . | . |
| EXPIRED | . | . | . | . | . | . | . | . |
| CANCELLED | . | . | . | . | . | . | . | . |

Ten edges. Eight are drawn in the 9.1 diagram. `NONE -> DRAFT` is covenant creation, which
the enum's `NONE` comment and PRD 8.1 both imply. `TRIGGERED -> SATISFIED` is the tenth and
is not drawn: it comes from 9.1's closing note that `EXECUTING` may be an emitted attempt
state rather than a stored one, together with PRD 8.4, where a single `executeAttempt` marks
the covenant `SATISFIED`. Both model files state that transcription decision in a comment. I
agree with the inference and I would have made the same one.

Terminal set `{SATISFIED, EXPIRED, CANCELLED}` matches PRD 8.6 and 8.7 and CLAUDE.md's
"no action runs after a terminal state". Self-transitions forbidden, nothing returns to NONE,
terminal states reach nothing including each other. All correct against the PRD.

**N5. LOW. `docs/CLAIMS.md:65` says "matches PRD 9.1 exactly" without the qualifier the model
files carry.** Nine of the ten edges are in 9.1 as written; the tenth is an inference from
9.1's closing note. The inference is sound and disclosed in the source. The ledger row is the
document a reader checks first, and "exactly" is the wrong word for a transcription that adds
an edge the diagram does not draw.

### Advisory, not a finding

PRD 9.1 has no `ARMED -> EXPIRED` edge, so an armed covenant that is never triggered and whose
deadline passes has no modeled path to a terminal state. The model is faithful to the PRD, so
this is not a remediation defect. It is a question the covenant contract will have to answer
in Phase 1, and it is exactly the class of thing a hand transcription mirrors rather than
catches.

---

## 4. Mutation tests — **PASS**

Every mutation was applied to `clones/a`, never to the source tree. Each of the four suites
was run separately per mutation so the invariant suite's verdict is visible on its own.
Baseline green in all four before the first mutation. The file was restored and hash-checked
after each one, and `git status --short` in the clone was empty at the end.

`forge-unit` is `forge test --no-match-path 'test/invariant/*'`. `forge-invariant` is
`forge test --match-path 'test/invariant/*'`, which is the required check.

| # | Mutation | forge-unit | forge-invariant | ts-domain | ts-repo-policy |
|---|---|---|---|---|---|
| M1 | `DRAFT -> EXECUTING` permitted | caught (4) | **caught** | n/a | n/a |
| M2 | `EXECUTING -> ARMED` permitted | caught (4) | **caught** | n/a | n/a |
| M3 | `ARMED -> SATISFIED` permitted | caught (8) | **caught** | n/a | n/a |
| M4 | `SATISFIED -> EXPIRED` permitted | caught (4) | **caught** | n/a | n/a |
| M5 | `isTerminal` false for every state | caught | **caught** | n/a | n/a |
| M6 | `EXPIRED -> DRAFT` permitted | caught (4) | **caught** | n/a | n/a |
| M7 | `CANCELLED -> EXECUTING` permitted | caught (4) | **caught** | n/a | n/a |
| M8 | `EXECUTING` misclassified as terminal | caught (6) | **caught** | n/a | n/a |
| M9 | legitimate edge `DRAFT -> CANCELLED` removed | caught (2) | **caught** | n/a | n/a |
| M10 | every transition legal | compile error | compile error | n/a | n/a |
| M10b | every non-self transition legal, compiling cleanly | caught (5) | **caught** | n/a | n/a |
| M11 | `NONE -> DRAFT` removed | caught (4) | **caught** | n/a | n/a |
| M12 | `SATISFIED -> SATISFIED` self-transition permitted | caught (8) | **caught** | n/a | n/a |
| M13 | production and the Solidity model both permit `DRAFT -> SATISFIED` | caught (3) | survived by construction | n/a | **caught** |
| M14 | the Solidity model claims nothing is terminal | caught (1) | **caught** | n/a | **caught** |
| T1 | `EXECUTING` added to `TRANSITIONS.DRAFT` | n/a | n/a | caught (3) | n/a |
| T2 | `ARMED` added to `TRANSITIONS.EXECUTING` | n/a | n/a | caught (3) | n/a |
| T3 | `isTerminalStatus` always false | n/a | n/a | caught (3) | n/a |
| T4 | `EXECUTING` added to `TERMINAL` | n/a | n/a | caught (4) | n/a |
| T5 | legitimate edge `ARMED -> CANCELLED` removed | n/a | n/a | caught (2) | n/a |
| T6 | `canTransition` always true | n/a | n/a | caught (17) | n/a |
| T7 | `SATISFIED -> EXPIRED` permitted | n/a | n/a | caught (4) | n/a |
| T8 | one character flipped in the TypeScript model table | n/a | n/a | caught (2) | **caught** |

The five the brief requires (M1, M2, M8-as-`ARMED -> SATISFIED` is M3, M4, M5) are all
detected by the invariant suite alone, exiting 1. The row that matters most is M5: the same
mutation exited 0 at Phase 0 and now fails `invariant_terminalPredicateAgreesWithReferenceModel`.

Seven mutations are new to this review: M6, M7, M8, M9, M11, M12 and the composite M13/M14.
They were chosen from the actual implementation, not from the brief's examples: M9 and M11
remove legitimate behavior rather than adding illegal behavior, which the remediation's own
set never tested, and M12 attacks the `if (from == to) return false;` guard that no listed
mutation touches.

Two results are worth reading carefully.

M10 was caught by solc rather than by a test, because `deny = "warnings"` in `foundry.toml`
turns the unreachable code into a build failure. That is a genuine stop but it is not the
test suite doing the work, so I rewrote it as M10b, which compiles cleanly and is caught by
five unit tests and by the invariant run.

M13 is the strongest case available: production and the Solidity reference model both changed
so that they still agree with each other. The invariant suite cannot see this, by
construction, because it compares exactly those two things. It is caught anyway, by
`test_regression_draftCannotReachSatisfied`, by
`test_regression_satisfiedIsReachableOnlyFromTriggeredAndExecuting`, by
`test_referenceModelPermitsExactlyTenTransitions`, and by the cross-language comparison in
`@resurv/repo-policy`. The named regression tests and the edge count are load-bearing, not
decoration. If the model, both productions and both languages were all changed together,
nothing would object, which is the residual ADR-009 already records.

No safety-critical mutation survived its relevant suite.

---

## 5. Invariant reachability — **PASS**

The handler is not gated on the code under test. `attempt` bounds the fuzzed target into the
enum range, records the attempt, compares `CovenantStatusLib` against
`CovenantStatusReference` for both the transition relation and the terminal predicate, and
only then lets the library decide whether the state moves. `restart` is gated on the model's
terminal set, not the library's, so a broken `isTerminal` cannot change the fuzzer's shape.

Measured coverage, read from `afterInvariant` rather than from the call count. Foundry gives
each run a fresh handler, so these are per-run figures.

| Profile | Attempts | Applied | Rejected | Covenants | Distinct pairs attempted | Distinct pairs applied | States visited |
|---|---|---|---|---|---|---|---|
| default, depth 64 | 64 | 7 to 15 | 49 to 57 | 3 to 5 | 19 to 27 of 64 | 3 to 6 of 10 | 4 to 6 of 8 |
| ci, depth 128 | 128 | 19 to 24 | 104 to 109 | 7 to 8 | 34 to 36 of 64 | 8 of 10 | 8 of 8 |

Two honest readings of that. A single run does not sweep the pair space, and the remediation
does not claim it does: "attempts the full pair space unconditionally" means the handler does
not filter its inputs, and `docs/BUILD_STATE.md` states 20 to 33 pairs per run, which my
depth-64 measurement brackets. Exhaustive 64-pair coverage comes from
`test_libraryAgreesWithTheReferenceModelOnEveryPair`, which is a unit test and is honest about
being one. The raw 16,384 is reported by Foundry and is used nowhere as strength of evidence;
`docs/BUILD_STATE.md` says in as many words that the Phase 0 framing of it was misleading.

`fail_on_revert = true` was tested rather than assumed. I injected a `require` into the
handler that no invariant assertion would otherwise notice:

| Configuration | Result |
|---|---|
| clean handler, `fail_on_revert = true` | exit 0, reverts: 0 |
| reverting handler, `fail_on_revert = true` | **exit 1**, reverts: 1, revert reported as the failure |
| reverting handler, `fail_on_revert = false` | exit 0, reverts: 2136, silently discarded |

So the setting is operative, not cosmetic. It is currently unexercised, because the committed
handler has no revert-capable path, and it starts doing real work the moment a handler wraps a
contract with a `require`. Both `foundry.toml` and T12 say exactly that.

---

## 6. TypeScript mirror — **PASS**

`packages/domain/test/model/covenant-status-reference.ts` imports nothing at all. It is a
standalone character grid with its own ordinal array, and
`covenant-status-reference.test.ts` generates all 64 pairs from the model rather than from
production. The eight TypeScript mutations in section 4 are each caught by `ts-domain`,
including the two the Phase 0 suite missed (T1, T2) and the constant-false `isTerminalStatus`
(T3). T5 and T7 are new here: removing a legitimate edge and letting a terminal state leave.

Drift is detected in both directions. Flipping one character in the TypeScript model table
(T8) fails two tests in `@resurv/domain` and `agrees row for row on the transition table` in
`@resurv/repo-policy`. Sabotaging the Solidity model's terminal row (M14) fails
`test_terminalPredicateAgreesWithTheReferenceModel`, the Solidity invariant run, and two
`@resurv/repo-policy` tests. The cross-language comparison is done from TypeScript by parsing
both source files, and `fs_permissions = []` keeps Solidity tests off the filesystem, which
`workspace-scripts.test.ts` asserts.

---

## 7. Secret redaction — **PASS**, two edges

34 independent cases were written against the real `redactedJson` using eight deterministic
fakes, every one containing `TEST`, and asserted against the serialized bytes. All 34 pass.

| Case | Result |
|---|---|
| flat object, all eight shapes | clean |
| nested object, five levels, innocent key names | clean |
| array; nested arrays; object inside array; array inside object | clean |
| Map; Map with a non-string key; Set | clean |
| Error message and Error stack; Error nested in a structure | clean |
| repeated (shared, non-cyclic) reference | clean, and not misreported as `[circular]` |
| self-cycle and mutual cycle through an array | terminates, clean, `[circular]` present |
| secret under an innocent key, realistic shape | clean, by the shape rule |
| secret quoted back under an innocent key, via `knownSecrets` | clean |
| `redactEnv` with the secret nested and inside an array (the Phase 0 defect) | clean |
| secret-named key holding a number, boolean, object or array | `[redacted]` |
| secret-named key holding `null` | left as `null`, no invented value |
| symbol-keyed and non-enumerable secret properties | dropped, not serialized |
| a hostile `toJSON` that re-injects the raw value | cannot, `redact` returns plain data |
| class instance with own enumerable fields | walked |
| secret in a URL query string; bare string input | clean |
| 40 levels deep | `[max-depth]`, secret dropped rather than leaked |

Emitting paths audited independently. The only `console.*` call site in the repository is
`apps/worker/src/index.ts:67`, the Hono `onError`, which serializes through `redactedJson`
with `knownSecrets` from the environment. `/api/health` passes each validation issue through
`redactString` with the same known secrets. No other diagnostic path exists yet.

**N6. LOW. `redact` throws on an object with a throwing property getter; `knownSecretValues`
does not.**

```
redactedJson({ get boom() { throw new Error('property access denied') } })  ->  THREW
knownSecretValues(<proxy that throws on KEEPERHUB_API_KEY>)                ->  []
redactedJson(<same proxy>)                                                 ->  THREW
```

`packages/config/src/index.ts:98` guards property access with the stated reason that
"diagnostics must not be the thing that takes the Worker down". `redact` walks
`Object.entries`, which invokes getters, with no such guard, and `onError` calls it. An error
value carrying a throwing getter would make the redacting error handler itself throw. This is
a robustness gap in the one path that exists to be safe, not a demonstrated leak, and the fix
is a `try`/`catch` in `redactContainer`.

**N7. LOW. A declared secret shorter than six characters survives under an innocent key.**

```
redactEnv({ KEEPERHUB_API_KEY: 'kh_1', note: 'saw kh_1' })
  ->  {"KEEPERHUB_API_KEY":"[redacted]","note":"saw kh_1"}
```

`MIN_KNOWN_SECRET_LENGTH = 6` skips short known values, and `kh_1` is too short for the
`(kh|wfb)_[A-Za-z0-9_-]{4,}` shape rule. `serverSecretsSchema` accepts any non-empty string
beginning with `kh_`, so a four-character key is schema-valid. `docs/CLAIMS.md:82` says "No
declared secret survives serialization, at any nesting depth" with no length qualifier. True
for every realistic key, false at the edge. The threshold exists for a good reason and the
right fix is the claim's wording, not the constant.

Over-redaction behaves as documented: a transaction hash and a 40-character mixed-case build
id are both redacted. `orgKey`, `bearer` and `signer` are not secret-bearing key names, which
is the shape-based residual T6 already states.

---

## 8. Tracked-secret detector — **PASS**

The detector was tested against genuinely tracked state, not against strings. Seventeen
fixtures were written into `clones/c` and `git add -f`'d, which is the only way to track a
file `.gitignore` covers.

| Path | Verdict | Rule |
|---|---|---|
| `.env`, `.env.local`, `.env.production` | caught | `env-file` |
| `.dev.vars`, `.dev.vars.production`, `apps/worker/.dev.vars` | caught | `dev-vars` |
| `secrets/example` | caught | `secrets-dir` |
| `keystores/example` | caught | `keystore-dir` |
| `deployer.json`, `account.json` | caught | `deployer-credential` |
| `certs/deploy.pem`, `certs/deploy.key` | caught | `key-material` |
| `home/id_rsa` | caught | `ssh-key` |
| `ops/cluster.private.json` | caught | `private-json` |
| `.env.example`, `.env.staging.example`, `.dev.vars.example` | allowed | example exemption |

`secrets/example` and `keystores/example` are the interesting rows: directory rules carry
`exampleExempt: false`, so an `example` file inside a credential directory is still a finding,
which is the right call. `findSecretPaths(gitTrackedPaths())` returned all 14 and the real
suite failed on `tracks no secret-bearing file`.

Git-tracked state rather than the working tree, verified by exercising the difference. After
committing the fixtures and then `git rm --cached`-ing them:

```
tracked fixtures still present:                0
shallow repository:                            false
fixtures visible in reachable history:         17 of 17
pnpm --filter @resurv/repo-policy test         exit 1
  failing: "never committed one, as far as reachable history goes"
```

So a file committed and later ignored is still caught, which a working-tree walk cannot do
and the Phase 0 regex could not do either. The shallow-clone branch reports rather than
passing quietly, and `.github/workflows/ci.yml` sets `fetch-depth: 0` for exactly that reason.

---

## 9. Submodule reproducibility — **PASS**, one transcription note

Three modes, measured rather than repeated.

**A. `git clone --recurse-submodules`.** Exit 0. Both gitlinks populated: `forge-std` 14
entries, `openzeppelin-contracts` 41. Nested OZ submodules checked out.

**B. plain `git clone`, network available.** Exit 0. `git submodule status` prints a leading
`-` on both entries; `ls -A` returns 0 for both; `git ls-files -s packages/contracts/lib`
shows mode `160000` twice. Then `forge build` in `packages/contracts`:

```
Missing dependencies found. Installing now...
Submodule 'packages/contracts/lib/forge-std' ... registered
Submodule 'packages/contracts/lib/openzeppelin-contracts' ... registered
Cloning into '.../lib/forge-std'...
Cloning into '.../lib/openzeppelin-contracts'...
Updating dependencies in .../packages/contracts/lib
Compiling 26 files with Solc 0.8.36
Compiler run successful!
forge build exit=0
```

Foundry 1.7.1 does auto-fetch, exactly as the remediation claims, including the
`Updating dependencies in .../lib` line it quotes. The original reviewer's stated consequence,
"an unbuildable contracts package", is wrong on a networked machine, and the remediation was
right to measure it instead of repeating it.

**C. plain clone then `git submodule update --init --recursive`.** Exit 0, both populated at
the recorded commits, nested OZ submodules initialized.

The documentation now describes gitlinks as gitlinks. `docs/VERSIONS.md:48-54` says
"Both are submodules, not vendored files", records the mode `160000` evidence, states that
populating them is a network fetch from GitHub, and separates Foundry's convenience repair
from the property vendoring would give. `docs/RUNBOOKS.md` opens with
`git clone --recurse-submodules`, gives the repair command for an already-cloned repository,
and states the measured Foundry behavior together with the two cases where it does not help.
The word "vendored" survives nowhere as an assertion.

**N8. LOW. `git submodule status` does not print what two documents say it prints.**

`docs/RUNBOOKS.md:29-30` and `PHASE_00_REMEDIATION.md:414` both present
`openzeppelin-contracts` as `5fd1781 (v5.6.1)` in that command's output. The command actually
prints `(v4.8.0-1122-g5fd1781b)`, because `git submodule status` describes against a different
tag set. The pin itself is correct and I verified it in the submodule:
`git tag --points-at HEAD` returns `v5.6.1` and `package.json` says `"version": "5.6.1"`. Only
the transcription of the command's output is wrong, and it is the kind of thing a reader will
hit while following the runbook.

---

## 10. Test accounting — **PASS**

Counts re-derived per package rather than taken from the table.

| Suite | Independently measured | `docs/BUILD_STATE.md` |
|---|---|---|
| `@resurv/domain` | 34 | 34 |
| `@resurv/keeperhub-client` | 30 | 30 |
| `@resurv/config` | 33 | 33 |
| `@resurv/db` | 7 | 7 |
| `@resurv/chain` | 7 | 7 |
| `@resurv/worker` | 7 | 7 |
| `@resurv/repo-policy` | 157 | 157 |
| `@resurv/web` | 0 | 0 |
| TypeScript substantive | **275** | 275 |
| Foundry, `forge test` total | **26** | 26 |
| of which invariant | **5** | 5 |
| of which unit and fuzz | **21** | 21 |

`apps/worker/test/integration` and `apps/web/test/e2e` each contain one file, a README. Zero
specs, confirmed by listing both directories. `docs/BUILD_STATE.md` puts them in a separate
table, states the count as **0**, and says in the following paragraph that their existing is
what the gate required and that it is not coverage. The empty harnesses are not folded into
any total anywhere I could find. The 21/5 split is not double counted: 26 is the whole
`forge test` run and 5 of those 26 are the invariant file, which `test:invariant` re-runs on
its own.

One small imprecision, below finding threshold. `PHASE_00_REMEDIATION.md:379` labels
`pnpm test` as "275 TypeScript tests". `turbo run test` also runs `contracts#test`, so that
command executes the 26 Foundry tests as well. The split table is right; the one-line
description of the command is partial.

---

## 11. Claim ledger — **PASS**, with N5 and N7 above

Every claim the remediation touched was checked against what I measured.

| Claim | Status | My verdict |
|---|---|---|
| The reference covenant state machine matches PRD 9.1 exactly | VERIFIED (model only) | Evidence holds. Wording overstated, see N5 |
| A terminal covenant state is absorbing | VERIFIED (model only) | Holds. The cited invariant now fails on M5, M6, M7, M12; the regression test and the mutation record are real |
| Ordinals agree Postgres to TypeScript | VERIFIED | Holds, genuine shared oracle |
| Ordinals agree Solidity to TypeScript | VERIFIED (source level) | Holds. The qualifier is accurate: source text is parsed, not compiled artifacts and not a decoded event |
| The two state machines permit the same transitions | VERIFIED (source level) | Holds. T8 and M14 both fail the comparison |
| No declared secret survives serialization, at any nesting depth | VERIFIED | Holds for every realistic value. Edge exception at N7 |
| `/api/health` never echoes a secret value | VERIFIED | Holds, re-read the handler and the test |
| The unhandled-error log line cannot carry a secret | VERIFIED | Holds, with the robustness caveat at N6 |
| CI fails if a secret-bearing file is ever tracked | VERIFIED | The detector holds, proven in section 8. See the CI note below |
| Deployment, secret mutation and signing are not auto-approved, wrapper forms included | VERIFIED (policy level) | Holds. 68 forms tested, none reaches allow. The qualifier is correct |
| A fresh clone with submodules reproduces the gate | VERIFIED | Reproduced, section 12 |
| A genuinely cold-network install works | ASSUMED | Correctly unresolved. My installs also resolved from the warm store |
| The KeeperHub source snapshot and seam checklist deliverable exists | REFUTED | Correct and honestly unresolved |

The `REFUTED` row is the one the brief singles out, and it is handled the way it should be.
The Phase 0 exit-gate row at `docs/phase-logs/PHASE_00.md:205` is struck through and marked
FAIL with the reason. `docs/BUILD_STATE.md:174` lists it as a known defect and an outstanding
input to Phase 0.5. Nothing anywhere depends on it: I grepped for every mention and all four
are the correction itself. Phase 0 remediation is not failed for the absence of a Phase 0.5
deliverable, because the ledger now records the gap accurately and no higher claim rests on it.

Six `MEASURED_EXTERNAL` rows remain and all six carry "No artifact committed here". The
vocabulary section states that such a row is uncheckable from this repository and must be
re-measured before anything is said publicly. That is the correct disclosure for evidence
that lives elsewhere.

Eight `ASSUMED` rows now cover the seam behavior `@resurv/keeperhub-client` encodes, under a
heading that says none of it has been reproduced from this repository. `status.ts` no longer
claims a live probe contradicted the documentation; the corrected comment names official
docs, two documents disagreeing, and the sibling spike, and points at the ledger.
`classifyReceiptStatus` is labelled as the hypothesis the probe exists to test.
`errors.ts` imports `ORG_API_KEY_PREFIX` and `WEBHOOK_KEY_PREFIX` rather than hardcoding them.

Forbidden wording: I swept `docs`, `apps`, `packages/*/src`, `packages/*/test` and `CLAUDE.md`
for trustless, multi-transaction rollback, private mempool, exactly-once, production ready and
MEV protection. Every hit is a negative usage stating the wording is forbidden or refuted.
`.claude/settings.json` is not called a sandbox anywhere, and the word now appears in the
forbidden list.

### CI note, not a ledger failure

The claim's evidence is the test file and the test file works. Two things a reader should
know. This repository has no git remote, so no CI job has ever run. And the `javascript` job
as written cannot pass on a clean runner: `pnpm typecheck` resolves to ten turbo tasks
including `contracts#typecheck` (`forge build --sizes`), and `pnpm build` includes
`contracts#build` (`forge build`), while that job installs no Foundry toolchain and checks out
no submodules. The `policy` job, which is the one the claim depends on, installs pnpm and runs
`@resurv/repo-policy` with `fetch-depth: 0` and would work. This is a pre-existing workflow
defect that the remediation did not introduce and did not touch. I record it because
`PHASE_00_REMEDIATION.md:435` says the detector "runs on every CI job", and it runs in one.

---

## 12. Full gate — **PASS**

Source tree, cache bypassed:

```
TURBO_FORCE=true pnpm gate                          exit 0
  typecheck        Tasks: 10 successful, 10 total   Cached: 0 cached, 10 total
  test             Tasks: 10 successful, 10 total   Cached: 0 cached, 10 total
  test:integration Tasks:  2 successful,  2 total   Cached: 0 cached,  2 total
  test:e2e         Tasks:  2 successful,  2 total   Cached: 0 cached,  2 total
  build            Tasks:  3 successful,  3 total   Cached: 0 cached,  3 total
  contracts test              26 tests passed
  contracts test:invariant     5 invariants passed
git status --short                                  empty
```

Fresh clone, no relationship to the source checkout:

```
git clone --recurse-submodules /Users/mac/resurv clones/a    exit 0
git submodule status    bf647bd forge-std, 5fd1781 openzeppelin-contracts
pnpm install --frozen-lockfile                               exit 0, 138 resolved, 138 reused
TURBO_FORCE=true pnpm gate                                   exit 0
  Cached: 0 of 10, 0 of 10, 0 of 2, 0 of 2, 0 of 3
  contracts test 26, contracts test:invariant 5
git status --short                                           empty
```

The gate script contains all nine required commands, verified by reading
`package.json` and by C9 in section 2, which fails the suite when one is removed. Both runs
are genuine executions, not replays. `git status` is clean in the source tree and in the
clone.

The warm-store caveat stands and I did not clear it either: my installs also resolved 138 of
138 packages from the local content-addressable store, and `forge` found solc 0.8.36 in the
local cache. The `ASSUMED` ledger row for a cold-network install is the honest status.

---

## Findings

| ID | Finding | Section | Severity | Blocks Phase 0.5? |
|---|---|---|---|---|
| N1 | Host credential paths (`~/.wrangler`, `~/.config/gh`, `~/.npmrc`, `~/.docker`, `~/.claude.json`, `$VAR` echo) are read with no prompt; the repository's matcher does not model the built-in read-only command set | 1 | MEDIUM | No |
| N3 | Root `package.json` scripts are auto-approved and enumerated by no test | 2 | MEDIUM | No |
| N2 | `turbo deploy`, `wrangler  deploy` and `cast  send` miss the deny patterns and fall to prompt | 1 | LOW | No |
| N4 | The `.gitignore` correspondence test is a substring check a sibling line satisfies | 2 | LOW | No |
| N5 | `docs/CLAIMS.md:65` says "matches PRD 9.1 exactly" for a transcription that adds one inferred edge | 3, 11 | LOW | No |
| N6 | `redact` throws on a throwing getter while `knownSecretValues` is guarded; `onError` calls both | 7 | LOW | No |
| N7 | A declared secret under six characters survives under an innocent key | 7, 11 | LOW | No |
| N8 | `git submodule status` output transcribed as `(v5.6.1)` in two documents; it prints `(v4.8.0-1122-g5fd1781b)` | 9 | LOW | No |

Recommended before Phase 0.5, none of them blocking, all cheap: add deny rules for
`~/.wrangler`, `~/.config/gh`, `~/.npmrc` and `~/.docker` (N1), and extend the workspace-script
enumeration to root scripts (N3). Recommended before Phase 1: N5 and N7 are wording, N6 is a
`try`/`catch`.

## Verdict on the four blocking findings

**F6-A, permission bypass through a wrapper. Resolved.** Sixty-eight command forms evaluated
against the committed rules by a matcher I wrote from the vendor's documentation without
reading the repository's own. Every external-write path, direct or wrapped, reaches deny.
Every allow rule is an exact match or a narrow read-only wildcard. Reintroducing either of the
two runner prefix rules fails the committed suite. The residual is real, disclosed in T10 and
T11, and enlarged by N1 and N3 rather than contradicted by them.

**F4-A through F4-G, self-referential invariants. Resolved.** Two reference models that import
nothing from production, in a representation that could not be confused with it. Twenty-three
mutations, every one caught by the suite that should catch it, including seven this review
invented and one composite designed specifically to defeat the invariant suite, which the unit
tests and the cross-language comparison caught instead. `fail_on_revert = true` demonstrated
operative by injection. Coverage reported behaviorally and my measurements match the published
figures.

**F6-B, shallow redaction. Resolved.** Thirty-four independent adversarial cases through the
real serializer, across every container form the brief names and several it does not, all
clean. Two edges recorded as N6 and N7, neither a leak of a realistic credential.

**F6-C and F6-D, CI secret check narrower than described. Resolved.** Fourteen genuinely
tracked fixtures caught, three example forms allowed, the real suite failing on tracked state,
and the history scan firing on a file that was committed and then untracked, which is the case
a working-tree scan cannot see.

The remediation's own report is accurate about what it did. The mutation table in it
reproduces, the coverage figures reproduce, the gate figures reproduce, the fresh clone
reproduces, and the submodule correction it made against the original reviewer is the one I
measured too. The claim ledger records the KeeperHub snapshot gap as `REFUTED` and outstanding,
with nothing built on top of it.

**PHASE 0 REMEDIATION INDEPENDENT VALIDATION: PASS**

**LIVE CREDENTIAL ENTRY MAY PROCEED TO PHASE 0.5**

Phase 0.5 was not started by this session. The key must still be pasted by a human in an
ordinary terminal, as `docs/BUILD_STATE.md` requires.

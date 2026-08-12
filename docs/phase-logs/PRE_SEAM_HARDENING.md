# Pre-seam hardening

Date: 2026-08-12. Session: one, scoped to the eight findings in
`docs/phase-logs/PHASE_00_REMEDIATION_INDEPENDENT_REVIEW.md`. Base commit: `864dd7f`.

Phase 0 remediation passed independent re-validation and the reviewer cleared live credential
entry. This pass runs before that happens, so that adding a `kh_` key does not land in a
repository where an obvious exfiltration path is one unprompted command away.

No live secret existed at any point during this pass. No KeeperHub call was made, nothing was
deployed, and Phase 0.5 was not started. `.env` does not exist in this repository.

Verdict: **PRE-SEAM HARDENING: PASS**.

---

## What changed, in one table

| Fix | Finding | Change |
|---|---|---|
| A | N1 MEDIUM | Host credential stores and environment dumping are denied. `packages/repo-policy` models the built-in read-only command set and the `$`-pattern defect. New suite: `credential-surfaces.test.ts` |
| B | N3 MEDIUM | `approved-scripts.ts` resolves every allow rule into the script graph it can reach, root scripts included, and pins the reviewed bodies. New suite: `approved-scripts.test.ts` |
| C | CI note | CI is reorganized by toolchain need, with an aggregate gate job. New suite: `ci-workflow.test.ts` derives the requirement from the script graph |
| — | N2 LOW | Deny spellings added for `turbo deploy`, double-spaced `wrangler  deploy` and `cast  send` |
| — | N4 LOW | The `.gitignore` correspondence test compares lines, not substrings |
| — | N5 LOW | `docs/CLAIMS.md` no longer says the state machine matches PRD 9.1 "exactly" |
| — | N6 LOW | `redact` no longer throws on a hostile property getter |
| — | N7 LOW | The redaction claim carries its length qualifier |
| — | N8 LOW | `docs/RUNBOOKS.md` transcribes what `git submodule status` actually prints |

Nothing already closed by the independent review was reopened.

---

## 1. Three vendor behaviors, measured

The brief said to research the current official permission matching behavior before editing
rules. `https://code.claude.com/docs/en/permissions` was fetched and read on 2026-08-12. It
confirmed the model in `packages/repo-policy/src/bash-rules.ts` on evaluation order, wildcard
positions, the `:*` suffix, compound splitting, the stripped wrapper set and the
known-safe-assignment rule. It added three things the repository's model did not carry, and
probing the live session added a fourth the documentation does not mention at all.

### 1.1 The built-in read-only set runs with no prompt

Documented, and quoted here because everything else follows from it:

> Claude Code recognizes a built-in set of Bash commands as read-only and runs them without a
> permission prompt in every mode. These include `ls`, `cat`, `echo`, `pwd`, `head`, `tail`,
> `grep`, `find`, `wc`, `which`, `diff`, `stat`, `du`, `cd`, and read-only forms of `git`. The
> set is not configurable; to require a prompt for one of these commands, add an `ask` or
> `deny` rule for it.

So `decide()` returning `prompt` is not "the user is asked". For `cat`, `grep`, `find`, `head`
and `echo` it means "runs immediately". Every Phase 0 assertion of the form
`expect(decide(cmd, rules)).not.toBe('allow')` was satisfiable by a command that executed. This
is the second half of N1 and it is now modeled: `BUILTIN_READ_ONLY_HEADS`,
`BUILTIN_READ_ONLY_GIT_SUBCOMMANDS`, `isBuiltinReadOnly` and `runsWithoutPrompt`.

### 1.2 `Write(path)` rules are never consulted

Also documented: Claude Code checks file permissions against `Edit(path)` and `Read(path)`
only, accepts a `Write`, `NotebookEdit` or `Glob` path rule, never consults it, and warns at
startup. `.claude/settings.json` carried `Write(./.env)` in deny. It was doing nothing except
producing a startup warning. Deleted; `Edit(./.env)` covers every file-editing tool including
Write.

The same section gives the gitignore-style path syntax, which is why the `Read` deny rules that
were written as `//Users/mac/.ssh/**` are now `~/.ssh/**`. The old form worked on one machine.

### 1.3 An `ask` rule was measured not to prompt

Not documented; measured in this session, twice, against rules that have been committed since
the Phase 0 remediation:

| Command | Rule | Tier | Outcome |
|---|---|---|---|
| `jq --version` | `Bash(jq *)` | ask | ran, no prompt |
| `sed -n 1p package.json` | `Bash(sed *)` | ask | ran, no prompt |
| `ls -d ~/.npmrc` | `Bash(*.npmrc*)` | deny | **denied** |

The permission mode a session starts in is resolved by the client rather than by `defaultMode`
in `.claude/settings.json`, so the project cannot assert which tier prompts. The consequence is
ADR-010: everything load-bearing is a `deny` rule, `ask` records intent, and no document may
describe an `ask` rule as a control. `docs/CLAIMS.md` now forbids that wording.

### 1.4 A Bash pattern containing `$` matches nothing

Not documented anywhere. Found by writing the obvious rule and testing it.

| Probe | Rule intended to stop it | Outcome |
|---|---|---|
| `ls -d ~/.zshrc` | `Bash(*~/.*)` | **denied** |
| `ls -d $HOME/.zshrc` | `Bash(*$HOME/.*)` | ran, no prompt |
| `echo $HOME` | `Bash(*echo $*)` | ran, no prompt |
| `echo $KEEPERHUB_API_KEY` | `Bash(*KEEPERHUB_API_KEY*)` | **denied** |
| `ls -d $HOME/.zshrc` | `Bash(*HOME/.*)` after the rewrite | **denied** |

The shape is consistent with the pattern being compiled to a regular expression without
escaping `$`, which then anchors at end-of-input. The cause does not matter; the effect is that
such a rule reads as a control in the settings file and blocks nothing.

Two consequences. First, every `$`-bearing rule was rewritten to a `$`-free equivalent: the
home-path catch-all is `Bash(*~/.*)` plus `Bash(*HOME/.*)`, `Bash(*/Users/*/.*)` and
`Bash(*/home/*/.*)`, and the environment-variable rules name the variable rather than its
expansion. Second, `patternIsInert` models the behavior, `decide` ignores an inert pattern the
way the engine does, and a test fails if one is ever committed. ADR-011.

---

## 2. Fix A, credential read surfaces

### The gap, restated

`docs/THREAT_MODEL.md` lists the KeeperHub API key as an asset living in `.env` and in a Worker
secret. Creating or replacing that Worker secret requires a Cloudflare OAuth token, which lives
in `~/.wrangler/config/default.toml`. That file was named by no rule, and `cat` cannot be
un-approved. The credential governing the asset was outside the boundary drawn around the
asset.

Measured before the change, in this session:

```
ls -d ~/.npmrc ~/.wrangler ~/.claude.json ~/.config/gh
/Users/mac/.claude.json
/Users/mac/.config/gh
/Users/mac/.npmrc
/Users/mac/.wrangler
```

All four exist on this machine. The command ran with no prompt.

### The rules added

Deny, because ask does not stop anything here:

- Named stores, spelling-independent because a substring rule matches every spelling of the
  path: `Bash(*.wrangler*)`, `Bash(*.cloudflared*)`, `Bash(*.config/gh/*)`,
  `Bash(*gh/hosts.yml*)`, `Bash(*.npmrc*)`, `Bash(*.yarnrc*)`, `Bash(*.claude.json*)`,
  `Bash(*.credentials.json*)`, `Bash(*.docker/*)`, `Bash(*gcloud*)`, `Bash(*.kube/*)`,
  `Bash(*.gnupg/*)`, `Bash(*.netrc*)`, `Bash(*.git-credentials*)`, `Bash(*.config/op/*)`,
  `Bash(*.config/supabase/*)`.
- Home-directory catch-alls for the stores nobody enumerated: `Bash(*~/.*)`,
  `Bash(*HOME/.*)`, `Bash(*/Users/*/.*)`, `Bash(*/home/*/.*)`.
- The declared secret variables by name, which is the only thing that works given 1.4:
  `Bash(*KEEPERHUB_API_KEY*)`, `Bash(*SUPABASE_SERVICE_ROLE_KEY*)`, `Bash(*DATABASE_URL*)`,
  plus the generic `Bash(*API_KEY*)`, `Bash(*ACCESS_KEY*)`, `Bash(*SECRET*)`,
  `Bash(*_TOKEN*)`, `Bash(*TOKEN_*)`, `Bash(*PASSWORD*)`, `Bash(*PASSPHRASE*)`,
  `Bash(*PRIVATE_KEY*)`, `Bash(*CREDENTIALS*)`, `Bash(*SERVICE_ROLE*)`, `Bash(*MNEMONIC*)`.
- Environment dumping in every form found: `printenv*`, `env`, `env *`, `*/bin/env`,
  `*/bin/env *`, `*/bin/printenv*`, `export`, `*export -p*`, `declare`, `*declare -p*`,
  `typeset`, `set`, `*compgen -v*`, `*compgen -e*`.
- macOS keychain: `Bash(*security find-generic-password*)`,
  `Bash(*security find-internet-password*)`.

Ask, kept for the modes that honor it and as a record of intent: `export *`, `declare *`,
`typeset *`, `set *`, `compgen *`, `security find-*`, and the exec wrappers the documentation
says always prompt (`watch`, `setsid`, `ionice`, `flock`).

Read deny rules were rewritten from `//Users/mac/...` to `~/...` and extended to `~/.wrangler`,
`~/.config/.wrangler`, `~/.cloudflared`, `~/.config/gh`, `~/.npmrc`, `~/.claude.json`,
`~/.claude/.credentials.json`, `~/.docker`, `~/.kube`, `~/.gnupg`, `~/.netrc`,
`~/.git-credentials`, `~/.config/op` and `~/.config/supabase`. `Write(./.env)` was deleted and
`Edit(./.wrangler/**)` added.

### Verified live, after the change

```
ls -d ~/.npmrc                      denied
ls -d ~/.zshrc                      denied
ls -d $HOME/.zshrc                  denied
ls -d /Users/mac/.npmrc ...         denied
echo $KEEPERHUB_API_KEY             denied
```

And the other half of the trade, in the same session:

```
cat package.json | head -3          ran
ls docs | head -3                   ran
grep -rn CovenantStatus packages/domain/src   ran
git status --short                  ran
```

One more piece of live evidence worth recording: the mutation harness for this pass was first
written as an inline Bash script, and the harness itself was denied, because its text contained
`KEEPERHUB_API_KEY` and `$HOME/.ssh`. The rules bite on the session that wrote them.

### The cost, stated plainly

`grep -rn API_KEY packages/` no longer works from Bash. The Grep tool does, because file tools
and Bash rules are separate surfaces. `cat ~/.zshrc` no longer works, which nothing in this
project needs. `docs/RUNBOOKS.md` lists the four deliberate refusals so the next session does
not file them as bugs.

### Residual, honestly

- The enumeration is of credential stores we thought of. A tool that invents a new one is
  covered only if it puts it under the home directory.
- An ask-tier interpreter (`sed`, `jq`, `awk`, `rg`, `node -e`) still runs in a session where
  ask auto-approves. What stops it reaching a credential is that the path is denied, and a
  secret in a file whose path no rule names is still readable. T11 said this and still does.
- None of it is OS-level enforcement. A subprocess that opens a file itself is outside Claude
  Code's reach, which the vendor documentation states. Sandbox mode is not adopted.
- The observed permission mode is a property of the client session. Nothing in the repository
  can assert it, and a different mode changes which tier prompts.

---

## 3. Fix B, auto-approved script drift

### What the review proved

`Bash(pnpm lint)` approves a name. The body is a `package.json` string the permission engine
never sees. C8 appended `&& wrangler deploy` to the root `lint` script and survived 157 tests.
C8b added `"ship": "wrangler versions upload"` with a matching allow rule and survived too.
Eleven root scripts were auto-approved and enumerated by nothing.

### What was built

`packages/repo-policy/src/approved-scripts.ts`. Three independent controls over one resolved
graph.

**Resolution.** Each allow rule is followed through `pnpm <script>`,
`pnpm --filter <pkg> <script>` and `turbo run <task>` into the workspace, breadth-first and
cycle-safe. `turbo.json`'s `dependsOn` is read rather than assumed, and a `^` prefix walks the
real dependency graph. 51 scripts are reachable today.

The turbo expansion was checked against turbo rather than trusted. `turbo run <task> --dry=json`
for all six reachable tasks, compared against the model:

| Task | Reaches `contracts` | Model agrees |
|---|---|---|
| `typecheck` | `contracts#typecheck` | yes |
| `test` | `contracts#test` | yes |
| `build` | `contracts#build` | yes |
| `clean` | `contracts#clean` | yes |
| `test:integration` | nothing | yes |
| `test:e2e` | nothing | yes |

The first draft over-approximated `^build` as "every package's build", which made
`test:e2e` look like it compiled contracts. Turbo says otherwise, because nothing defining
`test:e2e` depends on `contracts`. The model now walks the dependency graph and matches.

**Structural.** Every leaf must match `APPROVED_LEAF_COMMANDS`, anchored at both ends: biome,
`tsc --noEmit`, vitest, vite, `wrangler dev`, `wrangler deploy --dry-run --outdir <path>`,
forge for build/fmt/test/coverage/clean, `drizzle-kit generate`, and `rm -rf` restricted to
relative paths. An unrecognized binary fails whether or not anyone predicted it, which is what
covers `npx`, `pnpm dlx`, `node scripts/x.js` and any future deployment tool.

**Inventory and body pin.** The reachable set must equal `REVIEWED_AUTO_APPROVED_SCRIPTS`, and
each body must still be the reviewed text. Adding an allow rule for a new script fails until
the script is reviewed and added; editing a reviewed body fails until the manifest is updated.

### Mutation results

Ten mutations, each applied to the working tree, suite run, file restored, hashes compared. The
harness is `scratchpad/mutate.py` and the restored files were byte-identical.

| # | Mutation | Result |
|---|---|---|
| D1 | root `lint` gains `&& wrangler deploy` (review C8, previously **survived**) | caught |
| D2 | new root `ship` script plus `Bash(pnpm ship)` (review C8b, previously **survived**) | caught |
| D3 | worker `build` loses `--dry-run` (review C7) | caught |
| D4 | deny rule for `~/.npmrc` deleted | caught |
| D5 | deny rule for `~/.wrangler` deleted | caught |
| D6 | home-dotfile catch-all deleted | caught |
| D7 | `KEEPERHUB_API_KEY` deny rule deleted | caught |
| D8 | `KEEPERHUB_API_KEY` deny rule demoted to `ask` | caught |
| D9 | an inert `$`-bearing pattern added | caught |
| D10 | `printenv` deny deleted | caught |

D4, D5, D7 and D8 survived the first run of the harness. Not because the boundary was weak, but
because a sibling rule covered the same fixture: with `Bash(*.npmrc*)` gone, `cat ~/.npmrc` is
still denied by `Bash(*~/.*)`. That is the exact shape of N4, and it was fixed the same way:
`CREDENTIAL_STORES_OUTSIDE_HOME` adds spellings no catch-all reaches (`cat ../.npmrc`), and
`REQUIRED_DENY_RULES` asserts rule presence directly, which is what catches a demotion to `ask`
that a behavioral fixture cannot see.

### What this is not

A drift guard, not an integrity control. Anyone with commit access can edit `package.json`, the
manifest and the test in one change and nothing will object. It stops the accident and the
unnoticed edit, which is the class of failure that actually happened here. `docs/THREAT_MODEL.md`
T14 says so in the same words.

---

## 4. Fix C, CI that can pass

### The defect

The `javascript` job ran `pnpm typecheck` and `pnpm build` while installing no Foundry
toolchain and checking out no submodules. Both fan out to `forge`. It also ran
`pnpm exec biome check .` in place of `pnpm lint`, which is the same command with the contracts
half removed, so the workaround for its own gap was already in the file. It had never been
observed failing because this repository has no git remote and no CI run has ever happened.

### The decision

`pnpm typecheck`, `pnpm test`, `pnpm lint` and `pnpm build` stay cross-stack. They are the
commands `CLAUDE.md` declares required. Splitting them so a CI job could avoid a toolchain
would make CI test something other than the gate. So the job that runs them installs the whole
toolchain, and the workflow is organized by need. ADR-012.

| Job | Installs | Runs |
|---|---|---|
| `workspace` | pnpm, Node, Foundry, submodules | `format:check`, `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build` |
| `contracts` | Foundry, submodules | `forge fmt --check`, `forge build --sizes`, `forge test -vv`, the invariant run |
| `policy` | pnpm, Node, `fetch-depth: 0` | `@resurv/repo-policy` |
| `gate` | nothing | `needs` the other three, `if: always()`, fails unless all succeeded |

`gate` is the single check to require on a branch protection rule when a remote exists.

### The guard

`packages/repo-policy/test/ci-workflow.test.ts` derives "needs Foundry" from
`scriptNeedsFoundry`, which walks the same graph Fix B built. It also asserts that `policy`
installs no Foundry, so the split cannot decay into "install everything everywhere", that every
job running pnpm installs the workspace with `--frozen-lockfile`, that the aggregate job depends
on all the others, and that every one of the nine required gate commands is executed by some
job, directly or as the body it resolves to.

`src/ci-workflows.ts` is a shallow structural reader, not a YAML parser, and says so. The
lockfile is pinned and adding a YAML dependency for this was not worth it.

Three mutations against the workflow:

| # | Mutation | Result |
|---|---|---|
| C-a | `workspace` loses the Foundry toolchain | caught |
| C-b | `workspace` loses `submodules: recursive` | caught |
| C-c | `workspace` stops running `pnpm lint` | caught |

### Executed locally, under the CI profile

The workspace job's commands are exactly the gate, run below. The contracts job's four commands
were run in `packages/contracts` with `FOUNDRY_PROFILE=ci`:

```
forge fmt --check                              exit 0
forge build --sizes                            exit 0
forge test -vv                                 26 passed
forge test --match-path 'test/invariant/*' -vv  5 passed
```

The honest limit: no CI run has happened and none can, because there is no remote. The claim in
`docs/CLAIMS.md` is `ASSUMED` and says exactly that. What changed is that the jobs are now
capable of passing, which the previous ones were not.

---

## 5. Low-severity findings

| ID | Disposition |
|---|---|
| N2 | Fixed. `Bash(*turbo deploy*)`, `Bash(*turbo * deploy)`, `Bash(*turbo * deploy *)`, `Bash(*wrangler *deploy)`, `Bash(*wrangler *deploy *)`, `Bash(*cast *send*)`. Checked that `wrangler deployments list` still resolves to allow: the deny patterns require `deploy` at end-of-string or followed by a space, and `deployments` gives neither |
| N4 | Fixed. `tracked-secrets.test.ts` builds a set of trimmed non-comment `.gitignore` lines and asserts membership, so deleting `secrets/` is no longer satisfied by `.secrets/` |
| N5 | Fixed. The claim row now reads "transcribes PRD 9.1, with one inferred edge" and names `TRIGGERED -> SATISFIED` as the inference, which is what the model files have said in a comment all along |
| N6 | Fixed. `redactContainer` walks `safeEntries`, which reads each own enumerable property inside a `try` and yields `[unreadable]` on a throw. The `Error` branch reads `name`, `message` and `stack` the same way. Five new tests in `packages/config/test/redact.test.ts`, including the proxy that throws on every read |
| N7 | Fixed as wording, not as code. The claim now says "No declared secret of six characters or more". `MIN_KNOWN_SECRET_LENGTH = 6` stays: it is what keeps redaction from shredding ordinary text, and no realistic key is that short |
| N8 | Fixed. `docs/RUNBOOKS.md` prints the real two lines and explains why `git submodule status` describes `5fd1781b` as `v4.8.0-1122-g5fd1781b` while the pin is v5.6.1. `docs/VERSIONS.md` carries the same note |

Deferred, with reasons:

- **The `(v5.6.1)` transcription in `docs/phase-logs/PHASE_00_REMEDIATION.md:414`.** Left as
  written. Phase logs are a record of what a session did and said at the time, and editing one
  after the fact makes the log series less trustworthy, not more. The correction lives in
  `docs/RUNBOOKS.md`, which is the document a reader follows, and in this log.
- **The `pnpm test` description at `PHASE_00_REMEDIATION.md:379`,** which calls it "275
  TypeScript tests" when `turbo run test` also runs the 26 Foundry tests. Same reason. The
  split table in `docs/BUILD_STATE.md` is correct and is the canonical one.
- **`ARMED -> EXPIRED` has no edge in PRD 9.1,** so an armed covenant whose deadline passes has
  no modeled path to a terminal state. The reviewer raised this as advisory rather than a
  finding, and they were right: the model is faithful to the PRD, and the question belongs to
  the covenant contract in Phase 1. Recorded here so it is not rediscovered.
- **`Bash(*forge *create*)` and `Bash(*forge *script*)` were considered and not added.**
  `forge script` without `--broadcast` is a legitimate simulation and sits in `ask`; a deny
  rule on the double-spaced spelling would have denied the single-spaced one too and taken a
  working command away from Phase 1. `--broadcast` and `forge create` are already denied at any
  position.

---

## 6. Secret policy for Phase 0.5

Prepared, not populated. `.env` does not exist in this repository and no live credential has
ever been here.

| | |
|---|---|
| Variable | `KEEPERHUB_API_KEY` |
| Shape | organization key beginning `kh_`. A `wfb_` webhook key cannot execute |
| File | `.env` at the repository root, copied from `.env.example` |
| Created by | a human, in an ordinary terminal, before the Phase 0.5 session opens |
| Read by | the test or Worker process, at runtime |

The value is not in this document and will not be in any document. `DATABASE_URL`,
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are optional in `serverSecretsSchema` and Phase
0.5 needs none of them.

A repository-local ignored file rather than an exported shell variable, deliberately. A
variable in the environment is reachable by `printenv`, by `env`, and by every process that
inherits it, and it lives for the whole terminal session. A file is reachable only by something
that opens it, and this one is denied to `Read`, to `Edit` and to any Bash command naming it.
The environment-dump forms are denied anyway, and the variable name is denied on a command line,
so both paths are closed rather than one.

`docs/RUNBOOKS.md` carries the operational version of this, including the one thing Phase 0.5
has to build: a loader. Node does not read `.env` by itself, `--env-file=.env` would put the
filename on a command line the deny rules block, and vitest only exposes `VITE_`-prefixed
variables. The loader is a vitest setup module reading the file with `node:fs`, referenced from
`vitest.config.ts` rather than from a command line. It is not built here, because building it
now would ship untested code with no consumer and would be the first step of Phase 0.5.

---

## 7. Validation

All commands run from a clean tree at the end of the pass.

```
pnpm format:check                                   exit 0
pnpm lint                                           exit 0
pnpm --filter @resurv/repo-policy test              381 passed
pnpm --filter @resurv/config test                    38 passed
TURBO_FORCE=true pnpm gate                          exit 0
  typecheck        Tasks: 10 successful, 10 total   Cached: 0 cached, 10 total
  test             Tasks: 10 successful, 10 total   Cached: 0 cached, 10 total
  test:integration Tasks:  2 successful,  2 total   Cached: 0 cached,  2 total
  test:e2e         Tasks:  2 successful,  2 total   Cached: 0 cached,  2 total
  build            Tasks:  3 successful,  3 total   Cached: 0 cached,  3 total
  contracts test              26 tests passed
  contracts test:invariant     5 invariants passed
```

Test counts, re-derived rather than carried forward:

| Suite | Before | After |
|---|---|---|
| `@resurv/domain` | 34 | 34 |
| `@resurv/keeperhub-client` | 30 | 30 |
| `@resurv/config` | 33 | 38 |
| `@resurv/db` | 7 | 7 |
| `@resurv/chain` | 7 | 7 |
| `@resurv/worker` | 7 | 7 |
| `@resurv/repo-policy` | 157 | 381 |
| `@resurv/web` | 0 | 0 |
| **TypeScript substantive** | **275** | **504** |
| Foundry total | 26 | 26 |

`@resurv/repo-policy` is mostly parameterized fixtures: one case per blocked command, per
permitted command, per auto-approved script. 381 assertions there is not equivalent to 381
assertions about the product, and `docs/BUILD_STATE.md` repeats that.

Fresh clone with submodules, no relationship to the source checkout:

```
git clone --recurse-submodules /Users/mac/resurv <scratch>/clone   exit 0
pnpm install --frozen-lockfile                                     exit 0
TURBO_FORCE=true pnpm gate                                         exit 0
```

`git status --short` was empty in the source tree after the commit and empty in the clone.

No live secret existed during any of it.

---

## 8. Findings this pass leaves open

| Finding | Why it is not closed |
|---|---|
| A secret in a repository file whose path no rule names is readable by an unprompted `grep` | T11 residual, unchanged. The mitigation is that no such file exists, enforced by the tracked-secret detector |
| `ask` is advisory under the observed permission mode | Cannot be fixed from this repository. ADR-010 routes everything load-bearing through `deny` instead |
| No CI run has ever happened | There is no git remote. The jobs are capable of passing; that is the whole claim |
| A cold-network install is unproven | Both this pass and every previous one resolved from a warm local store. `ASSUMED` in the ledger |
| The reference models are hand transcriptions of PRD 9.1 | Unchanged from the remediation. A misreading is mirrored in both languages and no test objects |
| The KeeperHub source snapshot and seam checklist does not exist | `REFUTED` in the ledger, outstanding input to Phase 0.5 |

---

**PRE-SEAM HARDENING: PASS**

Phase 0.5 was not started. No KeeperHub key was requested, created or read. Nothing was
deployed. The next action is unchanged and still belongs to a human: create `.env` from
`.env.example`, paste the `kh_` organization key, and open a fresh session with
`docs/prompts/PHASE_00_5_SEAM_PROBE.md`.

# @resurv/repo-policy

Facts this repository asserts about itself, written as tests instead of as prose.

Nothing here ships. It exists because three separate Phase 0 controls read like controls and
were not: a permission tier that a wrapper walked straight through, a secret detector that was
one regex missing five categories, and a set of invariants that asked the implementation which
inputs it would accept. Each was found by a reader, not by the suite. These tests are the
suite catching the next one.

Run it with `pnpm --filter @resurv/repo-policy test`. CI runs it in the `policy` job with
`fetch-depth: 0`, which is load-bearing: the tracked-secret check reads reachable history, and
a shallow clone cannot answer it.

## What each file holds up

| File | Asserts |
|---|---|
| `test/permission-boundary.test.ts` | The proven bypasses stay denied. No allow rule combines a command runner with a wildcard tail. Every `pnpm --filter` rule names a script that exists. Ordinary development stays autonomous |
| `test/credential-surfaces.test.ts` | Host credential stores outside this repository, the declared secret variable names, and every environment-dump form resolve to `deny`. No committed pattern is inert |
| `test/approved-scripts.test.ts` | Every script an allow rule can reach still runs the reviewed command graph, root scripts included |
| `test/workspace-scripts.test.ts` | Scripts reachable through turbo perform no external write. The gate contains every required command. Foundry cannot reach the filesystem or the shell from a test |
| `test/tracked-secrets.test.ts` | No secret-bearing file is tracked, or ever was in reachable history. The detector agrees with `.gitignore` line by line |
| `test/cross-language-state-machine.test.ts` | The Solidity and TypeScript enums and reference models agree, compared by parsing both source files |
| `test/ci-workflow.test.ts` | Every committed CI job can pass on a clean runner, and the aggregate gate depends on all of them |
| `test/bash-rules.test.ts` | The permission matcher itself behaves the way the vendor documents |

## Three things worth knowing before changing any of it

**`decide()` returning `prompt` does not mean a human is asked.** Claude Code runs a built-in
set of read-only commands, `cat` and `grep` and `find` among them, with no prompt in every
mode. `runsWithoutPrompt` is the predicate to assert against for anything security-relevant.
A test written as `expect(decide(cmd, rules)).not.toBe('allow')` passes for a command that
executes immediately, and that is exactly how the credential-read gap survived Phase 0.

**A Bash pattern containing `$` matches nothing.** Measured, not documented. `patternIsInert`
models it, `decide` ignores such a pattern the way the engine does, and a test fails if one is
committed. See ADR-011.

**Only `deny` blocks.** `ask` was measured to auto-approve under the permission mode this
project's sessions run in. See ADR-010.

## Adding a command Claude Code may run

1. Add a narrow exact allow rule to `.claude/settings.json`. Never a wildcard over a runner.
2. If it names a package script, add `<package>#<script>` to
   `REVIEWED_AUTO_APPROVED_SCRIPTS` in `src/approved-scripts.ts` with the exact body.
3. If the body uses a binary the graph does not know, add an entry to
   `APPROVED_LEAF_COMMANDS` with a pattern anchored at both ends, and a `why` that says what
   the command touches.
4. Run the suite. If it still passes, the change is reviewed by construction.

Editing a script body that is already on the list fails step 4 until the manifest is updated
to match. That is the guard, and it is why the manifest pins exact strings rather than shapes.

## What none of this is

Not a sandbox. Permission rules are enforced by Claude Code for its own tools and for file
commands it recognizes in Bash, and not for a subprocess that opens a file itself. Not
protection against a contributor who edits the policy and the test in the same change; it is a
drift guard against the accident and the unnoticed edit. `docs/THREAT_MODEL.md` T10, T11, T13
and T14 state the residual risk in full, and `docs/CLAIMS.md` forbids describing any of it as
a sandbox.

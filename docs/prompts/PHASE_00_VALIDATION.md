# Phase 0 independent validation prompt

Run in a **fresh Claude Code session**. Not the session that produced Phase 0: the author
re-deriving their own conclusions from their own assumptions is not validation.

Do not let the reviewing session read this file's surrounding docs first. Paste the block
below as the opening message.

---

```text
Read CLAUDE.md, RESURV_PRD_v1.0.md section 28 Phase 0, docs/phase-logs/PHASE_00.md,
docs/CLAIMS.md, docs/DECISIONS.md, docs/VERSIONS.md, docs/THREAT_MODEL.md,
docs/ARCHITECTURE.md, and docs/BUILD_STATE.md.

Independently verify the Phase 0 PASS claim.

Do not trust the phase log, BUILD_STATE, previous summaries, or claimed test counts.
Reproduce the evidence yourself.

Do not fix anything during this review.

Run `pnpm gate` yourself and compare the real output against the Phase 0 report.

Then adversarially evaluate:

1. Does any command CLAUDE.md declares required fail, silently skip meaningful work, or
   pass only because there are zero tests or --passWithNoTests-style behavior?

2. Is any claim in docs/CLAIMS.md assigned a stronger evidence level than the underlying
   evidence warrants? Run the claim-auditor subagent.

3. Does the KeeperHub client encode any behavior that has not actually been measured or
   supported by the recorded documentation/evidence? Run the keeperhub-integrator subagent.

4. Can any Foundry invariant falsely pass because handlers are unreachable, preconditions
   eliminate meaningful states, selectors are insufficiently exercised, or the invariant
   merely restates implementation behavior? Run the test-reviewer subagent.

5. Do ADR-001 and ADR-004 in docs/DECISIONS.md genuinely justify departing from PRD
   section 14.2, or are they post-hoc rationalization?

6. Are .gitignore, .claude/settings.json, CI secret-detection checks, config-redaction
   behavior, or environment handling weaker than their documentation suggests?

7. Verify the fresh-clone claim independently:
   - clone the repository into a fresh temporary directory
   - include submodules
   - run `pnpm install --frozen-lockfile`
   - run `pnpm gate`
   - confirm no untracked local state from the source checkout is required

8. Audit the TypeScript 7.0.2 decision specifically. Determine whether any current
   dependency, Cloudflare tooling, generated types, React tooling, test tooling, Drizzle
   tooling, or lint tooling is relying on behavior that is only accidentally working under
   TypeScript 7. Do not downgrade merely because TypeScript 7 is new. Report whether
   keeping 7.0.2 is defensible and what concrete evidence supports that conclusion.

9. Verify that zero-spec integration and E2E suites are honestly represented as Phase 0
   scaffolding rather than being counted as substantive test coverage.

10. Check docs/BUILD_STATE.md against the actual repository and verify that another fresh
    Claude Code session could continue without relying on hidden context from the previous
    session.

For every item return exactly:
- PASS or FAIL
- evidence inspected
- commands executed
- concrete finding
- severity if failed

Finish with one overall verdict:

PHASE 0 INDEPENDENT VALIDATION: PASS
or
PHASE 0 INDEPENDENT VALIDATION: FAIL

Do not change repository files.
Do not begin Phase 1.
```

---

## Known weak points the author already flagged

Listed so the reviewer can confirm or refute them rather than rediscover them, and so a
reviewer that misses all of them is itself a signal:

- `test:integration` and `test:e2e` contain zero specs and pass via `--passWithNoTests`.
- Proof-ladder rungs 2 and 3 are marked PARTIAL: the tests cover the reference state
  machine, not a covenant contract, which does not exist.
- Six KeeperHub claims are `MEASURED_EXTERNAL`, measured from `keeperhub-flightcheck` and
  not from this repository.
- The Claude Code deny list is pattern-matched on command strings and is not a sandbox.
- The invariant handler is a hand-written state machine, so item 4 above is the sharpest
  question in the list: it may prove only that the handler agrees with itself.

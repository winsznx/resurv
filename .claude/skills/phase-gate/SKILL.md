---
name: phase-gate
description: Run when completing a RESURV PRD phase. Verifies deliverables, tests, evidence, claims, and forbidden work before declaring the phase complete.
disable-model-invocation: false
---

1. Read the target phase in `RESURV_PRD_v1.0.md`.
2. List every required deliverable and exit criterion.
3. Inspect git diff and current test output.
4. Run the focused and phase-gate commands.
5. Invoke the relevant reviewer subagent.
6. Confirm `docs/CLAIMS.md`, `docs/VERSIONS.md`, threat model, and deployment docs are current.
7. Confirm no forbidden work entered the phase.
8. Produce a table with PASS, FAIL, or NOT PROVEN for each criterion.
9. Do not declare completion while any required item is FAIL or NOT PROVEN.

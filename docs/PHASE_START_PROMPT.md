# Claude Code phase start prompt

Replace `<N>` and paste into a fresh named Claude Code session.

```text
Read RESURV_PRD_v1.0.md, CLAUDE.md, docs/CLAIMS.md, docs/THREAT_MODEL.md,
and the current repository. Work on Phase <N> only.

First enter plan mode and inspect the code. Produce:
1. the current-state summary,
2. the exact files to change,
3. the invariants affected,
4. the tests that must fail before implementation,
5. the phase exit gate,
6. any claim in CLAIMS.md that this work may change.

Do not implement until the plan is coherent. Do not weaken an invariant, skip a
failing test, introduce arbitrary calldata, expose secrets, or claim behavior that
has not been reproduced. After implementation, run the focused tests and full phase
gate, ask the relevant reviewer subagent to challenge the result, fix findings, and
update durable documentation before committing.
```

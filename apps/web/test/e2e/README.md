# Browser end-to-end tests

Empty on purpose, and the emptiness is the point of this file.

`pnpm test:e2e` runs `vitest run --dir test/e2e --passWithNoTests`. Until a spec lands here,
that command exits 0 while asserting nothing. Phase 0 required the command to exist; it did not
require coverage. The Phase 0 independent review found that `apps/web/test` did not exist at
all, so the command was pointed at nothing.

The first real specs belong to the proof-page phase: load the page against a recorded attempt
and assert that what the browser shows matches what the chain says.

Counted as `E2E harness: 0 specs` in `docs/BUILD_STATE.md`, never inside the substantive test
total.

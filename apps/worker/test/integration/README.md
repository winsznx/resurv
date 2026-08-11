# Worker integration tests

Empty on purpose, and the emptiness is the point of this file.

`pnpm test:integration` runs `vitest run --dir test/integration --passWithNoTests`. Until a
spec lands here, that command exits 0 while asserting nothing. Phase 0 required the command to
exist; it did not require coverage, and a green result must not be read as one. The Phase 0
independent review also found that this directory did not exist at all, so the command was
pointed at nothing.

The first real specs belong to the orchestrator phase: the Worker's `queue` and `scheduled`
entry points under the Workers pool, with a KeeperHub double, covering crash recovery between
persisting an idempotency key and reading the 202.

Counted as `integration harness: 0 specs` in `docs/BUILD_STATE.md`, never inside the
substantive test total.

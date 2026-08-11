# Build state

Canonical handoff document. Read this first in a new session. Updated at the end of every
phase.

Last updated: 2026-08-11, end of Phase 0.

## Where we are

| | |
|---|---|
| Current phase | Phase 0 complete. Phase 1 not started. |
| Completed phases | 0 |
| Active gate | Phase 0 exit gate: PASS |
| Submission deadline | 2026-08-13 12:00 UTC+2 |

## Session order

Fixed by the operator. Each step runs in a fresh session, and the prompt for each is
committed under `docs/prompts/` so no step depends on conversational memory.

1. Phase 0 independent validation. `docs/prompts/PHASE_00_VALIDATION.md`
2. If PASS, Phase 0.5 seam probe. `docs/prompts/PHASE_00_5_SEAM_PROBE.md`
3. If `SEAM PASS`, the autonomous run. `docs/prompts/PHASE_01_TO_10_AUTONOMOUS.md`
4. If `SEAM REVISE`, redesign the attempt boundary before writing core contracts.
5. After the build completes, a fresh session for adversarial review and submission prep.

### Blocking prerequisite for step 2

`.env` does not exist in this repository. Phase 0.5 forbids the session from copying a
credential out of another repository, so without this it halts immediately:

```bash
cp .env.example .env    # then paste the kh_ organization key
```

Nothing else is required. The revert probe needs no contract deployment, no deployer key and
no faucet. See the fixture note in `docs/prompts/PHASE_00_5_SEAM_PROBE.md`.

## Next exact task

Probe the KeeperHub revert path before writing any covenant code.

Deploy a contract whose function always reverts, call it through
`POST /api/execute/contract-call` with `simulate: false`, and record what comes back: whether
an `executionId` and `transactionHash` are returned, what `status` settles to, what
`receiptStatus` says, and whether the revert reason survives.

This is the single unmeasured seam that RESURV's entire thesis depends on. A false outcome
reverting the whole atomic attempt is the product. If a reverted broadcast is
indistinguishable from a transport failure, the proof page cannot tell that story and the
architecture needs to change before, not after, the contract is written.

Estimated 20 minutes. Everything else in Phase 1 is downstream of the answer.

## Architecture as built

One Cloudflare Worker (`fetch` today; `scheduled` and `queue` reserved) serving `/api/*` and
the built SPA as static assets. Six workspace packages. Foundry for contracts. Full detail in
`docs/ARCHITECTURE.md`, deviations from the PRD in `docs/DECISIONS.md`.

## Deployed resources

None. No contract is deployed, no Worker is deployed, no database is connected.

| Resource | Status |
|---|---|
| Covenant contract | does not exist |
| Demo vault, action, verifier | do not exist |
| Worker | builds, not deployed |
| Supabase project | not provisioned |

## KeeperHub

No execution has been performed from this repository. Rung 5 of the proof ladder is not
reached here.

A sibling project, `keeperhub-flightcheck`, has landed a real Base Sepolia transaction through
KeeperHub and produced the seam measurements now recorded in `docs/CLAIMS.md` as
`MEASURED_EXTERNAL`. Those are strong prior information and are not RESURV's own evidence.

The organization API key exists in that project's `.env` and has scopes
`mcp:read mcp:write mcp:admin`. It has not been copied into this repository. Copying it is a
manual step and the value must never be echoed.

## Tests

85 total, all passing.

| Suite | Count |
|---|---|
| `@resurv/domain` | 17 |
| `@resurv/keeperhub-client` | 30 |
| `@resurv/config` | 7 |
| `@resurv/db` | 7 |
| `@resurv/chain` | 7 |
| `@resurv/worker` | 5 |
| `@resurv/web` | 0 |
| `contracts` unit and fuzz | 9 |
| `contracts` invariant | 3 |

Fuzz: 512 runs per test. Invariants: 256 runs at depth 64, 16,384 handler calls each, 0
reverts, 0 counterexamples.

## Commands, all verified working

`pnpm gate` runs the whole sequence and exits 0. See `docs/RUNBOOKS.md`.

## Unresolved blockers

None blocking right now.

## Unresolved assumptions

Tracked in `docs/CLAIMS.md`. The ones that will bite first:

1. A reverted broadcast is distinguishable from a transport failure. `ASSUMED`, unmeasured,
   and it is the next task.
2. `msg.sender` at a RESURV contract equals the org wallet under sponsorship. Measured against
   a different contract in another repository. Must be re-measured against ours, because all
   access control depends on it and getting it wrong means every attempt reverts.
3. A crash between send and response cannot double-submit. The derivation and schema exist and
   are unit-tested; the kill-the-network replay has not been run.

## Known defects and limitations

- `test:integration` and `test:e2e` run with `--passWithNoTests` and currently contain zero
  specs. The commands exist and exit 0, which satisfies the Phase 0 gate but must not be
  mistaken for coverage. First real specs land with the orchestrator and the proof page.
- `@resurv/web` has no tests and no product UI. Deliberate: Phase 0 forbids UI work.
- Supabase is designed but unwired. Repository interfaces exist; no driver implementation.
- No hooks configured in `.claude/settings.json` despite PRD 29.4 mentioning them. Deferred as
  low value against the deadline.
- The Claude Code permission deny list is pattern-matched on command strings. It stops the
  obvious form of a destructive command and not a rewrite. Treat it as a speed bump.

## Scope deliberately cut against the deadline

Recorded so nobody assumes these were forgotten: `packages/agent`, `packages/observability`,
`packages/sdk`, `packages/ui`, operator auth tables (`users`, `organizations`,
`organization_members`), OpenTelemetry wiring, and Docker Compose. Each belongs to a later
phase or to a stack the deployment constraint removed.

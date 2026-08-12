# Build state

Canonical handoff document. Read this first in a new session. Updated at the end of every
phase.

Last updated: 2026-08-12, end of the pre-seam hardening pass.

## Where we are

| | |
|---|---|
| Current phase | Phase 0 complete, remediated, independently re-validated, and hardened. Phase 0.5 not started. Phase 1 not started. |
| Completed phases | 0, the Phase 0 remediation, the pre-seam hardening pass |
| Active gate | Phase 0 remediation independent validation: **PASS**. See `docs/phase-logs/PHASE_00_REMEDIATION_INDEPENDENT_REVIEW.md` |
| Submission deadline | 2026-08-13 12:00 UTC+2 |

Read the phase logs in order, because the earlier ones contain figures the later ones
disproved:

1. `PHASE_00.md` — self-graded PASS. Contains numbers the review refuted.
2. `PHASE_00_INDEPENDENT_REVIEW.md` — FAIL, four blocking findings.
3. `PHASE_00_REMEDIATION.md` — the answer to those four.
4. `PHASE_00_REMEDIATION_INDEPENDENT_REVIEW.md` — PASS, eight new non-blocking findings, and
   clearance for live credential entry.
5. `PRE_SEAM_HARDENING.md` — closes those eight before a credential arrives. PASS.

## Session order

Fixed by the operator. Each step runs in a fresh session, and the prompt for each is
committed under `docs/prompts/` so no step depends on conversational memory.

1. Phase 0 independent validation. `docs/prompts/PHASE_00_VALIDATION.md` — **done, FAIL**
2. Phase 0 remediation — **done**
3. Phase 0 remediation independent re-validation — **done, PASS**
4. Pre-seam hardening — **done, PASS**, this is the current state
5. Phase 0.5 seam probe. `docs/prompts/PHASE_00_5_SEAM_PROBE.md` — **next**, blocked on the
   human prerequisite below
6. If `SEAM PASS`, the autonomous run. `docs/prompts/PHASE_01_TO_10_AUTONOMOUS.md`
7. If `SEAM REVISE`, redesign the attempt boundary before writing core contracts.
8. After the build completes, a fresh session for adversarial review and submission prep.

### Blocking prerequisite for the seam probe

No environment file exists in this repository, and no live secret has ever been placed here.
Phase 0.5 forbids the session from copying a credential out of another repository, so a human
has to create the file and paste the `kh_` organization key before that session starts.

The variable is `KEEPERHUB_API_KEY`. It is the only one required. The file is `.env` at the
repository root, copied from `.env.example`. `docs/RUNBOOKS.md` has the full path under "The
one local secret Phase 0.5 needs", including the loader Phase 0.5 has to add, and the reasons
a repository-local ignored file beats an exported shell variable.

This is deliberately not something an agent session can do: the permission boundary denies
Bash commands that name the environment file or the variable, denies reading, editing and
writing the file, and denies every environment-dump form. Do it in an ordinary terminal.
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

Counted so the number cannot flatter itself. Substantive tests are tests that assert
something; the two empty harnesses are listed separately and never folded into a total.

| Suite | Count |
|---|---|
| `@resurv/domain` | 34 |
| `@resurv/keeperhub-client` | 30 |
| `@resurv/config` | 38 |
| `@resurv/db` | 7 |
| `@resurv/chain` | 7 |
| `@resurv/worker` | 7 |
| `@resurv/repo-policy` | 381 |
| `@resurv/web` | 0 |
| **TypeScript substantive total** | **504** |
| `contracts` unit and fuzz | 21 |
| `contracts` invariant | 5 |
| **Foundry total** | **26** |

| Harness | Specs |
|---|---|
| `pnpm test:integration` (`apps/worker/test/integration`) | **0** |
| `pnpm test:e2e` (`apps/web/test/e2e`) | **0** |

Both harnesses exit 0 with `--passWithNoTests`. Their commands existing is what the Phase 0
gate required. It is not coverage and it is not counted. Phase 0 reported "85 tests total"
across 73 TypeScript and 12 Foundry; the figures were right and the framing invited a reader
to include the empty suites, so the split above is now explicit.

`@resurv/repo-policy` is large because it is mostly parameterized fixtures: one case per
blocked command, per permitted command, per secret path, per auto-approved script. That is the
shape the work needs, and 381 assertions there is not equivalent to 381 assertions about the
product. It grew from 157 during the pre-seam hardening pass, which added the credential
surfaces, the auto-approved script graph and the CI workflow policy.

Fuzz: 512 runs per test. Invariants: 256 runs at depth 64. Every one of the 16,384 handler
calls per invariant is a real transition attempt, roughly 8 to 15 of which mutate state per
run, across 3 to 5 covenant lifecycles, covering 20 to 33 distinct ordered pairs per run. The
handler prints those figures in `afterInvariant`. The Phase 0 framing of "16,384 calls" as
strength of evidence was misleading: most of those calls were guaranteed early returns.

## Commands, all verified working

`pnpm gate` runs every command `CLAUDE.md` declares required and exits 0. It did not before
the remediation: `test:integration` and `test:e2e` were missing from it while two documents
called it the full sequence. See `docs/RUNBOOKS.md`.

Turbo caching means a green `pnpm gate` can be a replay of an earlier log. For evidence, use
`TURBO_FORCE=true pnpm gate` and check that `Cached: 0`.

## Unresolved blockers

None blocking the seam probe. F6-A, the permission bypass that did block it, is fixed and
regression-tested; the remediation log records the evidence. The eight findings the
independent re-validation raised are closed or explicitly deferred in
`docs/phase-logs/PRE_SEAM_HARDENING.md`.

The only outstanding input is human: `.env` with a `kh_` organization key under
`KEEPERHUB_API_KEY`.

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

- `test:integration` and `test:e2e` run with `--passWithNoTests` and contain zero specs. The
  commands exist and exit 0, which satisfies the Phase 0 gate but must not be mistaken for
  coverage. First real specs land with the orchestrator and the proof page.
- `@resurv/web` has no tests and no product UI. Deliberate: Phase 0 forbids UI work.
- Supabase is designed but unwired. Repository interfaces exist; no driver implementation.
- No hooks configured in `.claude/settings.json` despite PRD 29.4 mentioning them. Deferred as
  low value against the deadline.
- The Claude Code permission boundary is configuration checked by our own tests, not a
  sandbox. A command that reads a secret without naming a protected path is not stopped. See
  `docs/THREAT_MODEL.md` T10, T11, T13 and T14 for what it does and does not cover.
- An `ask` rule was measured not to prompt in the permission mode this project's sessions run
  in. Only `deny` blocked. Everything load-bearing is a deny rule; `ask` records intent. See
  ADR-010. Nothing in this repository can assert which mode a session starts in.
- A Bash permission pattern containing `$` matches nothing, so such a rule reads as a control
  and is not one. Undocumented by the vendor, measured here, guarded by a test. See ADR-011.
- No CI job has ever run, because this repository has no git remote. The jobs are now capable
  of passing on a clean runner, which the Phase 0 form of the JavaScript job was not.
- The auto-approved script manifest is a drift guard, not an integrity control. A contributor
  who edits `package.json`, the manifest and the test in one change defeats it. T14.
- The state machine evidence is about a pure library. No covenant contract exists, so every
  `VERIFIED (model only)` row in the ledger says nothing about escrow, fees or atomicity.
- The reference models are hand transcriptions of PRD 9.1. A misreading would be mirrored in
  both languages and no test would object.
- The KeeperHub source snapshot and seam checklist that PRD 2429 names, and that the Phase 0
  log marked PASS, does not exist. It is an outstanding input to Phase 0.5.
- Eight seam behaviors encoded in `@resurv/keeperhub-client` are `ASSUMED` with no committed
  source pointer. They are inputs to the probe, not conclusions from it.
- Every reproduction so far has resolved dependencies from a warm local store. A genuinely
  cold-network install is unproven.

## Scope deliberately cut against the deadline

Recorded so nobody assumes these were forgotten: `packages/agent`, `packages/observability`,
`packages/sdk`, `packages/ui`, operator auth tables (`users`, `organizations`,
`organization_members`), OpenTelemetry wiring, and Docker Compose. Each belongs to a later
phase or to a stack the deployment constraint removed.

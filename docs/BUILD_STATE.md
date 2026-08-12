# Build state

Canonical handoff document. Read this first in a new session. Updated at the end of every
phase.

Last updated: 2026-08-12, end of the Phase 0.5 preparation pass.

## Where we are

| | |
|---|---|
| Current phase | Phase 0.5 **started and blocked**. Everything that does not need a credential is done; the measurement is not. Phase 1 not started. |
| Completed phases | 0, the Phase 0 remediation, the pre-seam hardening pass |
| Active gate | Phase 0.5: **`USER ACTION REQUIRED`**, no seam verdict issued. See `docs/phase-logs/PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md` |
| Submission deadline | 2026-08-13 12:00 UTC+2 |

Read the phase logs in order, because the earlier ones contain figures the later ones
disproved:

1. `PHASE_00.md` — self-graded PASS. Contains numbers the review refuted.
2. `PHASE_00_INDEPENDENT_REVIEW.md` — FAIL, four blocking findings.
3. `PHASE_00_REMEDIATION.md` — the answer to those four.
4. `PHASE_00_REMEDIATION_INDEPENDENT_REVIEW.md` — PASS, eight new non-blocking findings, and
   clearance for live credential entry.
5. `PRE_SEAM_HARDENING.md` — closes those eight before a credential arrives. PASS.
6. `PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md` — the source lock, the fixture verification and
   the whole probe. No measurement, because no credential exists here. `USER ACTION REQUIRED`.

## Session order

Fixed by the operator. Each step runs in a fresh session, and the prompt for each is
committed under `docs/prompts/` so no step depends on conversational memory.

1. Phase 0 independent validation. `docs/prompts/PHASE_00_VALIDATION.md` — **done, FAIL**
2. Phase 0 remediation — **done**
3. Phase 0 remediation independent re-validation — **done, PASS**
4. Pre-seam hardening — **done, PASS**
5. Phase 0.5 seam probe. `docs/prompts/PHASE_00_5_SEAM_PROBE.md` — **started, `USER ACTION
   REQUIRED`**. The source lock, the fixture verification and the whole probe are done and
   committed. The measurement is not, because no credential exists here. This is the current
   state
6. Phase 0.5 completion: paste the key, run one command, read the evidence, issue the verdict
7. If `SEAM PASS`, the autonomous run. `docs/prompts/PHASE_01_TO_10_AUTONOMOUS.md`
8. If `SEAM REVISE`, redesign the attempt boundary before writing core contracts.
9. After the build completes, a fresh session for adversarial review and submission prep.

### The one blocking prerequisite, still open

No environment file exists in this repository and no live secret has ever been placed here.
The Phase 0.5 session checked all five runtime configuration paths this repository establishes
and every credential-shaped variable name visible to the process, and found nothing. The
verbatim output is in the phase log, section 2.

The variable is `KEEPERHUB_API_KEY`. It is the only one required. The file is `.env` at the
repository root, copied from `.env.example`.

```bash
cp .env.example .env    # then paste the kh_ organization key with an editor
pnpm --filter @resurv/seam-probe test:seam
```

The first line is deliberately not something an agent session can do: the permission boundary
denies Bash commands that name the environment file or the variable, denies reading, editing
and writing the file, and denies every environment-dump form. Do it in an ordinary terminal.

Nothing else is required. The probe needs no contract deployment, no deployer key and no
faucet, and the fixture it uses is already verified from this repository.

## Next exact task

Run the probe. It is built.

`pnpm --filter @resurv/seam-probe test:seam` runs twelve scenarios, writes one evidence file
each under `docs/phase-logs/evidence/phase-00-5/`, and takes a few minutes. Then read the
evidence, write the behavioral test file that pins what was observed, replace section 7 of the
phase log with the measured lifecycle, and issue `SEAM PASS`, `SEAM REVISE` or `SEAM FAIL`.

The question it settles is still the single unmeasured seam RESURV's thesis depends on: whether
a reverted broadcast is distinguishable from a transport failure. A false outcome reverting the
whole atomic attempt is the product. If those two are indistinguishable, the proof page cannot
tell that story and the architecture has to change before the contract is written, not after.

`docs/keeperhub/SEAM_CHECKLIST.md` tracks which of the twelve states each scenario settles.

## Architecture as built

One Cloudflare Worker (`fetch` today; `scheduled` and `queue` reserved) serving `/api/*` and
the built SPA as static assets. Seven workspace packages. Foundry for contracts. Full detail in
`docs/ARCHITECTURE.md`, deviations from the PRD in `docs/DECISIONS.md`.

`packages/seam-probe` is the newest and is not a product package. It exists to measure the
KeeperHub attempt seam and to keep that measurement reproducible. Its offline half runs in the
gate; its live half spends a credential and lands transactions and is reachable from no
auto-approved command.

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

What Phase 0.5 did add: `docs/keeperhub/SOURCE_SNAPSHOT.md`, the PRD 28 deliverable that Phase 0
marked PASS without producing. Eleven official pages retrieved 2026-08-12, every behavior graded
`DOCUMENTED`, `DOCUMENTED (conflicting)`, `INFERRED`, `ASSUMED`, `REFUTED` or
`REQUIRES MEASUREMENT`, and a section listing the ten behaviors the documentation does not state
at all. Nine ledger rows moved on the strength of it and none of them was a behavioral row.

Two findings from that reading are worth carrying in your head:

- `safe_inner_failure` is a documented receipt status, and gas sponsorship documentation
  explains why: a Safe route makes the outer transaction succeed while the inner call fails. A
  receipt with status `0x1` therefore does not prove a RESURV attempt succeeded.
  `docs/THREAT_MODEL.md` T15.
- The vendor documents three different error envelope shapes on two pages.
  `packages/keeperhub-client/src/errors.ts` parses one of them.

A sibling project, `keeperhub-flightcheck`, has landed a real Base Sepolia transaction through
KeeperHub and produced the seam measurements recorded in `docs/CLAIMS.md` as
`MEASURED_EXTERNAL`. Those are strong prior information and are not RESURV's own evidence.

The organization API key exists in that project's environment file. It has not been copied into
this repository and no session may copy it. Creating the local credential is a manual step and
the value must never be echoed.

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
| `@resurv/repo-policy` | 391 |
| `@resurv/seam-probe` | 29 |
| `@resurv/web` | 0 |
| **TypeScript substantive total** | **543** |
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
shape the work needs, and 391 assertions there is not equivalent to 391 assertions about the
product. It grew from 157 during the pre-seam hardening pass, which added the credential
surfaces, the auto-approved script graph and the CI workflow policy, and by 10 in Phase 0.5,
which added the live-seam-probe boundary.

`@resurv/seam-probe`'s 28 are the offline half only: the evidence sanitizer, the fail-closed
writer, and semantic attempt identity. Its twelve live scenarios assert nothing yet because
nothing has been measured.

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

One, and it is the same one, still human: `.env` at the repository root with a `kh_`
organization key under `KEEPERHUB_API_KEY`. Phase 0.5 verified its absence rather than assuming
it, across five paths and every credential-shaped variable name, and stopped there.

Everything downstream of that key is blocked: the entire seam measurement, the canonical attempt
state machine, and therefore the covenant contract's shape. Everything upstream of it is done.

F6-A, the permission bypass that used to block the probe, is fixed and regression-tested. The
eight findings the independent re-validation raised are closed or explicitly deferred in
`docs/phase-logs/PRE_SEAM_HARDENING.md`.

One smaller thing Phase 0.5 could not do: adding an `ask` entry for the live seam command to
`.claude/settings.json` was refused by the permission classifier, so that file is untouched. It
costs nothing, because ADR-010 already records that `ask` does not prompt in this project's
sessions. The controls that carry weight are the absence of an allow rule, the external-effect
classification in `packages/repo-policy`, and the absence of a credential.

## Unresolved assumptions

Tracked in `docs/CLAIMS.md`. The ones that will bite first:

1. A reverted broadcast is distinguishable from a transport failure. `ASSUMED`, unmeasured, and
   it is still the next task. The experiment now exists: `packages/seam-probe` scenarios `P09`,
   `P10` and `P11`.
2. Whether KeeperHub pre-simulates a `simulate: false` request and refuses to broadcast
   something it predicts will revert. Undocumented, and it decides the seam verdict.
3. `msg.sender` at a RESURV contract equals the org wallet under sponsorship. Measured against
   a different contract in another repository. Must be re-measured against ours, because all
   access control depends on it and getting it wrong means every attempt reverts.
4. A crash between send and response cannot double-submit. The derivation and schema exist and
   are unit-tested; the kill-the-network replay is built (`P11`) and has not been run.
5. A transaction receipt with status `0x1` proves the attempt succeeded. It does not, if
   execution ever routes through a Safe: `safe_inner_failure` is a documented receipt status.
   T15.

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
- `packages/keeperhub-client/src/errors.ts` parses one of the three error envelope shapes the
  vendor documents. Not fixed in Phase 0.5, because choosing which shape the live endpoint
  actually emits without measuring it would be guessing. `P02` decides it.
- Twelve live seam scenarios are built and assert nothing, because nothing has been measured.
  A green `pnpm gate` says nothing about them; they are not in it.
- Every reproduction so far has resolved dependencies from a warm local store. A genuinely
  cold-network install is unproven.

## Scope deliberately cut against the deadline

Recorded so nobody assumes these were forgotten: `packages/agent`, `packages/observability`,
`packages/sdk`, `packages/ui`, operator auth tables (`users`, `organizations`,
`organization_members`), OpenTelemetry wiring, and Docker Compose. Each belongs to a later
phase or to a stack the deployment constraint removed.

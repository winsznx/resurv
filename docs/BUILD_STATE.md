# Build state

Canonical handoff document. Read this first in a new session. Updated at the end of every
phase.

Last updated: 2026-08-12, end of Phase 0.5.

## Where we are

| | |
|---|---|
| Current phase | Phase 0.5 **complete**. Phase 1 not started. |
| Completed phases | 0, the Phase 0 remediation, the pre-seam hardening pass, Phase 0.5 |
| Active gate | Phase 0.5: **`SEAM REVISE`**. KeeperHub is usable; the planned attempt lifecycle was falsified and is replaced. See `docs/phase-logs/PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md` sections 8 and 9, and ADR-013 |
| Submission deadline | 2026-08-13 12:00 UTC+2 |

Read the phase logs in order, because the earlier ones contain figures the later ones
disproved:

1. `PHASE_00.md` — self-graded PASS. Contains numbers the review refuted.
2. `PHASE_00_INDEPENDENT_REVIEW.md` — FAIL, four blocking findings.
3. `PHASE_00_REMEDIATION.md` — the answer to those four.
4. `PHASE_00_REMEDIATION_INDEPENDENT_REVIEW.md` — PASS, eight new non-blocking findings, and
   clearance for live credential entry.
5. `PRE_SEAM_HARDENING.md` — closes those eight before a credential arrives. PASS.
6. `PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md` — the source lock, the fixture, the probe, and
   the live measurement. `SEAM REVISE`. **Read sections 2, 8 and 9 before writing any contract
   or orchestrator code**: they are the measured facts, the lifecycle, and the advancement rule.

## Session order

Fixed by the operator. Each step runs in a fresh session, and the prompt for each is
committed under `docs/prompts/` so no step depends on conversational memory.

1. Phase 0 independent validation. `docs/prompts/PHASE_00_VALIDATION.md` — **done, FAIL**
2. Phase 0 remediation — **done**
3. Phase 0 remediation independent re-validation — **done, PASS**
4. Pre-seam hardening — **done, PASS**
5. Phase 0.5 seam probe. `docs/prompts/PHASE_00_5_SEAM_PROBE.md` — **done, `SEAM REVISE`**.
   16 scenarios measured live, evidence committed
6. Phase 1, against the corrected lifecycle. `docs/prompts/PHASE_01_TO_10_AUTONOMOUS.md`
7. After the build completes, a fresh session for adversarial review and submission prep.

### The credential

`KEEPERHUB_API_KEY` in `.env` at the repository root, an organization key beginning `kh_`. It
exists on this machine now and is git-ignored. Creating and rotating it stays a human step: the
permission boundary denies every path an agent session could take to it.

Re-running the probe needs nothing else. No contract deployment, no deployer key, no faucet.

## Next exact task

Phase 1, and it starts from a specification rather than from a guess.

Read `docs/phase-logs/PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md` sections 8 and 9 and ADR-013,
then build the attempt state machine in `packages/domain` alongside the covenant one, with the
same reference-model treatment ADR-009 requires. The covenant contract follows.

Three measured facts that change what gets written, all of which falsified the previous plan:

1. **HTTP 202 does not mean broadcast.** A refused attempt and a successful one both answer 202
   with an `executionId`. Read the body's `status`, and confirm on chain.
2. **A new idempotency key repeats the economic action.** KeeperHub bounds effects per key, not
   per action, so the covenant must reject a replayed semantic attempt id permanently.
3. **Access control keys on `0xfd35ae935de7be93ffd585d6627268d833ed834c`**, the organization
   wallet, which appears only in the decoded event. `receipt.from` is a relayer.

The one thing Phase 0.5 could not settle: how a reverted broadcast presents, because a reverting
call never becomes a broadcast with an unfunded wallet. `REVERTED` is in the lifecycle anyway.

`docs/keeperhub/SEAM_CHECKLIST.md` records what each of the twelve attempt states measured to
and what is still open.

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

**Rung 5 of the proof ladder is reached.** Sixteen scenarios ran live on 2026-08-12, four times
over. The committed run holds 30 HTTP exchanges and 5 Base Sepolia transactions, every one
reconciled against two independent RPC origins, under
`docs/phase-logs/evidence/phase-00-5/`. No KeeperHub row in `docs/CLAIMS.md` carries
`MEASURED_EXTERNAL` any more; each was re-measured from here.

Carry these five in your head:

1. **HTTP 202 is not acceptance.** A call that never reached the chain answered 202 with an
   `executionId` and `status: "failed"`. The body decides, not the status code.
2. **Transport idempotency is not semantic idempotency.** A new key for the same action executed
   it a second time. The onchain attempt id is the only permanent guard.
3. **`msg.sender` at the target is the organization wallet**, `0xfd35ae935de7be93ffd585d6627268d833ed834c`,
   while `receipt.from` is a relayer and `receipt.to` a router. Authorize on the former, verify
   by decoding the log.
4. **A lost response is genuinely ambiguous and genuinely resolvable.** The identical abort
   committed in some runs and not others, decided by about nine milliseconds. Replaying the key
   resolves it, a 409 conflict sometimes names the original execution, and the chain always
   answers. Every recovery ended with **at most one** effect, never two.
5. **A reverting call is refused before broadcast** on this configuration, three of three, and
   the error blames a balance shortfall rather than the revert. So the reverted-broadcast state
   was never observed, and a funded wallet may behave differently.

`safe_inner_failure` remains a documented hazard that was never observed. What Phase 0.5 added
is where to look for it: `result.executedCall.reverted` and `receipts[].receiptStatus`, never
the outer receipt status. `docs/THREAT_MODEL.md` T15.

The organization API key lives in a git-ignored file created by a human. No session may copy one
from a sibling repository, and the value must never be echoed.

## Tests

Counted so the number cannot flatter itself. Substantive tests are tests that assert
something; the two empty harnesses are listed separately and never folded into a total.

| Suite | Count |
|---|---|
| `@resurv/domain` | 34 |
| `@resurv/keeperhub-client` | 36 |
| `@resurv/config` | 38 |
| `@resurv/db` | 7 |
| `@resurv/chain` | 7 |
| `@resurv/worker` | 7 |
| `@resurv/repo-policy` | 391 |
| `@resurv/seam-probe` | 71 |
| `@resurv/web` | 0 |
| **TypeScript substantive total** | **591** |
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

`@resurv/seam-probe`'s 71 are the offline half only. Twenty-nine cover the evidence sanitizer,
the fail-closed writer and semantic attempt identity; forty-two read the committed evidence
and assert the Phase 0.5 report's own findings, so a claim cannot drift away from its artifact
without failing the gate. The sixteen live scenarios are not in the gate and are not counted.

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

None. The credential exists, the seam is measured, and Phase 1 has a specification to build
against rather than a hypothesis.

F6-A, the permission bypass that used to block the probe, is fixed and regression-tested. The
eight findings the independent re-validation raised are closed or explicitly deferred in
`docs/phase-logs/PRE_SEAM_HARDENING.md`.

One smaller thing Phase 0.5 could not do: adding an `ask` entry for the live seam command to
`.claude/settings.json` was refused by the permission classifier, so that file is untouched. It
costs nothing, because ADR-010 already records that `ask` does not prompt in this project's
sessions. The controls that carry weight are the absence of an allow rule and the
external-effect classification in `packages/repo-policy`.

## Unresolved assumptions

Tracked in `docs/CLAIMS.md`. Phase 0.5 closed most of the KeeperHub ones. What is left, in the
order it will bite:

1. **How a reverted broadcast presents.** The experiment ran and could not reach the state: a
   reverting call is refused before broadcast with an unfunded wallet, and `gasLimitMultiplier`
   is ignored. The residual is that a funded wallet may reach the chain and revert. Fund the org
   wallet and repeat `P09` to settle it.
2. **`safe_inner_failure` in practice.** Never observed. A receipt with status `0x1` still does
   not prove an attempt succeeded, and the surface to watch is `result.executedCall.reverted`.
   T15.
3. **`msg.sender` at a RESURV contract.** Measured against the canary, not against a covenant.
   All access control depends on it and getting it wrong means every attempt reverts.
4. **The 24-hour idempotency boundary**, and whether an idempotency key is scoped per key, per
   organization or per endpoint. Neither is documented. The onchain attempt id is what covers
   both.
5. **Every remaining rung of the proof ladder above 5.** No covenant contract exists, so nothing
   is yet known about escrow, fees or atomicity beyond a pure library.

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

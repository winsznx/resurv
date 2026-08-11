# Autonomous build prompt: Phase 1 through final production validation

Run in a fresh session, only after Phase 0 validation returns PASS **and** Phase 0.5 returns
`SEAM PASS`.

If Phase 0.5 returns `SEAM REVISE`, amend the mission section to carry the required
architecture change before starting. If it returns `SEAM FAIL`, do not run this at all.

```text
RESURV Phase 0 and Phase 0.5 have passed independent validation.

You are now authorized to execute the remaining RESURV implementation autonomously from
Phase 1 through the final production-validation phase.

Read before changing anything: CLAUDE.md, RESURV_PRD_v1.0.md, docs/BUILD_STATE.md,
docs/CLAIMS.md, docs/VERSIONS.md, docs/THREAT_MODEL.md, docs/ARCHITECTURE.md,
docs/DECISIONS.md, docs/PROOF_LADDER.md, docs/RUNBOOKS.md, every completed phase log, the
Phase 0.5 KeeperHub attempt-semantics report, design.md, all relevant .claude/agents/*, and
.claude/skills/phase-gate/SKILL.md.

Inspect the repository root for any new branding or visual assets before frontend work.

MISSION

Build RESURV end-to-end to the production and hackathon-proof standard defined by the PRD.

Do not stop between successful phases. Do not ask for approval before proceeding from one
passed phase to the next.

For each phase: read its complete PRD requirements, state its internal proof target,
implement, test, run the appropriate specialist subagents, satisfy its exit gate, write its
phase log, update docs/BUILD_STATE.md, update docs/CLAIMS.md, make a logical local git
commit, and immediately begin the next phase.

A phase may not be marked complete while its gate fails.

AUTHORITY

All normal project engineering inside /Users/mac/resurv is pre-authorized. Continue to obey
the repository boundary and secret policy established in Phase 0.

Do not repeatedly ask for approval for: code edits, file creation, refactors, dependency
installation inside the repo, tests, local servers, Anvil, Foundry builds and tests,
formatting, linting, local git commits, Cloudflare configuration generation, Supabase
migration generation, contract deployment scripts, CI changes, fixture generation,
documentation updates, browser E2E execution, or public read-only RPC verification.

Resolve routine implementation decisions yourself.

EXTERNAL INFRASTRUCTURE

Web-facing deployment remains Cloudflare-only. Database, if required by the accepted
architecture, remains Supabase Postgres. Do not replace either constraint with another
provider.

If deployment credentials are already available in the environment, use them as required by
the PRD.

If deployment or live validation reaches a genuinely blocking user-owned credential,
external account authorization, or funding requirement that is not currently available:
complete every independent task first, preserve a clean passing local state, write the
current phase log up to the external boundary, update BUILD_STATE.md, and stop once with a
concise USER ACTION REQUIRED stating the required secret or resource or funding, the
environment variable name, the expected chain or service, the minimum safe amount if funds
are needed, what has already passed, and the exact next command after it is provided.

Do not stop for anything less.

DEADLINE POLICY

There is limited hackathon time remaining. This changes prioritization, not correctness.

Priority order: 1 dominant mechanism, 2 falsifiable headline proof, 3 security invariants,
4 real KeeperHub execution, 5 independently verifiable target-chain evidence,
6 deterministic retries and reconciliation, 7 deployment reproducibility, 8 public proof
surface, 9 required frontend journey, 10 secondary UX polish, 11 extensions.

Do not sacrifice items 1 through 8 to build items 9 through 11. Do not implement PRD
extensions until the core proof ladder has passed.

Do not add cross-chain outcome covenants, generic policy marketplaces, agent competitions,
ZK proof systems, reverse auctions, generalized insurance, arbitrary agent-generated
calldata, or unnecessary analytics surfaces unless the PRD explicitly requires them for the
current phase gate.

If a later phase contains both required core work and optional expansion, complete the
required work and record the optional item as deferred rather than blocking the build.

DESIGN

design.md is authoritative for visual implementation. Use provided root-level branding
assets. Build the frontend as a real product, not a hackathon template.

The interface must make these states obvious without explanation: covenant funded, armed,
triggered, executing, primary attempt rejected or reverted, fallback active, outcome
verified, success fee released, duplicate attempt rejected, expired or failed or escalated.

The public proof page is not decorative. It must let a judge with no privileged credentials
inspect the covenant, verifier, KeeperHub execution, transaction hashes, status, final
state, outcome receipt, payment or release transaction, and independent verification result.

Never display simulated evidence as live evidence.

TESTING

Maintain and expand the proof ladder. All serious claims require reproducible evidence.

The final repository must support clean-room reproduction from a fresh clone without
developer-specific paths or hidden local state. Use repo-relative paths, environment
variables, deterministic fixtures, explicit setup commands, and documented external
requirements.

Tests depending on KeeperHub, Supabase, Cloudflare, RPC services, or live chains must
clearly distinguish deterministic local coverage, fork or integration coverage, and live
external validation. Never represent lower-rung evidence as higher-rung evidence.

Any live integration required for the submission must have a reproducible command and
documented expected evidence.

CLAUDE SUBAGENTS

Use the specialist agents actively, not ceremonially. At minimum: contracts-auditor after
meaningful contract changes and before deployment, keeperhub-integrator for every KeeperHub
seam and lifecycle change, test-reviewer before each major gate and final proof,
claim-auditor whenever claims are promoted and before final completion.

Resolve their substantive findings before passing the phase. Record accepted or deferred
findings in the phase log.

CONTRACT SECURITY

The contract, not the agent, is the final authority. Maintain the central invariants: only
committed recovery actions can execute; only allowed targets, selectors and recipients can
execute; limits cannot be exceeded; satisfied covenants cannot execute again; expired
covenants cannot execute; the success fee cannot release without verifier satisfaction; the
fee cannot release twice; a duplicate trigger cannot create duplicate economic effects; an
ambiguous KeeperHub attempt cannot cause the controller to advance unsafely; verifier
identity cannot silently change after arming; the recovery-plan commitment cannot silently
change after arming.

Use fuzz and invariant testing to prove these properties beyond examples.

CLAIMS

Never let marketing outrun evidence. Do not claim, unless independently demonstrated:
trustless, rollback of previously confirmed transactions, private routing on Base Sepolia,
atomicity across separate transactions, exactly-once execution merely because KeeperHub
supports idempotency, guaranteed recovery, production readiness, zero MEV, or no third-party
trust.

Promote claims only through the evidence hierarchy in docs/CLAIMS.md.

DEPLOYMENT

When the proof ladder reaches deployment: deploy contracts using reproducible Foundry
scripts, and record chain IDs, deployer, exact git commit, constructor args, contract
addresses; verify source where supported; smoke-test deployed contracts; record KeeperHub
execution IDs and target-chain transaction hashes; independently verify receipts through
RPC; record everything in docs/DEPLOYMENTS.md.

For Cloudflare: use repository-controlled Wrangler configuration, record account-neutral
reproducible instructions, run deployment smoke tests, validate production routes, and
validate that secrets do not leak to client bundles or health responses.

For Supabase: migrations must be committed, schema must reproduce from migrations, RLS
tests are required where relevant, service-role credentials never enter browser bundles, and
the production dependency must not undermine the onchain safety model.

PHASE LOGGING

Continue creating one log per phase under docs/phase-logs/. Every log must contain
objective, implementation, architecture decisions, files changed, exact test commands and
results, external validation, claims changed, security findings, known limitations,
exit-gate checklist, evidence, and next phase.

Update docs/BUILD_STATE.md after every phase. Do not rely on conversational memory for
continuity.

FAILURE POLICY

If a normal bug, test failure, integration incompatibility, deployment problem or dependency
issue occurs, debug it and continue. Do not stop merely because the first implementation
approach failed.

If a PRD assumption is false: record the falsification, update claims, choose the smallest
architecture correction that preserves the dominant mechanism, document the decision, test
the correction, and continue.

Stop only if a user-owned credential or resource or funding action is genuinely required, a
safety-critical architecture decision cannot be resolved from the PRD or evidence, a formal
kill criterion in the PRD is triggered, continuing would require making a knowingly false
public claim, or all required phases are complete.

FINAL COMPLETION GATE

Do not declare RESURV complete merely because all code exists. Completion requires: required
phase gates PASS, pnpm gate PASS, Foundry unit tests PASS, Foundry fuzz tests PASS, invariant
tests PASS, integration tests PASS, E2E tests PASS, security review complete, KeeperHub seam
claims measured in this repository, at least one real KeeperHub-executed target-chain action,
full canonical covenant lifecycle proven, duplicate and replay path proven safe, public proof
page working, independent verifier working, deployments documented, clean-room reproduction
checked, docs/CLAIMS.md audited, final working tree understood, and no fabricated transaction
IDs, test counts, deployment claims or external evidence.

When all required implementation phases are complete, do NOT prepare the hackathon submission
yet. Instead create docs/FINAL_BUILD_REPORT.md containing: product implemented, architecture
actually shipped, deviations from PRD, all phase verdicts, complete test counts, all deployed
resources, contract addresses, KeeperHub execution IDs, transaction hashes, proof-page URL,
Cloudflare deployment URL, verified claims, refuted claims, unresolved assumptions, known
limitations, security findings, reproducibility instructions, exact fresh-clone validation
commands, git commit at final validation, and what a fresh-session reviewer should attack.

Then update docs/BUILD_STATE.md to:

BUILD COMPLETE - AWAITING INDEPENDENT FINAL REVIEW

Stop there. Do not write DoraHacks copy. Do not prepare submission claims. Do not create the
final demo narrative. Do not mark the project submitted.

A fresh independent session will review the completed product before submission preparation.

Begin Phase 1 immediately.
```

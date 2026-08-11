# RESURV repository instructions

## Mission
Build RESURV exactly as specified in `RESURV_PRD_v1.0.md`. RESURV is an outcome-gated execution covenant. A successful atomic attempt executes one committed action, verifies the resulting onchain state, marks the covenant satisfied, and releases the responder fee in the same transaction.

## Source of truth
1. Reproduced chain and KeeperHub behavior.
2. Official current documentation.
3. Tests and verified contract source.
4. The PRD.
5. Assumptions and model output.

Read `docs/CLAIMS.md` before changing integration or public wording.

## Non-negotiable invariants
- A false outcome reverts the entire atomic attempt.
- Success fee transfers at most once.
- No action runs after a terminal state.
- Only committed adapters and config hashes execute.
- Trigger nonce and semantic attempt IDs cannot replay.
- No model output can create raw calldata.
- Chain is the source of truth for terminal state and payment.
- Never claim multi-transaction rollback, trustlessness, private routing, or atomic x402 coupling without evidence.

## Engineering rules
- Work one PRD phase at a time.
- Start large tasks in plan mode.
- Write or update failing tests before implementation when behavior changes.
- Keep TypeScript strict and schemas explicit.
- Use exact pinned dependencies and the lockfile.
- Do not suppress type, lint, security, or test failures.
- Do not add upgradeable proxies in v1.
- Do not expose KeeperHub or model API keys to the browser.
- Do not read `.env*`, keystores, or secret directories.
- Do not deploy mainnet from Claude Code.

## Required checks
Use the actual package scripts once scaffolded. The intended gates are:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm --filter contracts test
pnpm --filter contracts test:invariant
```

## Durable docs
Update these whenever their subject changes:
- `docs/CLAIMS.md`
- `docs/VERSIONS.md`
- `docs/THREAT_MODEL.md`
- `docs/DEPLOYMENTS.md`
- `docs/PROOF_LADDER.md`
- `docs/RUNBOOKS.md`

## Review
Use the relevant project subagent after implementation:
- contracts changes: `contracts-auditor`
- KeeperHub changes: `keeperhub-integrator`
- test or concurrency changes: `test-reviewer`
- submission wording: `claim-auditor`

A phase is not done until its PRD exit gate passes and evidence is committed.

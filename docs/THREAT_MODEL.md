# Threat model

Initial version, Phase 0. Expands each phase as real components land. Assets and trust
boundaries follow PRD 20.1 and 20.2.

Status of each control: `IN PLACE`, `PARTIAL`, `PLANNED`. Nothing is described as in place
because it is intended.

## Assets

| Asset | Where it lives | Worst case |
|---|---|---|
| Escrowed success fees | Covenant contract | Paid to the wrong party, or paid twice |
| Emergency action authority | Committed adapters | An unauthorized action executes |
| KeeperHub organization wallet | KeeperHub / Turnkey | Arbitrary execution as our organization |
| KeeperHub API key | `.env`, Worker secret | Same as above |
| Trigger authority key | Requester's control | Forged trigger |
| Action commitments and config hashes | Covenant contract | Substituted behavior at attempt time |
| Canonical receipts | Database | Fabricated proof |

## Trust boundaries

Browser → Worker → KeeperHub → Turnkey → chain, plus Worker → RPC providers, and inside the
contract: covenant manager → adapter → target protocol, and covenant manager → verifier.

The two boundaries that carry the most risk are covenant manager → adapter, where a malicious
adapter could attempt reentrancy or partial execution, and Worker → KeeperHub, where the
organization wallet can in principle transact without RESURV's involvement at all.

## Threats and controls

### T1. A false outcome is reported as success

The whole product rests on this. Control: the verifier result is read inside the same
transaction as the action, and a false result reverts the entire attempt.
Status: `PLANNED`. The state machine that forbids leaving a terminal state is `IN PLACE` and
invariant-tested; the atomic attempt itself does not exist yet.

### T2. The success fee is released more than once

Control: terminal states are absorbing, so a satisfied covenant cannot re-enter a state from
which the fee is released. Status: `IN PLACE` at the model level, machine-checked by
`invariant_terminalStateIsAbsorbing` against an independent reference model and by an
exhaustive 64-pair equivalence test, and confirmed by mutation. `PLANNED` at the contract
level, which is where the fee actually moves. Until Phase 1 this control is about a pure
library and nothing else.

### T3. A crash between broadcast and response causes a double submission

The realistic failure, not a hypothetical one. `/api/execute/contract-call` returns HTTP 202
with no transaction hash and there is no list-executions endpoint, so a lost response is
genuinely unrecoverable by query.

Controls: the idempotency key and canonical request body hash are persisted before the first
POST; recovery replays the stored key with a byte-identical body; the onchain semantic
attempt id rejects a replay permanently, beyond KeeperHub's 24-hour transport window.
Status: `PARTIAL`. Key derivation, canonical serialization and the schema columns are
`IN PLACE` and unit-tested. The kill-the-network replay test is `PLANNED`.

### T4. A model produces raw calldata

Control: adapters are capabilities. The adapter address and its config hash are committed
before arming, so the set of possible actions is fixed before any trigger exists, and the
planner selects among them rather than composing calls. Status: `IN PLACE` at the interface
level (`IResurvAction` forbids unbounded external calls and requires revert on partial
failure). Enforcement is `PLANNED` with the covenant contract.

### T5. Prompt injection through chain data or protocol metadata

Control: the planner's output is a constrained decision schema, never calldata, and every
decision is validated before use. Status: `PLANNED`, agent phase.

### T6. Secret disclosure

Controls in place, each with the test that holds it up:

- `.gitignore` covers `.env`, `.env.*`, `.dev.vars`, `secrets/`, `keystores/`, `private/`,
  `*.pem`, `*.key`, `deployer.json`, `account.json` and Supabase local secrets, verified with
  `git check-ignore`.
- CI fails if any secret-bearing file is ever tracked. The detector is
  `packages/repo-policy/src/tracked-secrets.ts`, it runs against `git ls-files` and against
  every path ever added in reachable history, and it has fixtures for every category
  `.gitignore` protects. The Phase 0 job was a single regex that missed `.dev.vars`,
  `secrets/`, `keystores/`, `deployer.json` and `account.json` while this document claimed
  those were covered, and would have failed the build on the `.env.staging.example` that
  `.gitignore` deliberately permits.
- `@resurv/config` redacts recursively and cycle-safely, on three independent grounds: the key
  name, the value shape, and known values pulled from the parsed configuration. The Phase 0
  implementation walked one level of `Object.entries`, so a secret one level down or inside an
  array survived verbatim. `packages/config/test/redact.test.ts` asserts against eight fake
  credential shapes in nested objects, nested arrays, Maps, Sets, Errors and cycles.
- `/api/health` names failing variables and never their values, and the unhandled-error path
  serializes through redaction before it reaches a log line. Both have tests.
- Claude Code permissions deny reads of `.env`, `.dev.vars`, keystores, `~/.ssh` and `~/.aws`,
  and deny Bash commands whose text names those paths.

Status: `IN PLACE` for the controls above.

Residual, stated plainly:

- The deny list is pattern-matched on the command string. It stops the obvious form and a
  determined rewrite defeats it. See T11.
- Redaction is shape-based, so a credential in a shape nobody anticipated passes through. It
  fails closed on the shapes it knows, including over-redacting transaction hashes, which are
  the same 66 characters as a private key.
- A secret pasted into a file inside the repository is readable by an ordinary recursive grep
  that names no protected path. The control against that is that no such file exists, which
  the tracked-secret job enforces for anything committed.

### T7. The KeeperHub organization wallet bypasses RESURV

The wallet can transact independently of any covenant. Nothing in RESURV prevents this.
Control: the covenant contract must gate on covenant state and committed configuration, so a
direct call that is not a legitimate attempt fails at the contract rather than at the API.
Status: `PLANNED`. Recorded here because it is a judge-facing question, not a hidden one.

Relevant measurement: under `sponsored: true`, `msg.sender` at the target was the org wallet
even though `receipt.from` was a relayer and `receipt.to` a router. Access control keys on the
org wallet address, not on anything visible in the receipt. The `sponsored: false` path is
unmeasured and nothing is asserted about it.

### T8. Verifying a run by looking at the wrong address

Under sponsorship the org wallet neither sends nor pays, so its explorer transaction list
shows nothing. Control: verification goes transaction hash → receipt → decoded log, fetched
from a public node, never by inspecting an EOA's transaction list.

Status: `PARTIAL`, downgraded from `IN PLACE` by the Phase 0 remediation. The rule is written
down and two RPC origins are pinned in `@resurv/chain`, but no code in this repository fetches
a receipt from either one, and the test that supposedly establishes "hosts we do not control"
checks that each URL starts with `https://` and does not contain the string `resurv`. T9
depends on the same two constants and was correctly rated `PARTIAL`; rating T8 higher on the
same evidence was inconsistent.

### T9. A single RPC node decides a proof

Control: quorum across at least two independent origins. Status: `PARTIAL`. The endpoints are
pinned and tested for distinctness; the quorum client is `PLANNED`.

### T10. Tool permission indirection

Demonstrated, not hypothetical. A restricted external action is reachable through a broadly
approved wrapper, so the restriction reads as a control and is not one.

The concrete instance: `Bash(pnpm --filter:*)`, `Bash(pnpm run:*)`, `Bash(pnpm exec:*)` and
`Bash(turbo run:*)` were auto-approved prefix rules over command runners. `apps/worker`
defines `"deploy": "wrangler deploy"`, so `pnpm --filter @resurv/worker deploy` deployed
without a prompt while `Bash(wrangler deploy:*)` sat in `ask`. The same route reached
`wrangler secret`, `cast send`, `forge script` and `forge create`. `docs/DEPLOYMENTS.md`
recommends that command form.

Controls:

- No allow rule combines a command runner with a wildcard. Runner invocations are exact
  matches naming one reviewed script; the runners themselves are in `ask`.
- Deny rules match the dangerous inner command at any position in the string, so the wrapped
  forms are blocked as well as the direct ones.
- `packages/repo-policy/test/permission-boundary.test.ts` holds the proven bypasses as test
  cases, enumerates every workspace script, and fails if a script with an external effect is
  auto-approved under any wrapper it knows about.
- `packages/repo-policy/test/workspace-scripts.test.ts` covers the indirection the permission
  engine cannot see at all: `pnpm build` is auto-approved and turbo then runs package scripts
  the engine never inspects. Every script reachable that way is asserted to have no external
  effect, and the one script that names `wrangler deploy` must carry `--dry-run`.

Status: `IN PLACE` for the known instances. Residual: the enumeration is of runners and
effects we thought of. A new runner in a script, a new binary with an external effect, or a
Makefile would each need a new rule, and the policy test would not know to ask for one.

### T11. Secret exfiltration through an equivalent tool

Denying one file-read surface does not deny the bytes. `Read(./.env)` blocked the Read tool
while `Bash(node -e:*)`, `Bash(rg:*)`, `Bash(grep:*)`, `Bash(find:*)` and `Bash(jq:*)` were
auto-approved, and every one of them prints an arbitrary file. The deny rule created an
appearance of protection the allow list removed.

Two facts from Claude Code's own documentation shape the fix. Read and Edit deny rules apply
to its built-in file tools and to file commands it recognizes in Bash, such as `cat`, `head`,
`tail` and `sed`, and not to arbitrary subprocesses that open files themselves. And a built-in
set of read-only commands, including `ls`, `cat`, `grep` and `find`, runs without a prompt in
every mode and cannot be removed from that set except by an ask or deny rule.

Controls:

- Interpreters and file-dumping utilities that are not in the built-in read-only set
  (`node -e`, `bash -c`, `python -c`, `rg`, `jq`, `base64`, `xxd`, `sed`, `awk`) are in `ask`,
  so they prompt rather than run.
- Deny rules match the secret paths themselves anywhere in a command string: `Bash(*.env*)`,
  `Bash(*.dev.vars*)`, `Bash(*secrets/*)`, `Bash(*keystores/*)`, `Bash(*/.ssh/*)`,
  `Bash(*/.aws/*)`, `Bash(*id_rsa*)`, `Bash(*PRIVATE KEY*)`, plus `printenv` and `env`. This
  is what stops `cat`, `grep` and `find`, which cannot be un-approved.
- `packages/repo-policy` asserts the blocked list, including the exact commands the reviewer
  used.

Status: `IN PLACE` against a named path. Residual, and it is real: a command that reads a
secret without naming a protected path is not blocked. `grep -r kh_ .` is the obvious one. The
mitigation is that no credential is inside the repository, enforced by the tracked-secret job,
and that Phase 0.5 puts the key in a file the deny rules name. This is a boundary that raises
the cost of an accident, not a sandbox. For OS-level enforcement Claude Code offers a sandbox
mode, which this project has not adopted.

### T12. Self-referential property testing

A property test is vacuous when the implementation under test also controls which inputs the
generator is allowed to produce. The suite then proves the implementation agrees with itself,
and reports a large call count while doing it.

Demonstrated on this repository. The invariant handler discarded every transition
`CovenantStatusLib.canTransition` did not already bless, so the fuzzer could not construct an
illegal one. Permitting `DRAFT -> EXECUTING`, permitting `EXECUTING -> ARMED`, or rewriting
`isTerminal` to return false for every state each left all three invariants green at 16,384
calls and 0 counterexamples, and the third of those was the sole cited evidence for a
`VERIFIED` claim in `docs/CLAIMS.md`.

Controls:

- Every property test is judged against a reference model transcribed from the PRD that never
  calls production code, in a deliberately different representation. ADR-009.
- Handlers attempt the full input space unconditionally and record what the implementation
  allowed, rather than asking it what to try.
- Coverage is reported behaviorally: applied transitions, rejected attempts, distinct pairs
  attempted and applied, states visited. A call that cannot mutate anything is not depth.
- `fail_on_revert = true`, so a revert inside a handler is a failure rather than a silently
  discarded run. At Phase 0 this was `false`, which hides nothing while the handler cannot
  revert and would swallow every `require` the moment one wraps a real contract.
- The fix was verified by mutation rather than by inspection: five Solidity mutations and
  three TypeScript mutations, each detected. Recorded in
  `docs/phase-logs/PHASE_00_REMEDIATION.md`.

Status: `IN PLACE` for the covenant state machine. Residual: the reference model is a
transcription, so a misreading of PRD 9.1 would be faithfully mirrored in both languages and
no test would object. The model states its transcription decisions in a comment for exactly
that reason, and the covenant contract's real preconditions are not modeled at all yet.

## Residual risks accepted for v1

- The RESURV admin role and the KeeperHub organization wallet are trusted. The product is not
  trustless and must never be described as such.
- The Claude Code permission boundary is configuration, checked by our own tests against
  Claude Code's documented matching behavior. It is not a sandbox and nothing in this
  repository may describe it as one. T10 and T11 state what it does and does not stop.
- Base Sepolia has no private mempool, so nothing about MEV protection may be claimed.
- Gas sponsorship was observed once, on one organization, on one chain. It is reported as
  observed, never promised.
- No external audit. Not production-ready, by definition of the production gate.

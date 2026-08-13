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
| KeeperHub API key | a local ignored environment file, Worker secret | Same as above |
| Seam evidence files | `docs/phase-logs/evidence/` | A credential committed to source control inside a proof artifact |
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
Status: **`IN PLACE`**, upgraded from `PLANNED` in Phase 1 and confirmed live in Phase 7. The
atomic attempt exists, is deployed, and settled a covenant on Base Sepolia:
`test_falseOutcomeRevertsTheActionTheCountersTheStatusAndTheFee` shows the adapter's transfer,
the attempt counters, the status change and the escrow unwinding together, a mutation removing
the postcondition revert fails eight tests, and transaction
`0x7ac018850024cfd0e2d901840fd395fab852cf8cc23e5f7755c0b3eda8cc7d25` carries the six logs the
claim rests on. The verifier is reached by STATICCALL, so one that tries to write reverts rather
than satisfying itself.

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
`IN PLACE` and unit-tested.

The kill-the-network replay **has now been run**, three times, and the threat is measured rather
than modeled. `packages/seam-probe` scenarios `P11`, `P13` and `P15` send a real, complete
request and stop listening 250 ms later.

What was measured:

- **The ambiguity is real on both sides.** In `P11` the execution was created 264 ms after the
  request was sent, so the aborted request had committed. In `P13` the identical abort committed
  nothing and the later replay created the execution. One client-side observation, opposite
  economic outcomes.
- **Replaying the key resolves it.** 202 with the `executionId`, and `idempotentReplay` tells
  you which side you were on; or 409 `idempotency_in_progress` with `retryable: true` while it
  is still running, in which case repeat the same key and never rotate it.
- **A 409 `idempotency_conflict` names the original execution** in `originalExecutionId`, which
  is documented nowhere and is a second recovery route.
- **The chain answers when KeeperHub does not.** `P11` recovered its transaction from
  `eth_getLogs` alone.
- **Every one of the three ended with exactly one onchain effect.** For one idempotency key,
  within the window, a lost response cannot double-submit.

Status upgraded to `IN PLACE` for the transport half, at the scope measured: one key, one
organization, inside the 24-hour window. The permanent half is still `PLANNED`, because a new
key for the same action executed it a second time (`P08`), and only an onchain attempt id stops
that.

The honest limit, stated so nobody reads more into it: a client-side abort cannot reproduce a
partition that drops the response *after* KeeperHub commits, at a moment of KeeperHub's
choosing. Inducing that needs infrastructure manipulation this project will not perform. What it
does reproduce is the client's side of the ambiguity, which is the side the control works from.

### T4. A model produces raw calldata

Control: adapters are capabilities. The adapter address and its config hash are committed
before arming, so the set of possible actions is fixed before any trigger exists, and the
planner selects among them rather than composing calls. Status: **`IN PLACE`**, upgraded from interface-level in Phase 1. `_consumeAttempt` rejects any
config whose hash differs from the committed one before an adapter is reached, and each adapter
refuses every caller but the manager. `test_uncommittedActionConfigIsRejected` and
`testFuzz_anyConfigDriftIsRejected` cover it, and a mutation removing the config check fails
both. The recipient is the field this protects and it is the one the fuzz test moves.

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
  and deny Bash commands whose text names those paths. Extended by the pre-seam hardening pass
  to the host credential stores outside this repository and to the declared secret variable
  names. See T13.
- No CI job is committed that could not pass on a clean runner. The workspace job installs the
  Foundry toolchain and the submodules its commands actually reach, and
  `packages/repo-policy/test/ci-workflow.test.ts` derives that requirement from the script
  graph. A job that cannot run is not a control, and the Phase 0 form of that job could not
  have run.
- Committed seam evidence is written through a serializer that removes credentials and keeps
  chain data, and the writer re-scans its own output and throws rather than emit a file that
  still matches a credential shape. `packages/seam-probe/src/sanitize.ts` and
  `test/offline/sanitize.test.ts`. This is a separate mechanism from `@resurv/config`'s
  `redact`, on purpose: `redact` fails closed on every 32-byte hex value, which would erase the
  transaction hashes the evidence exists to record.
- The credential loader reports variable *names* and never values, so a caller that prints its
  result cannot print a credential, and it never overwrites a value already in the process
  environment.

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

### T17. Acting on a KeeperHub error message that names the wrong cause

Measured, not modeled. A contract call whose gas estimation reverts is refused with:

```
Insufficient BASE balance. Have: 0.0, Need: 0.000000231.
Fund 0xfd35…834c with at least 0.000000231 BASE on this chain and retry.
```

The call was refused because it would revert. The balance is a consequence: estimation failed,
so sponsorship was declined, so the empty wallet became relevant. The controlled comparison is
in the same run with one variable changed, and it is the reason this is stated as fact rather
than as a theory: the same wallet, at the same zero balance, executes a *valid* call with
`sponsored: true`.

An operator or an agent that follows the instruction would fund the wallet, retry, and either
loop or, worse, succeed in broadcasting a transaction that reverts onchain and costs real gas.

Control: the orchestrator classifies a refusal by `status`, `transactionHash` and `receipts`,
never by the error text, and a refusal with a null hash and empty receipts is
`EXECUTED_NO_EFFECT` regardless of what the message blames. The error text is recorded in the
receipt for a human and is never an input to a decision.
Status: `PLANNED`. No orchestrator exists. The measurement is `P09` and `P14` in
`docs/phase-logs/evidence/phase-00-5/`.

### T8. Verifying a run by looking at the wrong address

Under sponsorship the org wallet neither sends nor pays, so its explorer transaction list
shows nothing. Control: verification goes transaction hash → receipt → decoded log, fetched
from a public node, never by inspecting an EOA's transaction list.

Status: **`IN PLACE`**, upgraded in Phase 2. `packages/chain/src/rpc.ts` fetches every receipt
from both pinned origins, and verification runs hash to receipt to decoded log rather than by
inspecting an EOA's transaction list. The proof page does the same reads from the visitor's own
browser. Residual: the two origins are still two public endpoints chosen by us, and the test
that they are "hosts we do not control" remains weak.

### T9. A single RPC node decides a proof

Control: quorum across at least two independent origins, judged on a projection of the receipt
rather than on raw JSON, because OP-stack nodes differ on optional fields that decide nothing.

Status: **`IN PLACE`**, upgraded in Phase 2. `rpcQuorum` requires more than one origin to have
answered and all answers to agree on the projection; a disagreement is itself
`RECONCILIATION_REQUIRED` and the covenant does not advance.
`never confirms while two RPC origins disagree about the receipt` covers it.

Observed live rather than only tested: during two of the deployment runs one origin had not yet
seen the block, the reconciler reported a disagreement, refused to advance, and confirmed on the
next round. The control fired on its first outing without anybody arranging it.

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

Amended by the pre-seam hardening pass: the interpreter tier described above is `ask`, and
`ask` was measured not to prompt. See T13. The path-naming deny rules are what carry this
control, and they were measured blocking. The interpreters remain in `ask` because denying
`sed`, `jq` and `awk` outright would cost more than it buys, and because a `deny` rule on the
path already stops them from reaching a credential.

### T13. The boundary stopped at the repository edge, and `ask` does not prompt

Two findings, measured rather than modeled, both from the pre-seam hardening pass on
2026-08-12. Full record in `docs/phase-logs/PRE_SEAM_HARDENING.md`.

**The credential that governs the Worker secret was readable.** The asset table above lists the
KeeperHub API key as living in `.env` and in a Worker secret. Creating and replacing that
Worker secret needs a Cloudflare OAuth token, which lives in `~/.wrangler/config/default.toml`,
outside the repository and named by no rule. `ls -d ~/.npmrc` was run in a live session before
the change and executed with no prompt. The same held for `~/.config/gh/hosts.yml`,
`~/.claude.json`, `~/.docker/config.json` and the gcloud credential store. Nothing in the
repository's own model could see it, because `packages/repo-policy` did not model the built-in
read-only command set and reported those commands as `prompt` when the real outcome was "runs".

**An `ask` rule was measured not to prompt.** `jq --version` and `sed -n 1p package.json` both
ran with no prompt in the same session, under rules that have said `Bash(jq *)` and
`Bash(sed *)` since the Phase 0 remediation. A `deny` rule in the same session blocked. The
permission mode a session starts in is resolved by the client, not by `defaultMode` in this
file, so `ask` is advisory here. Nothing load-bearing may rest on it.

**A third finding, and it is the one worth remembering.** A Bash pattern containing `$` never
matches anything. `Bash(*~/.*)` denied `ls -d ~/.zshrc`; the sibling rule `Bash(*$HOME/.*)`
did not deny `ls -d $HOME/.zshrc`, and `Bash(*echo $*)` did not deny `echo $HOME`. A rule
written that way reads as a control and is not one. This is not in the vendor documentation.

Controls:

- Deny rules name each credential store by the part of the path that cannot be respelled:
  `Bash(*.wrangler*)`, `Bash(*.config/gh/*)`, `Bash(*.npmrc*)`, `Bash(*.claude.json*)`,
  `Bash(*.docker/*)`, `Bash(*gcloud*)`, `Bash(*.netrc*)`, `Bash(*.git-credentials*)`,
  `Bash(*.kube/*)`, `Bash(*.gnupg/*)`, `Bash(*.cloudflared*)`. A substring rule is
  spelling-independent: `~/.npmrc`, `$HOME/.npmrc` and `/Users/mac/.npmrc` all carry `.npmrc`.
- Three catch-alls cover home dotfiles nobody enumerated: `Bash(*~/.*)`, `Bash(*HOME/.*)` and
  `Bash(*/Users/*/.*)` with the Linux sibling `Bash(*/home/*/.*)`.
- Since `$` cannot appear in a pattern, `echo $KEEPERHUB_API_KEY` is stopped by denying the
  *name*: `Bash(*KEEPERHUB_API_KEY*)`, plus the generic `Bash(*API_KEY*)`, `Bash(*SECRET*)`,
  `Bash(*_TOKEN*)`, `Bash(*PASSWORD*)`, `Bash(*PRIVATE_KEY*)`, `Bash(*CREDENTIALS*)`,
  `Bash(*MNEMONIC*)`. This costs `grep -rn API_KEY` from Bash; the Grep tool is unaffected.
- Environment dumping is denied in every form found: `printenv`, `env`, `/usr/bin/env`,
  `export`, `export -p`, `declare`, `declare -p`, `set`, `compgen -v`.
- The corresponding `Read` deny rules were rewritten from `//Users/mac/...` to `~/...`, so they
  are not specific to one machine, and `Write(./.env)` was deleted: Claude Code never consults
  a `Write` path rule and warns about it at startup. `Edit(./.env)` covers Write already.
- `packages/repo-policy/src/bash-rules.ts` now models the built-in read-only set and exposes
  `runsWithoutPrompt`, so a test cannot pass by asserting `not.toBe('allow')` about a command
  that runs anyway. `patternIsInert` models the `$` defect and a test fails if any committed
  rule carries one.
- `packages/repo-policy/test/credential-surfaces.test.ts` asserts `deny` specifically, never
  "not allow", for every surface above, in tilde, `$HOME` and absolute spellings, plus a set of
  spellings no catch-all covers so each named rule is load-bearing on its own.

Status: `IN PLACE` for the named stores and for the declared secret variables.

Residual, stated plainly:

- The enumeration is of credential stores we thought of. A tool that invents a new dotfile is
  covered by the home catch-alls only if it puts it in the home directory.
- A file read through an ask-tier interpreter is not stopped in a session where `ask`
  auto-approves, unless its path or a denied variable name appears in the command string.
- None of this is OS-level enforcement. A subprocess that opens a file itself is outside
  Claude Code's reach entirely, which its own documentation says. The sandbox mode that would
  enforce at the OS level has not been adopted.
- The observed permission mode is a property of the client session, not of this file. A
  different mode changes which tier prompts, and nothing in the repository can assert it.

### T14. An auto-approved script name outlives the body that was reviewed

`Bash(pnpm lint)` approves a name. The command it runs is a string in `package.json` that the
permission engine never sees, and until the pre-seam hardening pass nothing checked it. The
remediation review proved it twice: appending `&& wrangler deploy` to the root `lint` script
survived the whole suite, and so did a new `"ship": "wrangler versions upload"` with a matching
allow rule. Eleven root scripts were auto-approved and enumerated by no test.

Controls, in `packages/repo-policy/src/approved-scripts.ts`:

- The graph is resolved rather than listed. Each allow rule is followed through
  `pnpm <script>`, `pnpm --filter <pkg> <script>` and `turbo run <task>` into the workspace,
  with `turbo.json`'s `dependsOn` walked against the real dependency graph. 51 scripts are
  reachable today; the Phase 0 tests saw the workspace ones and none of the root ones.
- Every leaf must match `APPROVED_LEAF_COMMANDS`, anchored at both ends. An unrecognized
  binary fails whether or not anyone predicted it, which is what covers `npx`, `pnpm dlx`,
  `node scripts/x.js` and any future deployment tool.
- The reachable set must equal a reviewed inventory, and each script's body must still be the
  reviewed text. A new allow-listed script fails until someone reviews it.
- Ten mutations were run against the committed suite and all ten were caught, including the
  two the previous review recorded as survivors. Recorded in
  `docs/phase-logs/PRE_SEAM_HARDENING.md`.

Status: `IN PLACE`.

Residual: this is a drift guard, not an integrity control. Anyone with commit access can edit
`package.json`, the manifest and the test in one change and nothing will object. It stops the
accident and the unnoticed edit, which is the class of failure that actually happened here. It
does not stop a hostile contributor, and no test in this repository does.

### T15. A successful transaction that contains a failed attempt

Found in Phase 0.5 by reading the vendor documentation rather than by modelling. Recorded in
`docs/keeperhub/SOURCE_SNAPSHOT.md` sections 3 and 10.

`receiptStatus` has a documented value `safe_inner_failure`, and the gas page states that
sponsorship "uses direct wallet calls; applying it to Safe writes would alter `msg.sender` away
from the Safe itself", so routing through a Safe is a real execution mode on this platform.

When execution routes through a Safe, the outer transaction can succeed while the inner call
fails. A RESURV attempt executed that way produces a transaction receipt with status `0x1` while
`executeAttempt` reverted. Anything that verifies by reading the receipt reads that as success,
and T1 is the whole product.

Controls:

- RESURV executes on the direct-wallet-sender path. That is also what gas sponsorship requires,
  so the two constraints agree rather than trade off.
- Reconciliation treats an inner-failure receipt status as a failed attempt regardless of the
  outer receipt status.
- `CONFIRMED` requires the expected event in the receipt's logs, never the receipt status alone.
  PRD 12.6 already says not to mark RESURV satisfied from KeeperHub status alone; this makes the
  same true of the receipt.
- `packages/seam-probe` records `sponsored` and the decoded sender on every attempt, so the
  execution mode is observed rather than assumed.

Status: `PLANNED`. This is a documented platform behavior and an inference about its
consequence, not a measurement, and the covenant contract that would be affected does not exist
yet.

What the Phase 0.5 probe added is where to look. Every successful execution carried
`result.executedCall.reverted: false` alongside `receipts[].receiptStatus: "success"`, so the
inner outcome is exposed on the status body and does not have to be inferred from the receipt.
`safe_inner_failure` itself was never observed, on six successful executions and three refusals,
so the hazard stays open rather than being confirmed or dismissed. A reconciler must read
`executedCall.reverted` and the receipt status, and must not treat an outer `0x1` as sufficient.

### T16. A daily spending cap refuses execution mid-incident

The Direct Execution page documents a configurable organization daily spending cap in wei, and
HTTP 403 with `Daily spending cap exceeded` when it is passed. That branch appears only under
load, which is exactly when a recovery covenant is executing, and it is a different failure from
an authentication 401 or a scope 403.

Control: the orchestrator classifies 403 `Daily spending cap exceeded` as a refusal that must
not be retried on a new idempotency key, must alert, and must not advance to the next recovery
action, because a cap that refuses one attempt will refuse the next one too.
Status: `PLANNED`. No orchestrator exists. `packages/seam-probe` captures the response envelope
if the branch is ever hit.

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
  Claude Code's documented matching behavior and against three behaviors measured live. It is
  not a sandbox and nothing in this repository may describe it as one. T10, T11, T13 and T14
  state what it does and does not stop.
- Only `deny` is load-bearing. `ask` was measured to auto-approve in the permission mode this
  project's sessions run in, so it is documentation of intent rather than a control.
- Base Sepolia has no private mempool, so nothing about MEV protection may be claimed.
- Gas sponsorship was observed once, on one organization, on one chain. It is reported as
  observed, never promised.
- No external audit. Not production-ready, by definition of the production gate.

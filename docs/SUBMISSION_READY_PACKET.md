# Submission-ready packet

Draft. Nothing here has been submitted. Every factual statement below is at or under the level
`docs/CLAIMS.md` supports; the "never say" list at the end is the one to check a final edit
against.

Two review rounds have run, six of the seven reviews returned FAIL, and every substantiated
finding is either fixed or named. The contracts were then **redeployed from current source** and
the canonical covenant re-run against them, so what is on chain is what is in the repository:
`deployments/base-sepolia.json` records commit `1d1eb9a` and `git diff b9f8722 --
packages/contracts/` is empty.

The pre-deployment contracts audit had not reported when the first of those deployments ran: it
was launched first and stalled after its proof-of-concept attacks, producing no findings. The
deployment proceeded on 122 contract tests, including the fuzz and invariant campaigns, plus six
mutation regressions each verified to fail when its fix is reverted — a weaker gate than a
completed audit, recorded as one rather than described as one that passed. That first deployment
then turned out to have shipped a mutation-testing build of the covenant manager, which Sourcify
caught by refusing to verify it. It was redeployed and all six contracts now verify.

One thing to be able to say out loud rather than hope nobody asks: the deployment had to be done
twice, and the reason is in `docs/DEPLOYMENTS.md` and `docs/FINAL_BUILD_REPORT.md` in full.

Three assets are required and incomplete submissions are not judged:

| Asset | Status |
|---|---|
| GitHub repository link | **ready:** https://github.com/winsznx/resurv — public, full history, CI green |
| Demo video | **needed.** Script in `docs/DEMO_SCRIPT.md`, checklist in `docs/DEMO_CAPTURE_CHECKLIST.md`. A human records it |
| Link to a real transaction executed through KeeperHub | **ready:** https://sepolia.basescan.org/tx/0x7ac018850024cfd0e2d901840fd395fab852cf8cc23e5f7755c0b3eda8cc7d25 |

---

## Product title

RESURV

## One-liner

An outcome covenant: recovery actions execute through KeeperHub until a declared onchain safe
state is true, and the responder is paid inside the transaction that made it true.

## Short description (about 50 words)

Most onchain automation stops when a transaction confirms. A protocol operator needs a state, not
a transaction. RESURV lets a protocol commit — before an incident — to what safe means and to a
short list of pre-authorized recovery actions. Payment happens only when a verifier observes that
state, in the same transaction.

## Longer description

RESURV is outcome-gated execution infrastructure.

A requester creates a covenant that fixes four things which cannot change afterwards: a
deterministic outcome verifier, an ordered set of approved recovery actions with their exact
targets, recipients and bounds, one trigger authority, and an escrowed success fee.

When a signed risk trigger arrives, RESURV works down the list. Each attempt is one EVM
transaction that executes one committed action, evaluates the verifier, and reverts the entire
attempt if the outcome is still false. When the outcome is true the covenant becomes terminal and
the fee transfers, in that same transaction.

The agent never invents anything. It selects among adapters whose addresses and configuration
hashes were fixed before the covenant was armed. There is no path from a model's output to a
target, a selector, a recipient or an amount.

A covenant ran end to end on Base Sepolia. Its primary action, `pause`, was refused by KeeperHub's
simulation because the adapter's vault role had been revoked, so no transaction was sent and
nothing on chain moved. The approved fallback evacuated the vault to the committed recipient, the
verifier returned true, and the success fee was released — one transaction carrying all of it. The
same trigger and the same attempt were then replayed and both were rejected.

## The problem

Onchain automation treats submission or confirmation as success. Two things go wrong with that,
and both are ordinary rather than exotic.

A transaction can confirm while the desired outcome is still false. And the emergency action you
planned for can have stopped working: a role revoked six months ago, a target upgraded, an
assumption drifted. Nobody finds out until the incident, which is the worst possible time to
discover that your runbook's first step reverts.

## The solution

Make the outcome the unit of completion, and make the covenant enforce it.

The verifier is a `view` contract called by STATICCALL inside the attempt, so it cannot write and
cannot satisfy itself. A false result reverts the adapter's writes, the attempt counters, the
covenant's state change and the fee together. The set of possible actions is fixed before any
trigger exists. Duplicate protection is onchain and permanent rather than a transport
convenience.

## Why KeeperHub

Three specific things, each of which changed the architecture rather than sitting beside it.

**It is the execution path.** Simulation before broadcast is what refuses the primary action
without spending gas or touching state — that refusal is the demo's turning point, and it is a
KeeperHub response. Every RESURV write goes through the Direct Execution API.

**Gas sponsorship made the deployment possible at all.** The organization wallet holds zero native
currency and there is no deployment endpoint, so the contracts were deployed by a sponsored
contract call to a public CREATE2 factory. RESURV deployed itself with no funded deployer and no
faucet: six contracts, six addresses predicted offchain before sending, six matches.

**Its seam semantics dictated the state machine.** A day of measurement before any product code
falsified the attempt lifecycle this project was about to build, and the corrected one is what
shipped.

## Technical implementation

- **Contracts** (Solidity 0.8.36, Foundry, no proxy): `ResurvCovenantManager` plus two capability
  adapters, a verifier, and a demo protocol. 123 tests including 8 stateful invariants at 256
  runs × depth 128.
- **Domain** (`@resurv/domain`): two state machines, each judged against an independent reference
  model transcribed from the specification that never calls the implementation.
- **Orchestrator** (`@resurv/orchestrator`): the measured attempt lifecycle executed for real.
  The idempotency key is `fsync`'d before the request leaves; a lost response is replayed under
  the same key and never a new one; nothing becomes terminal until two independent RPC origins
  agree on a receipt that carries the expected event.
- **Proof surface**: a public page that reads committed artifacts for the past and two public RPC
  origins in the visitor's own browser for the present, so no RESURV server is in the trust path.
- **Deployment**: Cloudflare Workers, one deployable serving `/api/*` and the SPA.
- 750 TypeScript tests, 123 Foundry tests, one aggregate gate that exits 0, green on a clean
  GitHub runner.

## Real KeeperHub transaction

https://sepolia.basescan.org/tx/0x7ac018850024cfd0e2d901840fd395fab852cf8cc23e5f7755c0b3eda8cc7d25

Block 45423354, status `0x1`, 245,555 gas. Six logs in this order: `AttemptStarted`, the vault's
`Transfer` to the approved recipient, `VaultEvacuated`, `AttemptSucceeded`, the escrow's
`Transfer` to the responder, `CovenantSatisfied`.

Sixteen further KeeperHub-executed transactions from the same build are listed in
`docs/DEPLOYMENTS.md`, including every contract deployment.

## Live app and proof page

The deployed Cloudflare Worker URL. **Fill this in after the deploy**, which is a human step:
`wrangler deploy` is denied to the build agent in every wrapper form.

JSON, for anyone who prefers it: `/api/proof`, `/api/proof/summary`, `/api/deployment`.

## GitHub

https://github.com/winsznx/resurv — public, full history, MIT. CI green on a clean runner:
[run 31642439279](https://github.com/winsznx/resurv/actions/runs/31642439279).

## Demo video

**Placeholder.** Recorded by a human from `docs/DEMO_SCRIPT.md`, roughly 2:45, legible with the
sound off.

## Key engineering insight

*An HTTP status never advances a covenant. A chain read does.*

That sentence is the product of a day spent measuring the KeeperHub seam before writing any
product code, and it falsified the design that day started with. HTTP 202 with an `executionId`
is returned both by an execution that landed and by one that never reached the chain. There is no
`ACCEPTED` state in RESURV because the entry condition for it was satisfied by an attempt that
did nothing.

The corollary cost more: KeeperHub's idempotency bounds effects per *key*, not per action. A new
key for the same economic action executes it a second time — measured, twice. So the transport
key protects a retry, and something permanent and onchain has to protect the action. That is why
the covenant burns a semantic attempt id in the same transaction as the effect.

## Reliability and security

- A false outcome reverts the whole attempt, and that is machine-checked by an invariant and by a
  mutation that removes the revert and fails eight tests.
- The success fee settles once per covenant, behind an explicit flag, with terminal states
  absorbing.
- The suite was validated by mutation rather than by pass count: eight deliberate defects, seven
  caught, and one — admitting an armed but never-triggered covenant into `executeAttempt` — that
  survived the entire suite and is now caught three ways. It is in the phase log because a
  mutation campaign that only reports its successes is not an instrument.
- The Claude Code permission boundary is executable policy: 412 tests covering the surfaces, the
  auto-approved script graph, and every command that could reach a credential.
- No credential exists in the repository, in an evidence file, in the Worker bundle, or on the
  proof page.

## Known limitations

Stated here rather than left to be found:

- Base Sepolia. No mainnet deployment, no external audit, not production-ready by this project's
  own definition.
- The KeeperHub organization wallet and the RESURV admin are trusted parties. In the demo the
  requester, the admin and the executor are one address; in production they are three.
- A broadcast transaction that reverts onchain was never observed. Two routes were tried and both
  failed, because KeeperHub refuses to broadcast a call whose gas estimation reverts. `REVERTED`
  is implemented and tested anyway, and nothing is claimed about how it presents.
- `safe_inner_failure` is documented and was never observed. It is handled conservatively.
- No database. The orchestrator persists to an `fsync`'d append-only journal, which is what the
  durability argument requires for one process; a shared store does not exist and nothing that
  ships needs one.
- The model-assisted planner is not built. Action order is the covenant's committed order, which
  means no model is anywhere near the safety path.

## Future work

A verifier and adapter registry so covenants stop being bespoke. A Safe module so an existing
treasury can arm one without moving funds. Attempt stipends, because success-only compensation
does not cover a responder's gas on a failed attempt. Verifiable responder track records. Then,
and only after an audit, a capped mainnet canary.

---

# Onboarding bounty, separate submission

## Title

KeeperHub execution semantics: five things a Direct Execution client has to get right

## Description

A teardown, a reproduction and the fixes, from building a product that executes every write —
including its own contract deployments — through the Direct Execution API.

Five findings, each with the measurement that produced it, the code that gets it wrong, and the
code that gets it right: HTTP 202 is returned by executions that never reached the chain; the POST
is synchronous so there is no pending phase to poll; idempotency bounds effects per key rather
than per action, so a fresh key on retry buys a second economic effect; three error envelope
shapes exist and `error` means the machine code in one and the human sentence in another;
`safe_inner_failure` means an outer receipt of `0x1` is not proof the inner call succeeded.

Plus one that is not a gotcha: a contract call to a CREATE2 factory is a contract call, so you can
deploy contracts through the sponsored path with a wallet holding no native currency. We deployed
six that way.

Everything is reproducible from a committed probe: sixteen scenarios against the live API, one
JSON file each with credentials removed and chain data intact, and an offline suite of 71 tests
that asserts the findings against that evidence so a claim cannot drift from its artifact.

Six suggested documentation changes are included, in priority order.

## Artifact

`docs/bounty/README.md`, with `packages/seam-probe`, `packages/keeperhub-client` and
`docs/phase-logs/PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md`.

---

## Never say

Checked against `docs/CLAIMS.md`. If a final edit introduces one of these, it is wrong:

trustless · rolls back · undoes · guaranteed recovery · exactly once · MEV protected · private
mempool · production ready · audited · atomically coupled to x402 · zero downtime · cannot fail

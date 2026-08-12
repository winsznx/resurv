# RESURV

**An outcome covenant. Recovery actions execute through KeeperHub until a declared onchain safe
state is true, and the responder is paid inside the transaction that made it true.**

| | |
|---|---|
| **Real KeeperHub transaction** | [`0xf7f9aace…29d86ab`](https://sepolia.basescan.org/tx/0xf7f9aace84a73bc236b2b44468026137fa5a52a96511a28f2951001a729d86ab) — the successful attempt, block 45398879 |
| **Public proof page** | `apps/web`, deployed to Cloudflare. Needs no login, no credential, no RESURV server in the trust path |
| **Covenant** | `0xd7250d1fd4c0f996475b78a00489ce0668bad187b342ca61d88983bf0ec7e14f` on Base Sepolia |
| **Covenant manager** | [`0xfcafbc81f253e62a3818ecda7a7a71e557c65b21`](https://sepolia.basescan.org/address/0xfcafbc81f253e62a3818ecda7a7a71e557c65b21) |
| **Tests** | 705 TypeScript, 114 Foundry, all green. `pnpm gate` exits 0 |

Check the headline for yourself in one command:

```bash
cast receipt 0xf7f9aace84a73bc236b2b44468026137fa5a52a96511a28f2951001a729d86ab \
  --rpc-url https://sepolia.base.org
```

That receipt carries six logs, in this order: `AttemptStarted`, the vault's `Transfer` to the
approved recipient, `VaultEvacuated`, `AttemptSucceeded`, the escrow's `Transfer` to the
responder, `CovenantSatisfied`. The recovery action, the outcome check, the covenant's state
transition and the success fee are one transaction. Had the verifier returned false, none of
those six logs would exist.

---

## The problem

Most onchain automation treats a confirmed transaction as success. A protocol operator does not
need a transaction. They need a state: the vault is empty and the approved Safe has the funds,
the protocol is paused, the dangerous approval is gone.

Those come apart in two directions, and both are ordinary rather than exotic:

- A transaction can confirm while the outcome stays false.
- The emergency action you planned for can have stopped working. A role was revoked six months
  ago, the target upgraded, an assumption drifted. Nobody notices until the incident.

## The mechanism

A requester commits, before any incident, to four things that cannot change afterwards: a
deterministic **outcome verifier**, an ordered set of **approved recovery actions** with their
exact targets, recipients and bounds, one **trigger authority**, and an escrowed **success fee**.

When a signed risk trigger arrives, RESURV works down the list. Each attempt is one EVM
transaction that executes one committed action, evaluates the verifier, and **reverts the whole
thing if the outcome is still false**. When the outcome is true the covenant becomes terminal and
the fee transfers, in that same transaction.

The agent never gets to invent anything. It selects among adapters whose addresses and
configuration hashes were fixed before the covenant was armed. There is no path from a model's
output to a target, a selector, a recipient or an amount.

### What the live run demonstrates

```text
covenant created and funded          the outcome, the plan and the authority are committed
signed risk trigger accepted         ARMED -> TRIGGERED, nonce consumed
attempt 1: pause                     SIMULATION REJECTED — the adapter's vault role was revoked
                                     no transaction was sent, nothing on chain moved
attempt 2: evacuate to the Safe      simulated clean, executed, confirmed on two RPC origins
outcome verified inside that tx      vault 0, recipient 1.000000 rUSD, covenant SATISFIED
success fee released in that tx      1.000000 rUSD to the responder
the same trigger, replayed           rejected
the same attempt, replayed           rejected
```

The refused primary action is the point. RESURV did not retry it, did not widen its authority,
and did not guess. It moved to the next action its covenant had already approved, and only
because a simulation said the first one could not safely complete.

## Why KeeperHub is load-bearing

Not a wrapper. Three specific things, each of which changed the architecture:

1. **It is the execution path.** Simulation before broadcast is what refuses the primary action
   without spending gas or touching state. Every RESURV write in this repository — including the
   contract deployments — goes through the Direct Execution API.
2. **Gas sponsorship is what made the deployment possible at all.** The organization wallet holds
   zero native currency. There is no deployment endpoint, so the contracts were deployed by a
   sponsored contract call to a public CREATE2 factory. **RESURV deployed itself with no funded
   deployer and no faucet.** Six contracts, six addresses predicted offchain before sending, six
   matches. See [ADR-014](docs/DECISIONS.md).
3. **Its seam semantics dictated the state machine.** A day of measurement before any product
   code (`docs/phase-logs/PHASE_00_5_KEEPERHUB_ATTEMPT_SEMANTICS.md`) falsified the lifecycle
   this project was about to build. The measured rules are now the implementation, and the
   engineering insight is one sentence: **an HTTP status never advances a covenant; a chain read
   does.**

## Architecture

```text
                      signed trigger
                            │
  requester ──create/fund──►│                      ┌──────────── KeeperHub ────────────┐
                            ▼                      │  simulate → refuse or broadcast   │
                   ResurvCovenantManager ◄─────────┤  gas sponsorship, org wallet      │
                    │        │        │            │  idempotency, execution status    │
       committed────┘        │        └────escrow  └───────────────────────────────────┘
        adapters             │           + fee                    ▲
            │           IOutcomeVerifier                          │
            ▼            (view, fails closed)         @resurv/orchestrator
      DemoVault ────────────► chain state             persist key → send → reconcile
                                  ▲                              │
                                  └────── two independent RPC origins must agree
```

| Package | What it is |
|---|---|
| `packages/contracts` | Foundry. The covenant manager, two action adapters, the verifier, the demo protocol |
| `packages/domain` | Pure reference models: the covenant state machine and the measured attempt lifecycle |
| `packages/keeperhub-client` | Typed transport. Parses and records; never decides what a response means |
| `packages/orchestrator` | The attempt lifecycle executed for real: durable claim, send, reconcile against chain |
| `packages/chain` | Two-origin RPC quorum, receipt projection, CreateX constants |
| `packages/proof` | The committed evidence, typed. Imported by the page and the Worker, never copied |
| `packages/cli` | The live entry points: deploy the contracts, run the covenant |
| `packages/repo-policy` | Executable repository policy. Tests only; ships nothing |
| `packages/db`, `packages/config`, `packages/node-runtime` | Schema, environment validation, host-process concerns |
| `apps/web` | The public proof page |
| `apps/worker` | One Cloudflare Worker: `/api/*` plus the built SPA as static assets |

## The state machine

Two of them, both with independent reference models the implementation is judged against
([ADR-009](docs/DECISIONS.md)).

**Onchain covenant** (PRD 9.1), enforced by `ResurvCovenantManager`:

```text
NONE → DRAFT → ARMED → TRIGGERED → EXECUTING → SATISFIED
                 │         │           └──────→ EXPIRED
                 │         └──────────────────→ EXPIRED
                 └──────────────────────────→ CANCELLED
```

**Offchain attempt lifecycle**, measured in Phase 0.5 and specified by
[ADR-013](docs/DECISIONS.md):

```text
PLANNED ─► REJECTED_LOCALLY | SIMULATION_REJECTED | SIMULATED_OK
SIMULATED_OK ─► KEY_COMMITTED
KEY_COMMITTED ─► EXECUTED_NO_EFFECT | RECONCILIATION_REQUIRED
RECONCILIATION_REQUIRED ─► CONFIRMED | REVERTED | PROVEN_NOT_BROADCAST | itself
```

There is no `ACCEPTED` and no `PENDING`. Measurement removed both: a 2xx carrying an
`executionId` is returned by an attempt that never reached the chain, and the POST is
synchronous so there is no pending phase to poll. From `KEY_COMMITTED` or
`RECONCILIATION_REQUIRED` RESURV may only replay the *same* idempotency key with a
byte-identical body. It may not rotate the key, may not try a different action, and may not
advance on elapsed time.

## Threat model, in five lines

Full version in [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

- **A false outcome reported as success.** The verifier is `view`, called by STATICCALL inside
  the attempt, and a false result reverts everything. A verifier that tries to write reverts.
- **Paying twice.** Terminal states are absorbing, escrow settles once per covenant behind an
  explicit flag, and the onchain attempt id is burned permanently.
- **A duplicate economic effect from a retried request.** KeeperHub's idempotency bounds effects
  per *key*; a new key for the same action was measured executing it a second time. The onchain
  attempt id is what actually stops that, forever.
- **An agent inventing calldata.** Adapters are capabilities with committed addresses and config
  hashes. There is no raw-calldata path anywhere.
- **A single node deciding a proof.** Every terminal chain state requires two independent origins
  to agree on the material projection of the receipt.

## Setup

```bash
git clone --recurse-submodules <url> resurv
cd resurv
pnpm install
pnpm gate          # every required check, in order. Exits 0.
```

Node 24+, pnpm 11+, Foundry. Exact pins in [`docs/VERSIONS.md`](docs/VERSIONS.md). No credential
is needed to build or to run the gate: nothing in it makes a network call.

## Development

```bash
pnpm --filter @resurv/web dev       # the proof page on :5173
pnpm --filter @resurv/worker dev    # the Worker on :8787
pnpm --filter contracts test        # Foundry unit, fuzz and invariant
```

## Testing

| Suite | Count | What it holds up |
|---|---|---|
| Foundry unit and fuzz | 101 | Every covenant path, both adapters, the verifier, adversarial fixtures, and the regressions from the review below |
| Foundry invariants | 13 at 256 runs × depth 128 | Fee moves once, terminal blocks attempts, escrow conserved, admin cannot rewrite an armed covenant |
| `@resurv/domain` | 63 | Both state machines against independent reference models, exhaustively |
| `@resurv/orchestrator` | 22 | Crash resume, concurrent workers, lost response, RPC disagreement, inner failure |
| `@resurv/repo-policy` | 412 | The permission boundary, tracked secrets, the auto-approved script graph |
| `@resurv/seam-probe` | 71 | The Phase 0.5 measurements, asserted against their committed evidence |
| everything else | 139 | Config redaction, chain constants, the proof artifacts, the Worker, the page |

Property tests are judged against reference models transcribed from the PRD that never call the
implementation. The suite was checked by mutation rather than by pass count, twice: eight
deliberate defects during Phase 1 and three more found by an independent audit. Four survived
and every one is now caught, including a mutation permitting an `ARMED -> EXPIRED` transition
that the reference state machine forbids and that nothing noticed, because `canTransition` was
exhaustively tested and never actually called from production code.

Three independent reviews ran against this build — contracts, KeeperHub integration, and test
coverage. They are in-repo reviewers with no write access, not a third-party security audit, and
all three returned FAIL with specific findings. Two were fund-loss defects in
the covenant, both fixed and both now pinned by regression tests in
[`packages/contracts/test/AuditRegressions.t.sol`](packages/contracts/test/AuditRegressions.t.sol).
The full list, including what was deferred and why, is in
[`docs/phase-logs/PHASE_06_REVIEW.md`](docs/phase-logs/PHASE_06_REVIEW.md).

## Deployment

Contracts and the live covenant, both of which spend the organization credential:

```bash
pnpm --filter @resurv/cli live:contracts --dry-run   # predicts every address, sends nothing
pnpm --filter @resurv/cli live:contracts             # deploys through CreateX
pnpm --filter @resurv/cli live:demo --dry-run        # simulates every step, broadcasts nothing
pnpm --filter @resurv/cli live:demo                  # runs the canonical covenant
```

Both resume rather than repeat: every write is journalled with its idempotency key before it is
sent. Neither is reachable from an auto-approved Claude Code command, and
`packages/repo-policy` fails if anyone allow-lists a path to one.

The web application deploys to Cloudflare and nowhere else:

```bash
pnpm build
pnpm --filter @resurv/worker deploy
```

Addresses, bytecode hashes, constructor arguments and compiler settings:
[`deployments/base-sepolia.json`](deployments/base-sepolia.json) and
[`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md).

## Live proof

- **Receipt**: [`docs/proof/canonical-covenant.json`](docs/proof/canonical-covenant.json)
- **Page**: the deployed Worker, or `pnpm --filter @resurv/web dev`
- **JSON**: `GET /api/proof`, `GET /api/proof/summary`, `GET /api/deployment`

`/api/proof/summary` is the endpoint an independent verifier is meant to disagree with: nine
booleans, each reproducible with `cast`.

## Claim discipline

Every public statement carries an evidence level, and
[`docs/CLAIMS.md`](docs/CLAIMS.md) is the ledger. Levels used here: **VERIFIED (Base Sepolia)**
for things that happened on chain, **VERIFIED (local EVM)** for Foundry results,
**VERIFIED** for measurements reproduced from this repository, **DOCUMENTED** for vendor
statements nobody here has reproduced, **ASSUMED** for what the design needs and nobody has
checked, and **REFUTED** for what turned out false.

RESURV does not claim, anywhere: trustlessness, multi-transaction rollback, MEV protection or
private routing, exactly-once execution from KeeperHub idempotency alone, atomic x402 coupling,
or production readiness.

## Limitations

- **Testnet.** Base Sepolia. No mainnet deployment and no external audit, so nothing here is
  production-ready by this project's own definition.
- **Trusted parties.** The KeeperHub organization wallet and the RESURV admin are trusted. In the
  demo the requester, the admin and the executor are the same address; in production they are
  three parties.
- **One reverted-broadcast case was never observed.** Phase 0.5 tried twice to produce a
  transaction that broadcasts and then reverts, and could not: KeeperHub refuses to broadcast a
  call whose gas estimation reverts. `REVERTED` is implemented and tested anyway. Nothing is
  claimed about how a reverted broadcast presents.
- **`safe_inner_failure` is documented and never observed.** It is handled conservatively and
  tested; the evidence level stays DOCUMENTED.
- **No database, by decision.** The orchestrator persists to an `fsync`'d append-only journal,
  which is what ADR-004's durability argument actually requires. There is nothing to provision
  and no connection string. A store two processes could share does not exist and is not needed
  by anything that ships today. [ADR-016](docs/DECISIONS.md).
- **The bounded planner is deterministic.** The model-assisted ranking path in PRD 13 is not
  built; action order is the covenant's committed order. No model is in the safety path, which
  was always the requirement.

## Repository structure

```text
apps/web            the public proof page
apps/worker         one Cloudflare Worker: /api/* plus the SPA
packages/           contracts, domain, keeperhub-client, orchestrator, chain, proof,
                    cli, db, config, node-runtime, repo-policy, seam-probe
deployments/        the deployment manifest, written by the deployment itself
docs/               claims, decisions, threat model, runbooks, proof ladder, phase logs
docs/proof/         the canonical outcome receipt
docs/phase-logs/    what each phase did, what it refuted, and what it could not measure
```

## Clean-room reproduction

```bash
git clone --recurse-submodules <url> resurv && cd resurv
pnpm install --frozen-lockfile
pnpm gate
```

No credential, no network beyond the package registry and the Foundry submodules, no
developer-specific state. Every path in this repository is repo-relative.

Reproducing the *live* half needs a KeeperHub organization key beginning `kh_` in a repository
root `.env`, and it lands real Base Sepolia transactions. See
[`docs/RUNBOOKS.md`](docs/RUNBOOKS.md).

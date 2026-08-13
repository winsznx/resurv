# Deployments

## Base Sepolia, chain 84532

Deployed 2026-08-13 from commit `1d1eb9a`, through CreateX, called by a gas-sponsored
KeeperHub contract call. No deployer key and no faucet were involved. ADR-014.

**This generation is built from the source in this repository at that commit**, which includes
every fix from both audit rounds. The previous generation is archived in
`deployments/historical/base-sepolia-v3.json` and is superseded, not canonical.

| Contract | Address | Deployment transaction | KeeperHub execution |
|---|---|---|---|
| `ResurvCovenantManager` | [`0xdae116d15a2d8a73249a1476f8fdd5edee27fdcc`](https://sepolia.basescan.org/address/0xdae116d15a2d8a73249a1476f8fdd5edee27fdcc) | [`0xdcd76909…`](https://sepolia.basescan.org/tx/0xdcd769094c1788147fd6d92dbbe689e4331ddfbe0ae9352a17d720b91fcfbb5e) | `emmdodymnjn3hqqynwu7j` |
| `PauseAction` | [`0x4075360c09c929d01cc5b52463a14250f65d4ddc`](https://sepolia.basescan.org/address/0x4075360c09c929d01cc5b52463a14250f65d4ddc) | [`0xa7a4c564…`](https://sepolia.basescan.org/tx/0xa7a4c564a33d2cb67b22b9ed25ae0943386183b16180f429d65eb556d79a4116) | `gdhex0t6pzxphrood2og3` |
| `EvacuateERC20Action` | [`0xdb0a34921d863f151b0e0f37c62129344b5c34b4`](https://sepolia.basescan.org/address/0xdb0a34921d863f151b0e0f37c62129344b5c34b4) | [`0x7f2a8b7a…`](https://sepolia.basescan.org/tx/0x7f2a8b7aee2e3b925320b08d4d8deeb9118a8099bb0c13035229819717494cc3) | `qmfvtsy6ijjxyvkw05sgs` |
| `VaultSafeStateVerifier` | [`0xd062df343d9d03523684b20bf1a902bef3d26907`](https://sepolia.basescan.org/address/0xd062df343d9d03523684b20bf1a902bef3d26907) | [`0x2db6ed7a…`](https://sepolia.basescan.org/tx/0x2db6ed7ae4a42462661555246f323aa38d795b581f7d76fd878d52bcdc3cb9e7) | `0v1mb7ukpmtbtmvi214x1` |
| `DemoVault` | [`0x76af5accc7e75d68d9353a404ae897d7b4ec679a`](https://sepolia.basescan.org/address/0x76af5accc7e75d68d9353a404ae897d7b4ec679a) | [`0x672cca4c…`](https://sepolia.basescan.org/tx/0x672cca4c813af3192dd99b19496e4014b1e6133baf398d9b93d7cebeaf09c2c2) | `9xises2nbzrem5t9f5vwh` |
| `TestUSD` | [`0x6783061982b95ee0d272ae70608ba72a4c6882a4`](https://sepolia.basescan.org/address/0x6783061982b95ee0d272ae70608ba72a4c6882a4) | [`0xddb98bc2…`](https://sepolia.basescan.org/tx/0xddb98bc2e1e2c32d9fedc703f08890c17249b6537e3cfa8fcdd62c17a204dfa0) | `1pzvifzoyqw7hgp67bvjf` |

Bytecode hashes, salts, constructor arguments, compiler settings, KeeperHub execution ids and
the source commit are in `deployments/base-sepolia.json`, written by the deployment itself. That
file is the single source of truth: the proof page renders `gitCommit` straight out of it, so a
prose commit id that disagrees with it is a bug in the prose.

Every address was predicted offchain before the transaction was sent and matched what CreateX
reported. The manifest records `predictedAddressMatched` per contract; all six are `true`.

Deployed runtime bytecode was additionally compared byte for byte against locally built
artifacts: `TestUSD`, `VaultSafeStateVerifier` and `DemoVault` match exactly, and
`ResurvCovenantManager`, `PauseAction` and `EvacuateERC20Action` match at equal length with
differences confined to their immutable slots, whose decoded values are the addresses this
manifest records.

Two earlier generations are still on chain under the `resurv/v1` and `resurv/v3` salt namespaces.
Nothing references either. They are superseded rather than deleted, which is why the salt carries
a generation at all. ADR-015.

### Roles as deployed

| Role | Holder | Note |
|---|---|---|
| `DEFAULT_ADMIN_ROLE`, `PAUSER_ROLE`, `EXECUTOR_ROLE` on the manager | `0xfd35ae935de7be93ffd585d6627268d833ed834c` | The KeeperHub organization wallet. In production these are three different parties; here they are one, and `docs/THREAT_MODEL.md` says so |
| `DEMO_VAULT_PAUSER_ROLE` | `PauseAction` | Revoked by the demo before the trigger, which is the whole point of the demo |
| `DEMO_VAULT_RESCUER_ROLE` | `EvacuateERC20Action` | Narrow authority to an adapter, never broad authority to an EOA. PRD 20.3 |

### The canonical covenant

`0x1824fe778dfcc7ed43b79ec6887e762c04952a12763ec7481a05a7a257a23237`

| | |
|---|---|
| Success transaction | [`0x7ac018850024cfd0e2d901840fd395fab852cf8cc23e5f7755c0b3eda8cc7d25`](https://sepolia.basescan.org/tx/0x7ac018850024cfd0e2d901840fd395fab852cf8cc23e5f7755c0b3eda8cc7d25) |
| Block | 45423354 |
| Gas used | 245,555 |
| Terminal status | `SATISFIED` |
| Fee released | 1.000000 rUSD to `0xb0b0…b0b0` |

That one transaction carries six logs, in order: `AttemptStarted`, the vault's `Transfer` to the
approved recipient, `VaultEvacuated`, `AttemptSucceeded`, the escrow's `Transfer` to the
responder, and `CovenantSatisfied`. The action, the outcome check, the state transition and the
payment are the same transaction, which is the property the product exists to demonstrate. Had
the verifier returned false, none of those six logs would exist.

Full receipt: `docs/proof/canonical-covenant.json`.

## Contract source verification

All six contracts are verified on **Sourcify** at `match` level — the strongest one, meaning
both the creation bytecode and the deployed runtime bytecode reproduce exactly from this
repository's source at the pinned compiler settings. Sourcify propagated each to Blockscout.

Verified 2026-08-13 from commit `1d1eb9a`, solc 0.8.36, EVM cancun, optimizer on at 200 runs,
`bytecode_hash = "none"`, `cbor_metadata = false`.

This is worth one paragraph of history, because it is the only reason a bad deployment was
caught. The previous generation (`resurv/v4`) verified five contracts and refused the sixth with
`no_match`. The cause was not Sourcify: the deployment had read a stale artifact cache and put a
**mutant** `ResurvCovenantManager` on chain, compiled from a mutation-testing build with its
`maxTotalAttempts` check deleted. The manifest recorded that mutant's own hashes, so it was
internally consistent and wrong, and every check derived from it agreed with itself. An
independent recompilation was the only thing that could disagree, and it did.
`deployments/historical/base-sepolia-v4-MUTANT.json` keeps that record. `rebuildContracts()` now
compiles from source before any artifact is read.

| Contract | Sourcify | Blockscout |
|---|---|---|
| `ResurvCovenantManager` | [match](https://repo.sourcify.dev/84532/0xdae116d15a2d8a73249a1476f8fdd5edee27fdcc) | [source](https://base-sepolia.blockscout.com/address/0xdae116d15a2d8a73249a1476f8fdd5edee27fdcc?tab=contract) |
| `PauseAction` | [match](https://repo.sourcify.dev/84532/0x4075360c09c929d01cc5b52463a14250f65d4ddc) | [source](https://base-sepolia.blockscout.com/address/0x4075360c09c929d01cc5b52463a14250f65d4ddc?tab=contract) |
| `EvacuateERC20Action` | [match](https://repo.sourcify.dev/84532/0xdb0a34921d863f151b0e0f37c62129344b5c34b4) | [source](https://base-sepolia.blockscout.com/address/0xdb0a34921d863f151b0e0f37c62129344b5c34b4?tab=contract) |
| `VaultSafeStateVerifier` | [match](https://repo.sourcify.dev/84532/0xd062df343d9d03523684b20bf1a902bef3d26907) | [source](https://base-sepolia.blockscout.com/address/0xd062df343d9d03523684b20bf1a902bef3d26907?tab=contract) |
| `DemoVault` | [match](https://repo.sourcify.dev/84532/0x76af5accc7e75d68d9353a404ae897d7b4ec679a) | [source](https://base-sepolia.blockscout.com/address/0x76af5accc7e75d68d9353a404ae897d7b4ec679a?tab=contract) |
| `TestUSD` | [match](https://repo.sourcify.dev/84532/0x6783061982b95ee0d272ae70608ba72a4c6882a4) | [source](https://base-sepolia.blockscout.com/address/0x6783061982b95ee0d272ae70608ba72a4c6882a4?tab=contract) |

Check any of them without trusting this table:

```bash
curl -s https://sourcify.dev/server/v2/contract/84532/0xdae116d15a2d8a73249a1476f8fdd5edee27fdcc \
  | jq '{match, creationMatch, runtimeMatch}'
```

The exact commands that produced it, run from `packages/contracts`:

```bash
W=0xfd35ae935de7be93ffd585d6627268d833ed834c   # KeeperHub organization wallet
T=0x6783061982b95ee0d272ae70608ba72a4c6882a4   # TestUSD
M=0xdae116d15a2d8a73249a1476f8fdd5edee27fdcc   # ResurvCovenantManager

forge verify-contract $T src/demo/TestUSD.sol:TestUSD \
  --chain 84532 --verifier sourcify

forge verify-contract 0xd062df343d9d03523684b20bf1a902bef3d26907 \
  src/verifiers/VaultSafeStateVerifier.sol:VaultSafeStateVerifier \
  --chain 84532 --verifier sourcify

forge verify-contract 0x76af5accc7e75d68d9353a404ae897d7b4ec679a src/demo/DemoVault.sol:DemoVault \
  --chain 84532 --verifier sourcify \
  --constructor-args "$(cast abi-encode 'constructor(address)' $W)"

forge verify-contract 0x4075360c09c929d01cc5b52463a14250f65d4ddc \
  src/actions/PauseAction.sol:PauseAction \
  --chain 84532 --verifier sourcify \
  --constructor-args "$(cast abi-encode 'constructor(address)' $M)"

forge verify-contract 0xdb0a34921d863f151b0e0f37c62129344b5c34b4 \
  src/actions/EvacuateERC20Action.sol:EvacuateERC20Action \
  --chain 84532 --verifier sourcify \
  --constructor-args "$(cast abi-encode 'constructor(address)' $M)"

forge verify-contract $M src/ResurvCovenantManager.sol:ResurvCovenantManager \
  --chain 84532 --verifier sourcify \
  --constructor-args "$(cast abi-encode 'constructor(address,address,address,address[])' $W $W $W "[$T]")"
```

Sourcify rather than Basescan because Basescan's v2 API needs a key this build does not have.
Sourcify needs none, and it reported `Daily limit of 500 source code submissions reached` when it
tried to forward to Etherscan on our behalf, which is why the Basescan tab may still show these
as unverified while Sourcify and Blockscout show the source.

## Reproducing a deployment

Both commands spend the KeeperHub organization credential and land real transactions. Neither is
reachable from an auto-approved Claude Code command, and `packages/repo-policy` fails if anyone
allow-lists a path to one.

```bash
pnpm --filter @resurv/cli live:contracts --dry-run   # predicts every address, sends nothing
pnpm --filter @resurv/cli live:contracts             # deploys
pnpm --filter @resurv/cli live:demo --dry-run        # simulates every step, broadcasts nothing
pnpm --filter @resurv/cli live:demo                  # runs the canonical covenant
```

Both resume rather than repeat. Every write is journalled under `.resurv/` before it is sent,
and a contract already in the manifest is skipped. Re-running `live:contracts` against an
unchanged manifest performs no writes at all.

`live:demo` creates a *new* covenant each run, because its salt carries the run timestamp. That
is deliberate: a covenant is a one-shot object and re-running the demo must not look like
re-triggering a settled one.

## Application: Cloudflare only

One Worker, `resurv`, serving `/api/*` and the built SPA from `apps/web/dist` as static assets.
Configuration lives in `apps/worker/wrangler.jsonc` and is version-controlled. No secret is ever
written to that file.

```bash
pnpm build                                  # builds apps/web then the worker bundle
pnpm --filter @resurv/worker run deploy         # wrangler deploy
```

`wrangler deploy` is denied to Claude Code in every wrapper form, so the deploy itself is a human
step. `wrangler deploy --dry-run --outdir dist` is the build step, touches no account, and is
what `pnpm build` runs.

The application is live at **https://resurv-production.timjosh507.workers.dev**.

**The deployed Worker is provisioned with no secret at all.** `workerEnvSchema` makes
`KEEPERHUB_API_KEY` optional, and `apps/worker/test/health.test.ts` pins that a bare environment
answers `200 ok`. Every route serves either an artifact imported at build time or a public RPC
read, so nothing there executes and nothing there needs a credential. Requiring one would put a
live, write-capable organization key on a public origin to buy a readiness signal, which is a bad
trade. If the Worker is ever given the orchestration loop it does not have today, the key is set
out of band and never committed:

```bash
cd apps/worker
wrangler secret put KEEPERHUB_API_KEY
```

## Contract source verification

Sourcify, because it needs no API key and Basescan's v2 API does. Run from commit `1d1eb9a`:

```bash
cd packages/contracts
forge verify-contract 0xdae116d15a2d8a73249a1476f8fdd5edee27fdcc \
  src/ResurvCovenantManager.sol:ResurvCovenantManager \
  --chain 84532 --verifier sourcify \
  --constructor-args "$(cast abi-encode 'constructor(address,address,address,address[])' \
      0xfd35ae935de7be93ffd585d6627268d833ed834c \
      0xfd35ae935de7be93ffd585d6627268d833ed834c \
      0xfd35ae935de7be93ffd585d6627268d833ed834c \
      '[0x6783061982b95ee0d272ae70608ba72a4c6882a4]')"
```

## Persistence: no database

RESURV ships without one, and that is a decision rather than an omission. ADR-016.

The orchestrator's durable store is `FileAttemptStore`: an append-only JSONL journal that
`fsync`s before `reserve` returns. That is what ADR-004's argument actually requires — the
idempotency key and canonical body on stable storage before the first POST — and it is what
every live deployment and the canonical covenant in this repository ran on.

Nothing to provision. No connection string. No credential.

`packages/db` holds a Drizzle schema and a generated migration that nothing imports at runtime.
It is a design artifact for a multi-worker orchestrator that does not exist, kept because the
shape of the tables is the useful part and regenerating it later from scratch would lose the
reasoning. `pnpm --filter @resurv/db migrate:generate` still regenerates the SQL from the schema
and opens no connection.

The limit worth stating: a journal is durable for one process and is not a store two processes
can share. Nothing in RESURV needs one — the deployed Worker serves read-only routes and has no
write path — and the `AttemptStore` interface is the seam to implement against on the day
something does.

## Gas

Every transaction above was sponsored: the organization wallet holds zero ETH and `sponsored:
true` was returned on each execution. That is an observation across one organization on one
chain, not a guarantee. If sponsorship stops, fund the organization wallet, which is the address
returned as `walletAddress` from `GET /api/user`. Under sponsorship the org wallet neither sends
nor pays, so its explorer transaction list shows nothing either way: `receipt.from` is a relayer
and `receipt.to` a router.

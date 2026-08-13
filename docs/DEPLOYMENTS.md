# Deployments

## Base Sepolia, chain 84532

Deployed 2026-08-13 from commit `b9f8722`, through CreateX, called by a gas-sponsored
KeeperHub contract call. No deployer key and no faucet were involved. ADR-014.

**This generation is built from the source in this repository at that commit**, which includes
every fix from both audit rounds. The previous generation is archived in
`deployments/historical/base-sepolia-v3.json` and is superseded, not canonical.

| Contract | Address | Deployment transaction | KeeperHub execution |
|---|---|---|---|
| `ResurvCovenantManager` | [`0x8e4c71d6c99a10f442e70fd236c3d583d9d9d284`](https://sepolia.basescan.org/address/0x8e4c71d6c99a10f442e70fd236c3d583d9d9d284) | [`0xdcd76909…`](https://sepolia.basescan.org/tx/0xdcd769094c1788147fd6d92dbbe689e4331ddfbe0ae9352a17d720b91fcfbb5e) | `emmdodymnjn3hqqynwu7j` |
| `PauseAction` | [`0x2bf292c9bceac8a2d0846a05b8b49917977c98e2`](https://sepolia.basescan.org/address/0x2bf292c9bceac8a2d0846a05b8b49917977c98e2) | [`0xa7a4c564…`](https://sepolia.basescan.org/tx/0xa7a4c564a33d2cb67b22b9ed25ae0943386183b16180f429d65eb556d79a4116) | `gdhex0t6pzxphrood2og3` |
| `EvacuateERC20Action` | [`0x196f0125e73a78438f1518e5eb46d9f03afd2197`](https://sepolia.basescan.org/address/0x196f0125e73a78438f1518e5eb46d9f03afd2197) | [`0x7f2a8b7a…`](https://sepolia.basescan.org/tx/0x7f2a8b7aee2e3b925320b08d4d8deeb9118a8099bb0c13035229819717494cc3) | `qmfvtsy6ijjxyvkw05sgs` |
| `VaultSafeStateVerifier` | [`0xd71f170915bf9204033b40746ee3c5f05de712f1`](https://sepolia.basescan.org/address/0xd71f170915bf9204033b40746ee3c5f05de712f1) | [`0x2db6ed7a…`](https://sepolia.basescan.org/tx/0x2db6ed7ae4a42462661555246f323aa38d795b581f7d76fd878d52bcdc3cb9e7) | `0v1mb7ukpmtbtmvi214x1` |
| `DemoVault` | [`0x291efc6f53559d8316761309e856772f10d0cdc4`](https://sepolia.basescan.org/address/0x291efc6f53559d8316761309e856772f10d0cdc4) | [`0x672cca4c…`](https://sepolia.basescan.org/tx/0x672cca4c813af3192dd99b19496e4014b1e6133baf398d9b93d7cebeaf09c2c2) | `9xises2nbzrem5t9f5vwh` |
| `TestUSD` | [`0x42a48b758d36866ee18b117f101aafdbb49bc7c7`](https://sepolia.basescan.org/address/0x42a48b758d36866ee18b117f101aafdbb49bc7c7) | [`0xddb98bc2…`](https://sepolia.basescan.org/tx/0xddb98bc2e1e2c32d9fedc703f08890c17249b6537e3cfa8fcdd62c17a204dfa0) | `1pzvifzoyqw7hgp67bvjf` |

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

`0xa5e71176ccfc47947d0a292bdd63fd0b8ccc64a2b62f1cfc9f1cbdb6787c9cf0`

| | |
|---|---|
| Success transaction | [`0xef63ee114dea86da25f1d38802be8bfbdcce166a140f322d283f22a41f9c7e22`](https://sepolia.basescan.org/tx/0xef63ee114dea86da25f1d38802be8bfbdcce166a140f322d283f22a41f9c7e22) |
| Block | 45421180 |
| Gas used | 245,380 |
| Terminal status | `SATISFIED` |
| Fee released | 1.000000 rUSD to `0xb0b0…b0b0` |

That one transaction carries six logs, in order: `AttemptStarted`, the vault's `Transfer` to the
approved recipient, `VaultEvacuated`, `AttemptSucceeded`, the escrow's `Transfer` to the
responder, and `CovenantSatisfied`. The action, the outcome check, the state transition and the
payment are the same transaction, which is the property the product exists to demonstrate. Had
the verifier returned false, none of those six logs would exist.

Full receipt: `docs/proof/canonical-covenant.json`.

## Contract source verification

Five of the six contracts are verified on **Sourcify** at `match` level — the strongest one,
meaning both the creation bytecode and the deployed runtime bytecode reproduce exactly from this
repository's source at the pinned compiler settings. Sourcify propagated each to Blockscout.

`ResurvCovenantManager` is **not verified**. Submission was attempted three times, including from
a clean build, and Sourcify answered `no_match`: "The deployed and recompiled bytecode don't
match." The other five verify from the same build with the same settings, so this is specific to
that contract and unresolved. Nothing here claims it is verified.

The manager's bytecode is still checkable without Sourcify, and this is the check to run:

```bash
cd packages/contracts && forge build
cast code 0x8e4c71d6c99a10f442e70fd236c3d583d9d9d284 --rpc-url https://sepolia.base.org
# compare against out/ResurvCovenantManager.sol/ResurvCovenantManager.json .deployedBytecode.object
# equal length, differing only in the immutable slots, whose decoded values are:
cast call 0x2bf292c9bceac8a2d0846a05b8b49917977c98e2 'manager()(address)' --rpc-url https://sepolia.base.org
cast call 0x196f0125e73a78438f1518e5eb46d9f03afd2197 'manager()(address)' --rpc-url https://sepolia.base.org
# both return the manager address above
```

Verified 2026-08-13 from commit `b9f8722`, solc 0.8.36, EVM cancun, optimizer on at 200 runs,
`bytecode_hash = "none"`, `cbor_metadata = false`.

| Contract | Sourcify | Blockscout |
|---|---|---|
| `ResurvCovenantManager` | **not verified** (`no_match`, three attempts) | — |
| `PauseAction` | [match](https://repo.sourcify.dev/84532/0x2bf292c9bceac8a2d0846a05b8b49917977c98e2) | [source](https://base-sepolia.blockscout.com/address/0x2bf292c9bceac8a2d0846a05b8b49917977c98e2?tab=contract) |
| `EvacuateERC20Action` | [match](https://repo.sourcify.dev/84532/0x196f0125e73a78438f1518e5eb46d9f03afd2197) | [source](https://base-sepolia.blockscout.com/address/0x196f0125e73a78438f1518e5eb46d9f03afd2197?tab=contract) |
| `VaultSafeStateVerifier` | [match](https://repo.sourcify.dev/84532/0xd71f170915bf9204033b40746ee3c5f05de712f1) | [source](https://base-sepolia.blockscout.com/address/0xd71f170915bf9204033b40746ee3c5f05de712f1?tab=contract) |
| `DemoVault` | [match](https://repo.sourcify.dev/84532/0x291efc6f53559d8316761309e856772f10d0cdc4) | [source](https://base-sepolia.blockscout.com/address/0x291efc6f53559d8316761309e856772f10d0cdc4?tab=contract) |
| `TestUSD` | [match](https://repo.sourcify.dev/84532/0x42a48b758d36866ee18b117f101aafdbb49bc7c7) | [source](https://base-sepolia.blockscout.com/address/0x42a48b758d36866ee18b117f101aafdbb49bc7c7?tab=contract) |

Check any of them without trusting this table:

```bash
curl -s https://sourcify.dev/server/v2/contract/84532/0x8e4c71d6c99a10f442e70fd236c3d583d9d9d284 \
  | jq '{match, creationMatch, runtimeMatch}'
```

The exact commands that produced it, run from `packages/contracts`:

```bash
W=0xfd35ae935de7be93ffd585d6627268d833ed834c   # KeeperHub organization wallet
T=0x42a48b758d36866ee18b117f101aafdbb49bc7c7   # TestUSD
M=0x8e4c71d6c99a10f442e70fd236c3d583d9d9d284   # ResurvCovenantManager

forge verify-contract $T src/demo/TestUSD.sol:TestUSD \
  --chain 84532 --verifier sourcify

forge verify-contract 0xd71f170915bf9204033b40746ee3c5f05de712f1 \
  src/verifiers/VaultSafeStateVerifier.sol:VaultSafeStateVerifier \
  --chain 84532 --verifier sourcify

forge verify-contract 0x291efc6f53559d8316761309e856772f10d0cdc4 src/demo/DemoVault.sol:DemoVault \
  --chain 84532 --verifier sourcify \
  --constructor-args "$(cast abi-encode 'constructor(address)' $W)"

forge verify-contract 0x2bf292c9bceac8a2d0846a05b8b49917977c98e2 \
  src/actions/PauseAction.sol:PauseAction \
  --chain 84532 --verifier sourcify \
  --constructor-args "$(cast abi-encode 'constructor(address)' $M)"

forge verify-contract 0x196f0125e73a78438f1518e5eb46d9f03afd2197 \
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
pnpm --filter @resurv/worker deploy         # wrangler deploy
```

`wrangler deploy` is denied to Claude Code in every wrapper form, so the deploy itself is a human
step. `wrangler deploy --dry-run --outdir dist` is the build step, touches no account, and is
what `pnpm build` runs.

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

Sourcify, because it needs no API key and Basescan's v2 API does. Run from commit `b9f8722`:

```bash
cd packages/contracts
forge verify-contract 0x8e4c71d6c99a10f442e70fd236c3d583d9d9d284 \
  src/ResurvCovenantManager.sol:ResurvCovenantManager \
  --chain 84532 --verifier sourcify \
  --constructor-args "$(cast abi-encode 'constructor(address,address,address,address[])' \
      0xfd35ae935de7be93ffd585d6627268d833ed834c \
      0xfd35ae935de7be93ffd585d6627268d833ed834c \
      0xfd35ae935de7be93ffd585d6627268d833ed834c \
      '[0x42a48b758d36866ee18b117f101aafdbb49bc7c7]')"
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

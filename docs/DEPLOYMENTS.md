# Deployments

## Base Sepolia, chain 84532

Deployed 2026-08-12 from commit `42ee514`, through CreateX, called by a gas-sponsored KeeperHub
contract call. No deployer key and no faucet were involved. ADR-014.

| Contract | Address | Deployment transaction |
|---|---|---|
| `ResurvCovenantManager` | [`0xfcafbc81f253e62a3818ecda7a7a71e557c65b21`](https://sepolia.basescan.org/address/0xfcafbc81f253e62a3818ecda7a7a71e557c65b21) | [`0x15f7ba75…`](https://sepolia.basescan.org/tx/0x15f7ba7514e72da39aa57054f7d11035526213461289a15d2d941338b3f3cf2a) |
| `PauseAction` | [`0x84c21e26ed405f6959b53a577afc677854f35fb6`](https://sepolia.basescan.org/address/0x84c21e26ed405f6959b53a577afc677854f35fb6) | [`0x2bc138df…`](https://sepolia.basescan.org/tx/0x2bc138df69b0ed56cf9b592834203742eabecd486e36c42b2551d75cdf274c31) |
| `EvacuateERC20Action` | [`0x498bd80ebc30d51de9764a20abc96b50d6840416`](https://sepolia.basescan.org/address/0x498bd80ebc30d51de9764a20abc96b50d6840416) | [`0x46ed7032…`](https://sepolia.basescan.org/tx/0x46ed703252e3d12b11c9359a45c8b83038fb2ae36bcf0e75316dcf1989a723c3) |
| `VaultSafeStateVerifier` | [`0xde41aab7341db6ef25f513df51a264faf23ca737`](https://sepolia.basescan.org/address/0xde41aab7341db6ef25f513df51a264faf23ca737) | [`0x2fa32479…`](https://sepolia.basescan.org/tx/0x2fa32479531b99ee78b5fe3c95eb7809133fe14fa4ce5b2d1944e2793355f2db) |
| `DemoVault` | [`0x60ff59ea3eac52fd0c02dd8e31a368b4bd2f1cb8`](https://sepolia.basescan.org/address/0x60ff59ea3eac52fd0c02dd8e31a368b4bd2f1cb8) | [`0xc1f5fac1…`](https://sepolia.basescan.org/tx/0xc1f5fac1a76e065deed1b7f2f36e773c49df2d12712b143d216ff1c8deb1fd4b) |
| `TestUSD` | [`0x96981488e239142e340bf32679059baa56bae2b1`](https://sepolia.basescan.org/address/0x96981488e239142e340bf32679059baa56bae2b1) | [`0x06428a7f…`](https://sepolia.basescan.org/tx/0x06428a7fd795c6f771086c4718e664d86116bbf94e956c2eabf38dbe836b3802) |

Bytecode hashes, salts, constructor arguments, compiler settings, KeeperHub execution ids and
the source commit are in `deployments/base-sepolia.json`, written by the deployment itself.

Every address was predicted offchain before the transaction was sent and matched what CreateX
reported. The manifest records `predictedAddressMatched` per contract; all six are `true`.

An earlier generation under the `resurv/v1` salt namespace is still on chain and is unused. It
lacks `createCovenantEncoded` and nothing references it. ADR-015.

### Roles as deployed

| Role | Holder | Note |
|---|---|---|
| `DEFAULT_ADMIN_ROLE`, `PAUSER_ROLE`, `EXECUTOR_ROLE` on the manager | `0xfd35ae935de7be93ffd585d6627268d833ed834c` | The KeeperHub organization wallet. In production these are three different parties; here they are one, and `docs/THREAT_MODEL.md` says so |
| `DEMO_VAULT_PAUSER_ROLE` | `PauseAction` | Revoked by the demo before the trigger, which is the whole point of the demo |
| `DEMO_VAULT_RESCUER_ROLE` | `EvacuateERC20Action` | Narrow authority to an adapter, never broad authority to an EOA. PRD 20.3 |

### The canonical covenant

`0xd7250d1fd4c0f996475b78a00489ce0668bad187b342ca61d88983bf0ec7e14f`

| | |
|---|---|
| Success transaction | [`0xf7f9aace84a73bc236b2b44468026137fa5a52a96511a28f2951001a729d86ab`](https://sepolia.basescan.org/tx/0xf7f9aace84a73bc236b2b44468026137fa5a52a96511a28f2951001a729d86ab) |
| Block | 45398879 |
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

All six contracts are verified on **Sourcify** at `match` level — the strongest one, meaning both
the creation bytecode and the deployed runtime bytecode reproduce exactly from this repository's
source at the pinned compiler settings. Sourcify propagated each one to Blockscout, so there is a
browsable explorer view as well as a machine-checkable one.

Verified 2026-08-12 from commit `2ccf02f`, solc 0.8.36, EVM cancun, optimizer on at 200 runs,
`bytecode_hash = "none"`, `cbor_metadata = false`.

| Contract | Sourcify | Blockscout |
|---|---|---|
| `ResurvCovenantManager` | [match](https://repo.sourcify.dev/84532/0xfcafbc81f253e62a3818ecda7a7a71e557c65b21) | [source](https://base-sepolia.blockscout.com/address/0xfcafbc81f253e62a3818ecda7a7a71e557c65b21?tab=contract) |
| `PauseAction` | [match](https://repo.sourcify.dev/84532/0x84c21e26ed405f6959b53a577afc677854f35fb6) | [source](https://base-sepolia.blockscout.com/address/0x84c21e26ed405f6959b53a577afc677854f35fb6?tab=contract) |
| `EvacuateERC20Action` | [match](https://repo.sourcify.dev/84532/0x498bd80ebc30d51de9764a20abc96b50d6840416) | [source](https://base-sepolia.blockscout.com/address/0x498bd80ebc30d51de9764a20abc96b50d6840416?tab=contract) |
| `VaultSafeStateVerifier` | [match](https://repo.sourcify.dev/84532/0xde41aab7341db6ef25f513df51a264faf23ca737) | [source](https://base-sepolia.blockscout.com/address/0xde41aab7341db6ef25f513df51a264faf23ca737?tab=contract) |
| `DemoVault` | [match](https://repo.sourcify.dev/84532/0x60ff59ea3eac52fd0c02dd8e31a368b4bd2f1cb8) | [source](https://base-sepolia.blockscout.com/address/0x60ff59ea3eac52fd0c02dd8e31a368b4bd2f1cb8?tab=contract) |
| `TestUSD` | [match](https://repo.sourcify.dev/84532/0x96981488e239142e340bf32679059baa56bae2b1) | [source](https://base-sepolia.blockscout.com/address/0x96981488e239142e340bf32679059baa56bae2b1?tab=contract) |

Check any of them without trusting this table:

```bash
curl -s https://sourcify.dev/server/v2/contract/84532/0xfcafbc81f253e62a3818ecda7a7a71e557c65b21 \
  | jq '{match, creationMatch, runtimeMatch}'
```

The exact commands that produced it, run from `packages/contracts`:

```bash
W=0xfd35ae935de7be93ffd585d6627268d833ed834c   # KeeperHub organization wallet
T=0x96981488e239142e340bf32679059baa56bae2b1   # TestUSD
M=0xfcafbc81f253e62a3818ecda7a7a71e557c65b21   # ResurvCovenantManager

forge verify-contract $T src/demo/TestUSD.sol:TestUSD \
  --chain 84532 --verifier sourcify

forge verify-contract 0xde41aab7341db6ef25f513df51a264faf23ca737 \
  src/verifiers/VaultSafeStateVerifier.sol:VaultSafeStateVerifier \
  --chain 84532 --verifier sourcify

forge verify-contract 0x60ff59ea3eac52fd0c02dd8e31a368b4bd2f1cb8 src/demo/DemoVault.sol:DemoVault \
  --chain 84532 --verifier sourcify \
  --constructor-args "$(cast abi-encode 'constructor(address)' $W)"

forge verify-contract 0x84c21e26ed405f6959b53a577afc677854f35fb6 \
  src/actions/PauseAction.sol:PauseAction \
  --chain 84532 --verifier sourcify \
  --constructor-args "$(cast abi-encode 'constructor(address)' $M)"

forge verify-contract 0x498bd80ebc30d51de9764a20abc96b50d6840416 \
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

## What is deployed is not what is on `main`

The six addresses hold bytecode compiled from commit **`2ccf02f`**. The second `contracts-auditor`
round ran after that and found three ways to trap a covenant's escrow permanently, each with a
working proof-of-concept. All three are fixed in this repository and **still present on chain**:

| Finding | Shape | Fixed in source by |
|---|---|---|
| H-A | A verifier returning 96 bytes with a non-boolean first word reverted the expiry in the manager's own frame | assembly read of the bool word |
| M-B | A verifier returning a trailing tail answered `true` to every typed path while the expiry called it "not conforming" and refunded | `< 96` instead of `!= 96` |
| M-A | A global pause closed the last exit for a covenant whose outcome came true past its deadline | dropped `whenNotPaused` from `finalizeAlreadySatisfied` |

Redeploying is a human step, and it would invalidate the canonical receipt every public surface
cites. It was not done. What that means precisely:

- The canonical covenant is unaffected. It uses the shipped `VaultSafeStateVerifier`, which answers
  in exactly 96 bytes with a clean boolean, and the manager was never paused. All three defects
  need a malformed verifier the requester chose, or the admin to pause.
- Anyone arming a covenant against the deployed manager with their own verifier is exposed to all
  three. This is a testnet demo and nothing invites that.
- The Sourcify `match` below is still accurate: it attests the deployed bytecode reproduces from
  `2ccf02f`, and it has never attested anything about `main`.

Full account: `docs/phase-logs/PHASE_07_FINAL_AUDIT.md`.

## Contract source verification

Sourcify, because it needs no API key and Basescan's v2 API does. Run from commit `2ccf02f`:

```bash
cd packages/contracts
forge verify-contract 0xfcafbc81f253e62a3818ecda7a7a71e557c65b21 \
  src/ResurvCovenantManager.sol:ResurvCovenantManager \
  --chain 84532 --verifier sourcify \
  --constructor-args "$(cast abi-encode 'constructor(address,address,address,address[])' \
      0xfd35ae935de7be93ffd585d6627268d833ed834c \
      0xfd35ae935de7be93ffd585d6627268d833ed834c \
      0xfd35ae935de7be93ffd585d6627268d833ed834c \
      '[0x96981488e239142e340bf32679059baa56bae2b1]')"
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

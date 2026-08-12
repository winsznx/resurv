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

Secrets are set out of band and never committed:

```bash
cd apps/worker
wrangler secret put KEEPERHUB_API_KEY
```

The deployed Worker needs no KeeperHub credential to serve the proof page: the page reads chain
and the committed receipt. The credential is only needed if the Worker is ever given the
orchestration loop, which it does not have today.

## Contract source verification

Sourcify, because it needs no API key and Basescan's v2 API does:

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

## Database: Supabase Postgres

Schema and the generated migration live in `packages/db`. No live connection exists.

The live demo does not need one. `packages/orchestrator` defines the durable store as an
interface with two implementations: `FileAttemptStore`, an `fsync`'d append-only journal used by
the CLI runner, and the Supabase-backed store used by a deployed multi-worker orchestrator. Both
pass the same conformance suite. ADR-004's requirement is durability before the first POST, and
the journal satisfies it for a single process; what it does not satisfy is two workers sharing a
store, which is why the interface exists.

### USER ACTION REQUIRED to run the orchestrator as a service

| Variable | Why |
|---|---|
| `SUPABASE_URL` | Project endpoint |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side writes from the Worker. Must never reach browser code |
| `DATABASE_URL` | Migration application, transaction-mode pooling for a serverless caller |

## Gas

Every transaction above was sponsored: the organization wallet holds zero ETH and `sponsored:
true` was returned on each execution. That is an observation across one organization on one
chain, not a guarantee. If sponsorship stops, fund the organization wallet, which is the address
returned as `walletAddress` from `GET /api/user`. Under sponsorship the org wallet neither sends
nor pays, so its explorer transaction list shows nothing either way: `receipt.from` is a relayer
and `receipt.to` a router.

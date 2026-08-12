# Deployments

## Base Sepolia, chain 84532

Deployed 2026-08-12 from commit `42ee514`, through CreateX, called by a gas-sponsored KeeperHub
contract call. No deployer key and no faucet were involved. ADR-014.

| Contract | Address | Deployment transaction |
|---|---|---|
| `ResurvCovenantManager` | [`0x01cd0adb80df64d223e6e95789d29f144e87a037`](https://sepolia.basescan.org/address/0x01cd0adb80df64d223e6e95789d29f144e87a037) | [`0x2fc86c90…`](https://sepolia.basescan.org/tx/0x2fc86c90a0150d857a6177518ef2c7311655c8aa3647cb36af53718d54f45d4f) |
| `PauseAction` | [`0x345fdcfe25d6fbb436b02589dadbaabed413789a`](https://sepolia.basescan.org/address/0x345fdcfe25d6fbb436b02589dadbaabed413789a) | [`0xf47f0b75…`](https://sepolia.basescan.org/tx/0xf47f0b7530318dda032eed22bbd92ac0bf44ef221c6a1d8c6dc25b096ba581d1) |
| `EvacuateERC20Action` | [`0x944def229e6ff8321738ee5caf9487182ab31c02`](https://sepolia.basescan.org/address/0x944def229e6ff8321738ee5caf9487182ab31c02) | [`0x6f20a3bb…`](https://sepolia.basescan.org/tx/0x6f20a3bb84758e6435ac3b13f7a4fc5e586c2c85cedfc5789cc8a15cee666f4a) |
| `VaultSafeStateVerifier` | [`0x453bd9bec0caa6e13bbd9f0ede86a4b1794dc5c8`](https://sepolia.basescan.org/address/0x453bd9bec0caa6e13bbd9f0ede86a4b1794dc5c8) | [`0x105f2776…`](https://sepolia.basescan.org/tx/0x105f2776518fcaaef1efaeec774798ae423c6f4c50bc1035f535ef8d817027f5) |
| `DemoVault` | [`0x721a99416f2c32a139e1a96a647e8d4e006db335`](https://sepolia.basescan.org/address/0x721a99416f2c32a139e1a96a647e8d4e006db335) | [`0x4e1a55c2…`](https://sepolia.basescan.org/tx/0x4e1a55c29e9b1d7f1cbe22b62344c303dd3176ed1e404ec0ef03b458d8174144) |
| `TestUSD` | [`0x791e9c8995b58a4da393896c9d51819e50c66c47`](https://sepolia.basescan.org/address/0x791e9c8995b58a4da393896c9d51819e50c66c47) | [`0x61efa2ce…`](https://sepolia.basescan.org/tx/0x61efa2ce67be5cfc90a7536f1a31c111a57ec8e476f19d41554137abb4cf7a1d) |

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

`0xb8c1c6ecb47cd4ed69755ca28e651348e72d58700ecf63da6e2c25896265694d`

| | |
|---|---|
| Success transaction | [`0x9ea030674ca2e9ee8729bf00a6fbf53cd48320c23d0ae0a0b9780bb0da59dbcb`](https://sepolia.basescan.org/tx/0x9ea030674ca2e9ee8729bf00a6fbf53cd48320c23d0ae0a0b9780bb0da59dbcb) |
| Block | 45397010 |
| Gas used | 245,531 |
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
forge verify-contract 0x01cd0adb80df64d223e6e95789d29f144e87a037 \
  src/ResurvCovenantManager.sol:ResurvCovenantManager \
  --chain 84532 --verifier sourcify \
  --constructor-args "$(cast abi-encode 'constructor(address,address,address,address[])' \
      0xfd35ae935de7be93ffd585d6627268d833ed834c \
      0xfd35ae935de7be93ffd585d6627268d833ed834c \
      0xfd35ae935de7be93ffd585d6627268d833ed834c \
      '[0x791e9c8995b58a4da393896c9d51819e50c66c47]')"
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

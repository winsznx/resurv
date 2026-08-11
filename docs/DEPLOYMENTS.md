# Deployments

Nothing is deployed yet. This file records the target topology, the exact commands, and what
is still missing. It is updated the moment anything reaches a network.

## Deployed resources

| Resource | Network | Address / URL | Deployed | Commit |
|---|---|---|---|---|
| Covenant contract | Base Sepolia | not deployed | | |
| Demo vault | Base Sepolia | not deployed | | |
| Verifier | Base Sepolia | not deployed | | |
| Worker | Cloudflare | not deployed | | |

## Application: Cloudflare only

One Worker, `resurv`, serving `/api/*` and the built SPA from `apps/web/dist` as static
assets. Configuration lives in `apps/worker/wrangler.jsonc` and is version-controlled. No
secret is ever written to that file.

```bash
pnpm build                                  # builds apps/web then the worker bundle
pnpm --filter @resurv/worker deploy         # wrangler deploy
```

Secrets are set out of band and never committed:

```bash
cd apps/worker
wrangler secret put KEEPERHUB_API_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # when the database is wired
```

`wrangler deploy --dry-run --outdir dist` is the build step and touches no account, which is
why `pnpm build` is safe to run in CI.

Cloudflare Queues and Durable Objects are named in the architecture but not provisioned.
Neither is added until the orchestrator phase proves it is needed.

## Contracts: Base Sepolia

Chain id 84532. Explorer `https://sepolia.basescan.org`. Public RPC `https://sepolia.base.org`
with `https://base-sepolia-rpc.publicnode.com` as the independent second origin.

Deployment is a deliberate, reviewed step and is not part of any build:

```bash
cd packages/contracts
forge script script/Deploy.s.sol --rpc-url "$RPC_URL_PRIMARY" --broadcast --verify
```

The deploy script does not exist yet. When it does, the run must record the address, the
runtime bytecode hash, the commit, and the transaction, into the table above.

Mainnet deployment is out of scope for v1 and is not performed from Claude Code.

## Database: Supabase Postgres

Schema and the generated migration live in `packages/db`. No live connection exists.

```bash
pnpm --filter @resurv/db migrate:generate    # regenerates SQL from the schema, no connection
```

Applying migrations is a deploy step, never a build step.

### USER ACTION REQUIRED when the orchestrator needs durable state

Not blocking today. The orchestrator can be built and tested against the repository
interfaces in `packages/db/src/repositories.ts` with an in-memory double.

What will be needed, and why:

| Variable | Why |
|---|---|
| `SUPABASE_URL` | Project endpoint |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side writes from the Worker. Must never reach browser code |
| `DATABASE_URL` | Migration application, transaction-mode pooling for a serverless caller |

Two rules that apply the moment it is wired: use transaction-mode pooling or the HTTP client
rather than a long-lived direct Postgres socket, since a Worker cannot hold one; and enable
plus test row-level security on every table exposed through a client-facing Data API.

## Gas

Gas sponsorship was observed on Base Sepolia for this organization: the org wallet held zero
ETH and a transaction still landed with `sponsored: true`. That is an observation from one
run, not a guarantee, and the funding path below stays documented in case it does not hold.

If sponsorship is unavailable, fund the KeeperHub organization wallet, which is the address
returned as `walletAddress` from `GET /api/user`, and is not the sign-in wallet. Under
sponsorship the org wallet neither sends nor pays, so checking its explorer transaction list
proves nothing either way.

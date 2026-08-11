# Architecture decisions

Lightweight ADRs. Each entry records what was decided, what it replaced, and what would make
us revisit it. Rejected alternatives are recorded because the reasoning is the valuable part.

---

## ADR-001: Cloudflare Workers replaces the PRD's Railway profile

Date: 2026-08-11. Status: accepted. Phase: 0.

### Context

PRD 14.2 recommends Fastify for the API, Redis plus BullMQ for jobs and locks, Docker Compose
for local infrastructure, and a Railway deployment profile. A later operating instruction
requires all web-facing infrastructure to deploy to Cloudflare and explicitly forbids Railway,
Vercel, Netlify, Render, Fly.io, AWS, GCP and Azure.

### Decision

Cloudflare Workers is the deployment target. The PRD's service *responsibilities* are kept;
its *implementations* are replaced with the Cloudflare-native equivalent.

| PRD component | Built as | Why |
|---|---|---|
| Fastify API | Hono on Workers | Fastify assumes a Node HTTP server. Hono is the Workers-native router. |
| Redis + BullMQ | Cloudflare Queues, Durable Objects for locks | Neither runs in workerd. No TCP-Redis on the edge. |
| Docker Compose | not used | Nothing local to orchestrate once the runtime is Workers. |
| Railway | Workers + Workers Static Assets | Required by the operating instruction. |
| PostgreSQL | Supabase Postgres | Required by the operating instruction. See ADR-004. |

### Consequences

The PRD's stack section is now partially superseded and should be read as intent, not as a
parts list. Queues and Durable Objects are named here but not yet provisioned: nothing is
added until the orchestrator phase proves it is needed.

### Revisit if

The deployment constraint changes, or a Workers limit (CPU time, subrequest count) turns out
to block the reconciliation loop.

---

## ADR-002: One Worker with three entry points, not two deployables

Date: 2026-08-11. Status: accepted. Phase: 0.

### Context

PRD 14.4 separates API from Worker, and is explicit that the API must contain no
long-running execution loop. A naive reading suggests two deployments.

### Decision

One Worker exporting `fetch`, and later `scheduled` and `queue`. The architectural boundary
the PRD cares about is preserved, because the execution loop lives in `queue` and `scheduled`,
which are separate entry points that a request to `fetch` cannot enter.

### Alternatives rejected

Two Workers: doubles deploy surface and introduces service-binding or CORS plumbing for no
gain in the property the PRD is protecting.

Serving the SPA from a second origin: adds CORS to the critical demo path.

### Consequences

`apps/worker/wrangler.jsonc` serves `apps/web/dist` as static assets with `run_worker_first`
scoped to `/api/*`. One deploy, one origin, no CORS.

---

## ADR-003: TypeScript 7 pinned after empirical verification

Date: 2026-08-11. Status: accepted. Phase: 0.

### Context

`typescript@latest` resolves to 7.0.2, the native rewrite. Adopting a new major on a 46-hour
deadline is a real risk. The version policy in PRD 2.3 requires resolving the current stable
release rather than picking a comfortable one.

### Decision

Pin 7.0.2, then verify by typechecking the entire workspace under the full strict option set
before committing to it. All 14 tasks pass.

### Consequences

Documented rollback to 6.0.3 in `docs/VERSIONS.md`, expected to need no source changes.

---

## ADR-004: A database is justified, and the live connection is off the Phase 0 critical path

Date: 2026-08-11. Status: accepted. Phase: 0.

### Context

The operating instruction says not to add a database merely because most applications have
one, and to prove persistent offchain state is necessary first.

### The proof

KeeperHub's `/api/execute/contract-call` executes synchronously and returns HTTP 202. There
is no list-executions endpoint. If the client dies between sending the request and reading the
response, the execution id exists nowhere locally and cannot be recovered by querying. The
documented recovery is to replay the same `Idempotency-Key` with a byte-identical body. That
requires the key and the canonical body to be durable *before* the first POST. An in-memory
or per-request store cannot provide that. Persistent offchain state is therefore necessary,
not conventional.

### Decision

Supabase Postgres, per the operating instruction. Phase 0 delivers the schema, the generated
migration, and the typed repository interfaces, with no live connection. `@resurv/db` exposes
interfaces the orchestrator depends on, so crash-recovery logic can be built and tested
against an in-memory double while real credentials remain outstanding.

### Alternatives rejected

Cloudflare D1 would remove an external credential dependency and is native to the runtime.
Rejected because the operating instruction names Supabase explicitly and forbids falling back
to another hosted database. Flagged here because it is the one place where the infrastructure
constraint and the deadline pull in opposite directions.

### Open item

Supabase project credentials are not available. When the orchestrator needs a live
connection this becomes a blocking `USER ACTION REQUIRED`. Connection strategy for a
serverless runtime is transaction-mode pooling or the HTTP client, never a long-lived direct
Postgres socket, and the service-role key stays server-side.

---

## ADR-005: The contracts package is named `contracts`, unscoped

Date: 2026-08-11. Status: accepted. Phase: 0.

CLAUDE.md documents `pnpm --filter contracts test` and `pnpm --filter contracts test:invariant`
as required checks. pnpm's filter matches the full package name, so `@resurv/contracts` would
not resolve those documented commands and the Phase 0 exit gate requires every documented
command to work. Every other package keeps the `@resurv/` scope.

---

## ADR-006: Library packages are consumed as TypeScript source

Date: 2026-08-11. Status: accepted. Phase: 0.

`@resurv/domain`, `keeperhub-client`, `chain`, `config` and `db` export `./src/index.ts`
directly and have no build step. Vite and wrangler both bundle from source. Emitting
declarations would produce artifacts nothing consumes, and turbo correctly warned that those
build tasks generated no output. Apps build; libraries do not.

---

## ADR-007: The reference state machine exists in Solidity and TypeScript, cross-pinned

Date: 2026-08-11. Status: accepted. Phase: 0.

`CovenantStatus` ordinals are consensus-relevant: the contract emits the numeric value and
the TypeScript decoder reads it. Both sides assert the ordinals independently
(`test/CovenantStatus.t.sol` and `packages/domain/test/covenant-status.test.ts`), and
`packages/db` asserts its Postgres enum matches the domain names in order. A reordering
breaks three test suites in three languages rather than silently mis-decoding an event.

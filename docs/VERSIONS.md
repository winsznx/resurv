# Resolved versions

Every version below was resolved from a live registry or official source on the date shown,
not copied from the PRD and not recalled from memory. Exact pins only. No `latest` tags, no
caret ranges. A major-version change after Phase 0 requires an entry in the relevant phase
log and a full regression gate.

Resolution date: 2026-08-11.

## Toolchain

| Tool | Pinned | Source | Notes |
|---|---|---|---|
| Node.js | 24.19.0 | local `node --version` | Current active LTS. `engines.node >= 24`. |
| pnpm | 11.21.0 | local `pnpm --version` | Pinned via root `packageManager`. |
| Foundry | 1.7.1 (2026-05-08) | local `forge --version` | forge, cast, anvil from one distribution. |
| solc | 0.8.36 | `binaries.soliditylang.org` `latestRelease` | Pinned in `foundry.toml`. |

## JavaScript and TypeScript

| Package | Pinned | Registry `latest` | Notes |
|---|---|---|---|
| typescript | 7.0.2 | 7.0.2 | See TS-7 note below. |
| turbo | 2.10.9 | 2.10.9 | Task graph and caching. |
| @biomejs/biome | 2.5.8 | 2.5.8 | Formatter and linter in one tool. |
| @types/node | 26.2.0 | 26.2.0 | |
| vitest | 4.1.10 | 4.1.10 | |
| zod | 4.4.3 | 4.4.3 | Runtime schemas. |
| viem | 2.55.13 | 2.55.13 | EVM reads, event decoding, typed ABIs. |
| hono | 4.13.1 | 4.13.1 | Worker HTTP router. |
| drizzle-orm | 0.45.2 | 0.45.2 | |
| drizzle-kit | 0.31.10 | 0.31.10 | Migration generation only. |
| @supabase/supabase-js | 2.112.3 | 2.112.3 | Declared, not yet wired. See DECISIONS ADR-004. |
| wrangler | 4.120.1 | 4.120.1 | See miniflare note below. |
| @cloudflare/workers-types | 5.20260811.1 | 5.20260811.1 | Dated release line. |
| react / react-dom | 19.2.8 | 19.2.8 | |
| vite | 8.2.1 | 8.2.1 | |
| @vitejs/plugin-react | 6.0.5 | 6.0.5 | |
| tailwindcss / @tailwindcss/vite | 4.3.3 | 4.3.3 | Tokens only at Phase 0. |

## Solidity

| Dependency | Pinned | Source | Notes |
|---|---|---|---|
| forge-std | v1.16.2 | GitHub tags | Pinned git submodule at `bf647bd` under `packages/contracts/lib`. |
| openzeppelin-contracts | v5.6.1 | npm `latest` dist-tag | Pinned git submodule at `5fd1781`. `git submodule status` prints `(v4.8.0-1122-g5fd1781b)` for it, which is the same commit described against a different tag. See OZ note below. |

Both are submodules, not vendored files. `git ls-files -s packages/contracts/lib` returns two
entries at mode `160000`, and a clone without `--recurse-submodules` produces empty directories.
The Phase 0 wording here claimed they were vendored and needed no install step, which was false
in both halves: they are gitlinks, and populating them is a network fetch from GitHub. Foundry
1.7.1 performs that fetch itself when `lib` is empty, so a plain clone does still pass the gate
on a networked machine, which is convenient and is not the same property as vendoring. See
`docs/RUNBOOKS.md` for the canonical clone and the repair command.

## Compatibility notes worth keeping

### TypeScript 7.0.2 is the native rewrite, and it was verified rather than assumed

`typescript@latest` now resolves to the 7.x line. 6.0.3 is the last 7-preceding stable. Rather
than guess at ecosystem readiness, 7.0.2 was pinned and the whole workspace typechecked
against it with the full strict option set enabled. One config change was required,
`allowImportingTsExtensions`, which is a consequence of importing `.ts` specifiers directly
and not a TS-7 defect.

Two corrections from the Phase 0 independent review. The task count stated here was 14 and was
not reproducible; a forced run reports **10 turbo tasks** as of the Phase 0 remediation, which
added `@resurv/repo-policy` to the 9 that existed before. And what was verified is RESURV's own
source compiled against React 19, Hono, Drizzle, viem, Vite 8 and the Workers types, not those
packages' own declaration files: `tsconfig.base.json` sets `skipLibCheck: true`. Turning it off
surfaces errors in `@vitest/utils`, `tinybench` and `vite` declarations that are missing DOM
globals under the deliberate `lib: ["ES2023"]` setting, appear identically under TypeScript 6,
and are a configuration consequence rather than a TS-7 defect.

Rollback path if a later phase hits a TS-7 incompatibility: change `typescript` to `6.0.3` in
the root and in each package, reinstall, rerun `pnpm typecheck`. No source changes expected.
The independent reviewer executed that rollback in a fresh clone with a `typescript: 6.0.3`
workspace override: typecheck and test both pass with zero source changes, which is what makes
the pin defensible rather than merely declared.

### OpenZeppelin: npm and GitHub disagree, and we took the stable channel

GitHub carries a `v5.7.0` tag published 2026-07-29, but npm's `latest` dist-tag still points
at `5.6.1` and `5.7.0` sits on the `dev` tag. For an audited dependency that will hold
escrowed funds, the stable channel wins. Revisit when npm promotes 5.7.0 to `latest`.

### wrangler 4.120.1 pulls a prerelease miniflare

`miniflare@5.20260804.0-alpha` arrives as a transitive dependency of wrangler. It affects
local development and the Workers test pool, not deployed output. Recorded here so nobody
discovers it later and assumes we chose it.

### evm_version is pinned to cancun

Base Sepolia supports Cancun. The value is set explicitly in `foundry.toml` rather than
inherited from the compiler default, so a future solc bump cannot silently change the emitted
opcode set under us.

### Deliberately not installed

The PRD's recommended stack names Fastify, Redis, BullMQ, Docker Compose and a Railway
deployment profile. None are installed. They do not run on Cloudflare Workers, which is the
required deployment target. See `docs/DECISIONS.md` ADR-001 and ADR-002.

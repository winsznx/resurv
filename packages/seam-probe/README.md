# @resurv/seam-probe

The Phase 0.5 KeeperHub attempt-semantics probe. It answers one question:

> Can RESURV distinguish the state of one semantic recovery attempt strongly enough that it
> never advances to another recovery action while the previous action could still produce an
> onchain effect?

## Two halves, deliberately separated

| Command | Network | In `pnpm gate` | Auto-approved for Claude Code |
|---|---|---|---|
| `pnpm --filter @resurv/seam-probe test` | none | yes | yes |
| `pnpm --filter @resurv/seam-probe test:seam` | KeeperHub + Base Sepolia | no | **no** |

The offline half tests the sanitizer, the evidence writer's fail-closed guard, and the semantic
attempt identity. The live half spends the organization credential and lands real transactions,
so it is an explicit act by whoever holds the credential.

`packages/repo-policy/src/dangerous-commands.ts` classifies `vitest run --dir test/live` as an
external effect, so the policy suite fails if anyone ever adds an allow rule that reaches it.

## What stops it running by accident

The credential is the capability. There is no credential file in this repository by default and
nothing here creates one, so the live half fails at `beforeAll` with `USER ACTION REQUIRED` and
a list of the runtime configuration paths it looked in. That is the control. The permission
tiers are not: `docs/DECISIONS.md` ADR-010 records that `ask` was measured not to prompt in the
mode this project's sessions run in.

## Credential

`KEEPERHUB_API_KEY`, an organization key beginning `kh_`. A `wfb_` webhook key cannot execute.
`src/local-env.ts` reads it from the first readable of five paths, listed in
`LOCAL_ENV_CANDIDATES`, and never overwrites a value already in the process environment. It
returns variable *names*, never values, so a caller that prints its result cannot print a
credential.

`docs/RUNBOOKS.md` has the operational version.

## Evidence

One JSON file per scenario in `docs/phase-logs/evidence/phase-00-5/`, plus `index.json`.

`src/sanitize.ts` removes credentials and **keeps** transaction hashes, addresses, topics and
calldata. That is the opposite of `@resurv/config`'s `redact`, which fails closed on any 32-byte
hex value because a private key and a transaction hash are the same 66 characters. A seam report
whose hashes are all `[redacted]` proves nothing. `test/offline/sanitize.test.ts` pins both
halves of that trade, and `writeEvidence` re-scans the serialized output and throws rather than
write a file that still contains a credential shape.

## Fixture

`0x2A6FC8182Bf9928Ef7517dA980dC79e8107c555A` on Base Sepolia: one function, `ping(bytes32)`, no
fallback, no receive. Success and revert are both properties of the bytecode rather than of
anyone's protocol state, and no deployment, deployer key or faucet is involved. The reasoning
and the verification commands are in `docs/keeperhub/SEAM_CHECKLIST.md`.

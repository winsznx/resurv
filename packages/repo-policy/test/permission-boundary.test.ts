import { describe, expect, it } from 'vitest';
import { decide, type PermissionRules } from '../src/bash-rules.ts';
import { hasExternalEffect, isCommandRunner, readsSecrets } from '../src/dangerous-commands.ts';
import { readRepoJson, workspacePackages } from '../src/repo.ts';

/**
 * The Phase 0 independent review proved that `.claude/settings.json` granted more authority
 * than it read like: `pnpm --filter @resurv/worker deploy` reached `wrangler deploy` while
 * `wrangler deploy` itself sat behind `ask`, and allow-listed `node -e`, `rg` and `jq` could
 * print the bytes of a file that `Read(./.env)` denies.
 *
 * These tests encode the boundary as executable policy. They do not make the settings file a
 * sandbox and `docs/THREAT_MODEL.md` says so; they make a regression to the proven bypasses
 * a failing test rather than a quiet change.
 */

interface Settings {
  readonly permissions: PermissionRules;
}

const rules = readRepoJson<Settings>('.claude/settings.json').permissions;

const PROVEN_BYPASSES: readonly string[] = [
  'pnpm --filter @resurv/worker deploy',
  'pnpm run deploy',
  'pnpm exec wrangler deploy',
  'pnpm exec wrangler secret put KEEPERHUB_API_KEY',
  'pnpm exec cast send 0x0000000000000000000000000000000000000001 --value 1ether',
  'pnpm exec forge script script/Deploy.s.sol --broadcast',
  'pnpm dlx wrangler deploy',
  'npx wrangler deploy',
  'turbo run deploy',
  'wrangler deploy',
  'wrangler secret put KEEPERHUB_API_KEY',
  'cast send 0x0000000000000000000000000000000000000001',
  'forge create src/Covenant.sol:Covenant',
  'forge script script/Deploy.s.sol --rpc-url https://sepolia.base.org --broadcast',
];

const SECRET_READ_PATHS: readonly string[] = [
  'cat .env',
  'head -n 5 .dev.vars',
  'sed -n 1p .env',
  'grep KEEPERHUB_API_KEY .env',
  'rg kh_ .env',
  'jq . .dev.vars',
  "node -e \"console.log(require('node:fs').readFileSync('.env', 'utf8'))\"",
  'find . -name .env -exec cat {} ;',
  'cat secrets/deployer.json',
  'cat keystores/local.json',
  'printenv',
  'env',
];

const GENERIC_INTERPRETERS: readonly string[] = [
  'node -e "1"',
  'node --eval "1"',
  'bash -c "id"',
  'sh -c "id"',
  'python3 -c "print(1)"',
  'rg pattern .',
  'jq . package.json',
  'base64 package.json',
  'xxd package.json',
];

const MUST_STAY_AUTONOMOUS: readonly string[] = [
  'pnpm format:check',
  'pnpm lint',
  'pnpm typecheck',
  'pnpm test',
  'pnpm test:integration',
  'pnpm test:e2e',
  'pnpm build',
  'pnpm gate',
  'pnpm --filter contracts test',
  'pnpm --filter contracts test:invariant',
  'pnpm --filter @resurv/worker build',
  'pnpm --filter @resurv/worker test',
  'pnpm --filter @resurv/web dev',
  'pnpm --filter @resurv/db migrate:generate',
  'turbo run test --force',
  'forge test -vv',
  'forge build --sizes',
  'forge fmt --check',
  'anvil --port 8545',
  'cast call 0x0000000000000000000000000000000000000001 "x()"',
  'git status --short',
  'git diff --stat',
  'git log --oneline -5',
  'git ls-files -s',
];

describe('external effects are never auto-approved', () => {
  it.each(PROVEN_BYPASSES)('blocks %s', (command) => {
    expect(decide(command, rules)).toBe('deny');
  });

  it('keeps the bypass list honest: each entry is an external effect or a runner that reaches one', () => {
    for (const command of PROVEN_BYPASSES) {
      expect(hasExternalEffect(command) || isCommandRunner(command), command).toBe(true);
    }
  });
});

describe('secret files are not readable through an equivalent command path', () => {
  it.each(SECRET_READ_PATHS)('blocks %s', (command) => {
    expect(decide(command, rules)).toBe('deny');
  });
});

describe('generic interpreters are not broadly auto-approved', () => {
  it.each(GENERIC_INTERPRETERS)('does not auto-approve %s', (command) => {
    expect(decide(command, rules)).not.toBe('allow');
  });
});

describe('ordinary repo-local development stays autonomous', () => {
  it.each(MUST_STAY_AUTONOMOUS)('auto-approves %s', (command) => {
    expect(decide(command, rules)).toBe('allow');
  });
});

describe('the allow list itself', () => {
  it('never combines a command runner with an open wildcard tail', () => {
    for (const rule of rules.allow) {
      const pattern = rule.replace(/^Bash\((.*)\)$/s, '$1');
      const openEnded = pattern.includes('*');
      expect(isCommandRunner(pattern) && openEnded, `${rule} grants whatever follows it`).toBe(
        false,
      );
    }
  });

  it('auto-approves no rule whose own text is an external effect or a secret reader', () => {
    for (const rule of rules.allow) {
      const pattern = rule.replace(/^Bash\((.*)\)$/s, '$1');
      expect(hasExternalEffect(pattern), rule).toBe(false);
      expect(readsSecrets(pattern), rule).toBe(false);
    }
  });

  it('names only workspace scripts that exist, so a stale rule cannot rot into silence', () => {
    const packages = new Map(workspacePackages().map((p) => [p.name, p]));
    const filterRule = /^Bash\(pnpm --filter (\S+) ([^\s*)]+)\)$/;

    for (const rule of rules.allow) {
      const match = filterRule.exec(rule);
      if (match === null) continue;
      const [, packageName, script] = match;
      const pkg = packages.get(packageName ?? '');
      expect(pkg, `${rule}: no such workspace package`).toBeDefined();
      expect(Object.keys(pkg?.scripts ?? {}), rule).toContain(script);
    }
  });

  it('auto-approves no workspace script that has an external effect', () => {
    for (const pkg of workspacePackages()) {
      for (const [script, body] of Object.entries(pkg.scripts)) {
        if (!hasExternalEffect(body)) continue;
        const command = `pnpm --filter ${pkg.name} ${script}`;
        expect(decide(command, rules), `${command} runs: ${body}`).not.toBe('allow');
        expect(decide(`pnpm run ${script}`, rules), body).not.toBe('allow');
        expect(decide(`turbo run ${script}`, rules), body).not.toBe('allow');
      }
    }
  });
});

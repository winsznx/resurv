import { describe, expect, it } from 'vitest';
import { EXTERNAL_EFFECTS, hasExternalEffect, matchRules } from '../src/dangerous-commands.ts';
import { readRepoFile, rootScripts, workspacePackages } from '../src/repo.ts';

/**
 * A root command like `pnpm build` is auto-approved, and turbo then runs a script in every
 * package. The permission engine never sees those inner commands, so the only thing keeping
 * an external write off an auto-approved path is what the scripts themselves contain.
 */

const TURBO_TASKS_REACHED_BY_ALLOWED_ROOT_COMMANDS = [
  'typecheck',
  'test',
  'test:integration',
  'test:e2e',
  'build',
  'clean',
  'lint',
  'lint:fix',
] as const;

describe('scripts reachable from an auto-approved root command', () => {
  it('perform no external write', () => {
    for (const pkg of workspacePackages()) {
      for (const task of TURBO_TASKS_REACHED_BY_ALLOWED_ROOT_COMMANDS) {
        const body = pkg.scripts[task];
        if (body === undefined) continue;
        const matched = matchRules(body, EXTERNAL_EFFECTS);
        expect(
          matched.map((rule) => rule.id),
          `${pkg.name} ${task}: ${body}`,
        ).toStrictEqual([]);
      }
    }
  });

  it('only mention a Cloudflare deploy when it is a dry run', () => {
    for (const pkg of workspacePackages()) {
      for (const [name, body] of Object.entries(pkg.scripts)) {
        if (!/\bwrangler\s+(deploy|publish)\b/.test(body)) continue;
        const reachable = (
          TURBO_TASKS_REACHED_BY_ALLOWED_ROOT_COMMANDS as readonly string[]
        ).includes(name);
        if (!reachable) continue;
        expect(body, `${pkg.name} ${name} is reachable from an allowed command`).toContain(
          '--dry-run',
        );
      }
    }
  });

  it('keeps the one real deploy script off every reachable task name', () => {
    const worker = workspacePackages().find((pkg) => pkg.name === '@resurv/worker');
    // Pinned exactly. `--env production` is load-bearing rather than decorative: the top-level
    // wrangler environment sets `ENVIRONMENT: "development"`, so a bare `wrangler deploy` would
    // publish a production origin that reports itself as development.
    expect(worker?.scripts['deploy']).toBe('wrangler deploy --env production');
    expect(hasExternalEffect(worker?.scripts['deploy'] ?? '')).toBe(true);
    expect(
      (TURBO_TASKS_REACHED_BY_ALLOWED_ROOT_COMMANDS as readonly string[]).includes('deploy'),
    ).toBe(false);
  });

  /**
   * `deploy` is a built-in pnpm subcommand, and it shadows a package script of the same name.
   * `pnpm --filter @resurv/worker deploy` therefore does not run the script above: it runs
   * pnpm's own workspace-deploy and fails with `ERR_PNPM_INVALID_DEPLOY_TARGET`. Every document
   * that tells a human how to publish this Worker has to say `run deploy`, and this test is what
   * stops that instruction from rotting back.
   */
  it('documents the deploy with `run`, because pnpm shadows a script named deploy', () => {
    const docs = [
      'README.md',
      'docs/BUILD_STATE.md',
      'docs/DEPLOYMENTS.md',
      'docs/SUBMISSION_READY_PACKET.md',
      'docs/RUNBOOKS.md',
    ];
    for (const doc of docs) {
      expect(
        readRepoFile(doc),
        `${doc} tells a human to run a command pnpm will shadow`,
      ).not.toMatch(/pnpm --filter @resurv\/worker deploy/);
    }
  });
});

describe('the gate runs every command CLAUDE.md declares required', () => {
  const gate = rootScripts()['gate'] ?? '';

  it.each([
    'pnpm format:check',
    'pnpm lint',
    'pnpm typecheck',
    'pnpm test',
    'pnpm test:integration',
    'pnpm test:e2e',
    'pnpm build',
    'pnpm --filter contracts test',
    'pnpm --filter contracts test:invariant',
  ])('includes %s', (command) => {
    expect(gate).toContain(command);
  });
});

describe('foundry cannot reach the filesystem or the shell from a test', () => {
  const foundry = readRepoFile('packages/contracts/foundry.toml');

  it('leaves ffi disabled, so a test cannot execute an arbitrary command', () => {
    expect(/^\s*ffi\s*=\s*true/m.test(foundry)).toBe(false);
  });

  it('grants no filesystem permission', () => {
    expect(foundry).toContain('fs_permissions = []');
  });
});

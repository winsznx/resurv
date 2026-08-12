import { describe, expect, it } from 'vitest';
import { autoApprovedScriptGraph } from '../src/approved-scripts.ts';
import { decide, type PermissionRules } from '../src/bash-rules.ts';
import { hasExternalEffect } from '../src/dangerous-commands.ts';
import { readRepoJson, workspacePackages } from '../src/repo.ts';

/**
 * `@resurv/cli` ships two commands that deploy contracts and settle a real covenant. Like the
 * seam probe, their leaf is structurally indistinguishable from an ordinary `node` invocation,
 * so the generic controls cannot see them and they are named here instead.
 *
 * The credential is the real control: without one both commands stop at startup with a message
 * naming paths and variable names and no value. These tests hold the second line, which is that
 * no auto-approved command may reach them. ADR-010 rules out relying on the `ask` tier.
 *
 * `--dry-run` neutralizes both, deliberately. A dry run reads the organization wallet, computes
 * every predicted address or simulates every step, and sends no write. It is how a deployment
 * is reviewed before it is performed.
 */

interface Settings {
  readonly permissions: PermissionRules;
}

const rules = readRepoJson<Settings>('.claude/settings.json').permissions;
const CLI = '@resurv/cli';

describe('the live CLI commands are never auto-approved', () => {
  it('classifies both entry points as external effects', () => {
    expect(hasExternalEffect('node --experimental-strip-types src/bin/contracts.ts')).toBe(true);
    expect(hasExternalEffect('node --experimental-strip-types src/bin/demo.ts')).toBe(true);
  });

  it('treats a dry run as harmless, because it sends nothing', () => {
    expect(
      hasExternalEffect('node --experimental-strip-types src/bin/contracts.ts --dry-run'),
    ).toBe(false);
    expect(hasExternalEffect('node --experimental-strip-types src/bin/demo.ts --dry-run')).toBe(
      false,
    );
  });

  it('still describes the scripts this repository actually ships', () => {
    const pkg = workspacePackages().find((candidate) => candidate.name === CLI);
    expect(pkg?.scripts['live:contracts']).toBe(
      'node --experimental-strip-types src/bin/contracts.ts',
    );
    expect(pkg?.scripts['live:demo']).toBe('node --experimental-strip-types src/bin/demo.ts');
  });

  it.each([
    `pnpm --filter ${CLI} live:contracts`,
    `pnpm --filter ${CLI} live:demo`,
    'pnpm run live:contracts',
    'turbo run live:demo',
    'pnpm exec node --experimental-strip-types src/bin/demo.ts',
  ])('does not auto-approve %s', (command) => {
    expect(decide(command, rules)).not.toBe('allow');
  });

  it('leaves both outside the auto-approved script graph entirely', () => {
    const reachable = autoApprovedScriptGraph(rules.allow).map(
      (node) => `${node.package}#${node.script}`,
    );
    expect(reachable).not.toContain(`${CLI}#live:contracts`);
    expect(reachable).not.toContain(`${CLI}#live:demo`);
    expect(reachable).toContain(`${CLI}#test`);
  });
});

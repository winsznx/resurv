import { describe, expect, it } from 'vitest';
import { autoApprovedScriptGraph } from '../src/approved-scripts.ts';
import { decide, type PermissionRules } from '../src/bash-rules.ts';
import { hasExternalEffect } from '../src/dangerous-commands.ts';
import { readRepoJson, workspacePackages } from '../src/repo.ts';

/**
 * `@resurv/seam-probe` is the first package in this repository whose test command spends a live
 * credential and lands real transactions. Structurally its leaf is `vitest run --dir test/live`,
 * which is indistinguishable from an ordinary test run, so the generic controls cannot see it
 * and it is named here instead.
 *
 * The credential is the real control: none exists in this repository by default, so the live
 * suite refuses to start. These tests hold the second line, which is that no auto-approved
 * command may ever reach it. ADR-010 rules out relying on the `ask` tier for that.
 */

interface Settings {
  readonly permissions: PermissionRules;
}

const rules = readRepoJson<Settings>('.claude/settings.json').permissions;
const SEAM_PACKAGE = '@resurv/seam-probe';
const SEAM_SCRIPT = 'test:seam';

describe('the live seam probe is never auto-approved', () => {
  it('classifies the live suite as an external effect and the offline suite as not', () => {
    expect(hasExternalEffect('vitest run --dir test/live')).toBe(true);
    expect(hasExternalEffect('vitest run --dir test/offline')).toBe(false);
    expect(hasExternalEffect('vitest run')).toBe(false);
  });

  it('still describes the script this repository actually ships', () => {
    const pkg = workspacePackages().find((candidate) => candidate.name === SEAM_PACKAGE);
    expect(pkg?.scripts[SEAM_SCRIPT]).toBe('vitest run --dir test/live');
    expect(pkg?.scripts['test']).toBe('vitest run --dir test/offline');
  });

  it.each([
    `pnpm --filter ${SEAM_PACKAGE} ${SEAM_SCRIPT}`,
    `pnpm run ${SEAM_SCRIPT}`,
    `turbo run ${SEAM_SCRIPT}`,
    'pnpm exec vitest run --dir test/live',
  ])('does not auto-approve %s', (command) => {
    expect(decide(command, rules)).not.toBe('allow');
  });

  it('leaves it outside the auto-approved script graph entirely', () => {
    const reachable = autoApprovedScriptGraph(rules.allow).map(
      (node) => `${node.package}#${node.script}`,
    );
    expect(reachable).not.toContain(`${SEAM_PACKAGE}#${SEAM_SCRIPT}`);
    expect(reachable).toContain(`${SEAM_PACKAGE}#test`);
  });
});

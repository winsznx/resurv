import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  credentialShapedEnvNames,
  describeCredential,
  LOCAL_ENV_CANDIDATES,
  loadLocalEnv,
  REPO_ROOT,
} from '../src/index.ts';

/**
 * These tests must run whether or not a credential exists on the machine, and must never
 * observe one. Everything asserted here is about paths, names and shapes.
 */
describe('repository root', () => {
  it('resolves to the workspace root from this package', () => {
    // #then
    expect(existsSync(join(REPO_ROOT, 'pnpm-workspace.yaml'))).toBe(true);
    expect(existsSync(join(REPO_ROOT, 'RESURV_PRD_v1.0.md'))).toBe(true);
  });
});

describe('candidate configuration paths', () => {
  it('lists the five documented paths in precedence order', () => {
    // #then
    expect([...LOCAL_ENV_CANDIDATES]).toEqual([
      '.env',
      '.env.local',
      '.dev.vars',
      join('apps', 'worker', '.dev.vars'),
      join('apps', 'worker', '.env'),
    ]);
  });

  it('probes every candidate rather than stopping at the first hit', () => {
    // #when
    const load = loadLocalEnv();

    // #then
    expect(load.candidates).toHaveLength(LOCAL_ENV_CANDIDATES.length);
    expect(load.candidates.map((candidate) => candidate.path)).toEqual([...LOCAL_ENV_CANDIDATES]);
  });

  it('reports names and never values', () => {
    // #when
    const load = loadLocalEnv();

    // #then: every field is a path, a name, or a boolean. `JSON.stringify` of the whole load
    // is what a caller would print, and nothing that looks like a credential may appear in it.
    const serialized = JSON.stringify(load);
    expect(serialized).not.toMatch(/\b(kh|wfb)_[A-Za-z0-9_-]{4,}/);
    for (const name of load.assigned) expect(name).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    for (const name of load.skipped) expect(name).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
  });

  it('is idempotent: a second load assigns nothing because the process already has it', () => {
    // #given
    loadLocalEnv();

    // #when
    const second = loadLocalEnv();

    // #then
    expect(second.assigned).toEqual([]);
  });
});

describe('credential description', () => {
  it('keeps the prefix and the length and discards the secret', () => {
    // #then
    expect(describeCredential('kh_abcdefghijklmnop')).toBe('kh_…(19 chars)');
    expect(describeCredential('nounderscore')).toBe('(no prefix)…(12 chars)');
  });

  it('lists credential-shaped variable names without their values', () => {
    // #then
    for (const name of credentialShapedEnvNames()) {
      expect(name).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    }
  });
});

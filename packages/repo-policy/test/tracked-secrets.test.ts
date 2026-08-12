import { describe, expect, it } from 'vitest';
import {
  gitHistoricallyAddedPaths,
  gitHistoryIsShallow,
  gitTrackedPaths,
  readRepoFile,
} from '../src/repo.ts';
import {
  classifySecretPath,
  findSecretPaths,
  formatFindings,
  SECRET_PATH_RULES,
} from '../src/tracked-secrets.ts';

/**
 * The Phase 0 CI job matched `(^|/)\.env($|\.)|\.(pem|key|p12|pfx|keystore)$` and
 * `docs/THREAT_MODEL.md` claimed it covered everything `.gitignore` protects. It missed
 * `.dev.vars`, `secrets/`, `keystores/`, `deployer.json` and `account.json`, and it would
 * have failed the build on the `.env.staging.example` that `.gitignore` deliberately allows.
 */

const MUST_BE_CAUGHT: readonly [string, string][] = [
  ['.env', 'env-file'],
  ['.env.local', 'env-file'],
  ['.env.production', 'env-file'],
  ['apps/worker/.env', 'env-file'],
  ['supabase/.env', 'env-file'],
  ['.dev.vars', 'dev-vars'],
  ['.dev.vars.production', 'dev-vars'],
  ['apps/worker/.dev.vars', 'dev-vars'],
  ['secrets/keeperhub.json', 'secrets-dir'],
  ['.secrets/anything', 'secrets-dir'],
  ['keystores/k.json', 'keystore-dir'],
  ['keystore/k.json', 'keystore-dir'],
  ['private/notes.md', 'private-dir'],
  ['deployer.json', 'deployer-credential'],
  ['scripts/account.json', 'deployer-credential'],
  ['ops/cluster.private.json', 'private-json'],
  ['certs/server.pem', 'key-material'],
  ['certs/server.key', 'key-material'],
  ['certs/server.p12', 'key-material'],
  ['certs/server.pfx', 'key-material'],
  ['certs/local.keystore', 'key-material'],
  ['ci/deploy.jks', 'key-material'],
  ['home/id_rsa', 'ssh-key'],
  ['home/id_ed25519', 'ssh-key'],
  ['.wrangler/state/v3/secrets.json', 'wrangler-state'],
  ['.foundry/keystores/deployer', 'keystore-dir'],
  ['.foundry/anvil-state.json', 'foundry-state'],
  ['wallets/recovery.mnemonic', 'mnemonic'],
];

const MUST_NOT_BE_CAUGHT: readonly string[] = [
  '.env.example',
  '.env.staging.example',
  '.dev.vars.example',
  'docs/THREAT_MODEL.md',
  'packages/config/src/index.ts',
  'apps/worker/wrangler.jsonc',
  'packages/contracts/foundry.toml',
  'package.json',
  'monkey.jpeg',
  'src/keyboard.ts',
  'docs/private-notes-are-not-a-directory.md',
];

describe('secret path detection', () => {
  it.each(MUST_BE_CAUGHT)('catches %s as %s', (path, ruleId) => {
    expect(classifySecretPath(path)?.id).toBe(ruleId);
  });

  it.each(MUST_NOT_BE_CAUGHT)('leaves %s alone', (path) => {
    expect(classifySecretPath(path)).toBeUndefined();
  });

  it('reports every finding rather than the first one', () => {
    const findings = findSecretPaths(['.env', 'README.md', 'secrets/x.json']);
    expect(findings.map((f) => f.path)).toStrictEqual(['.env', 'secrets/x.json']);
    expect(formatFindings(findings)).toContain('[secrets-dir]');
  });
});

describe('detection rules and .gitignore agree', () => {
  const gitignore = readRepoFile('.gitignore');

  /**
   * Lines, not substrings. The Phase 0 remediation review (N4) showed the substring form was
   * satisfiable by a sibling: deleting `secrets/` left `.secrets/` behind, which contains it,
   * and the same held for `keystore/` under `keystores/` and `.env` under `.env.*`.
   */
  const ignoredLines = new Set(
    gitignore
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );

  it.each([
    '.env',
    '.dev.vars',
    'secrets/',
    'keystores/',
    'private/',
    '*.pem',
    '*.key',
    '*.p12',
    '*.pfx',
    '*.keystore',
    'deployer.json',
    'account.json',
    '*.private.json',
    'supabase/.env',
    '.wrangler/',
    '.foundry/',
  ])('%s is ignored on a line of its own and is also a detection rule', (entry) => {
    expect(ignoredLines).toContain(entry);
  });

  it('un-ignores the example files the detector deliberately permits', () => {
    expect(ignoredLines).toContain('!.env.example');
    expect(ignoredLines).toContain('!.env.*.example');
    expect(ignoredLines).toContain('!.dev.vars.example');
    expect(classifySecretPath('.env.staging.example')).toBeUndefined();
  });

  it('has a rule id for every declared rule, with no duplicates', () => {
    const ids = SECRET_PATH_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('this repository', () => {
  it('tracks no secret-bearing file', () => {
    const findings = findSecretPaths(gitTrackedPaths());
    expect(formatFindings(findings)).toBe('');
  });

  it('never committed one, as far as reachable history goes', () => {
    if (gitHistoryIsShallow()) {
      // A shallow clone cannot answer this. CI fetches full history for exactly this reason.
      expect(gitHistoryIsShallow()).toBe(true);
      return;
    }
    const findings = findSecretPaths(gitHistoricallyAddedPaths());
    expect(formatFindings(findings)).toBe('');
  });
});

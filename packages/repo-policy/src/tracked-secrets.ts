/**
 * Detects secret-bearing files by path. The input is a list of paths git already knows
 * about, not a directory walk: a file that was committed and then added to `.gitignore`
 * stays tracked and stays dangerous, and a working-tree scan would not see it.
 *
 * Every rule here corresponds to a block in `.gitignore`. `test/tracked-secrets.test.ts`
 * asserts that correspondence in both directions, so the two controls cannot drift apart
 * the way `docs/THREAT_MODEL.md` claimed coverage the CI regex did not have.
 */

export interface SecretPathRule {
  readonly id: string;
  readonly pattern: RegExp;
  /** Directory rules are not waived by an `.example` suffix. */
  readonly exampleExempt: boolean;
  readonly why: string;
}

export const SECRET_PATH_RULES: readonly SecretPathRule[] = [
  {
    id: 'env-file',
    pattern: /(^|\/)\.env($|\.)/,
    exampleExempt: true,
    why: 'process environment file, the usual home of an organization API key',
  },
  {
    id: 'dev-vars',
    pattern: /(^|\/)\.dev\.vars($|\.)/,
    exampleExempt: true,
    why: 'wrangler local secret file',
  },
  {
    id: 'secrets-dir',
    pattern: /(^|\/)\.?secrets\//,
    exampleExempt: false,
    why: 'directory reserved for credential material',
  },
  {
    id: 'keystore-dir',
    pattern: /(^|\/)keystores?\//,
    exampleExempt: false,
    why: 'encrypted key material',
  },
  {
    id: 'private-dir',
    pattern: /(^|\/)private\//,
    exampleExempt: false,
    why: 'directory reserved for private material',
  },
  {
    id: 'key-material',
    pattern: /\.(pem|key|p12|pfx|keystore|jks|asc|gpg)$/,
    exampleExempt: true,
    why: 'key or certificate file',
  },
  {
    id: 'ssh-key',
    pattern: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)($|\.)/,
    exampleExempt: false,
    why: 'ssh private key',
  },
  {
    id: 'deployer-credential',
    pattern: /(^|\/)(deployer|account)\.json$/,
    exampleExempt: true,
    why: 'deployment credential file, per .gitignore',
  },
  {
    id: 'private-json',
    pattern: /\.private\.json$/,
    exampleExempt: true,
    why: 'file named private by convention',
  },
  {
    id: 'supabase-local-secrets',
    pattern: /(^|\/)supabase\/(\.env|config\.local\.toml)/,
    exampleExempt: true,
    why: 'Supabase local stack credentials',
  },
  {
    id: 'wrangler-state',
    pattern: /(^|\/)\.wrangler\//,
    exampleExempt: false,
    why: 'wrangler resolves secrets into this directory at runtime',
  },
  {
    id: 'foundry-state',
    pattern: /(^|\/)\.foundry\//,
    exampleExempt: false,
    why: 'foundry writes an encrypted keystore here',
  },
  {
    id: 'mnemonic',
    pattern: /\.(mnemonic|seedphrase)$/,
    exampleExempt: true,
    why: 'wallet recovery phrase',
  },
];

export interface SecretPathFinding {
  readonly path: string;
  readonly ruleId: string;
  readonly why: string;
}

/** `.env.example` and `.env.staging.example` are documentation and stay committable. */
export function isExampleArtifact(path: string): boolean {
  return /\.(example|sample|template)$/.test(path);
}

export function classifySecretPath(path: string): SecretPathRule | undefined {
  const normalized = path.replaceAll('\\', '/');
  const example = isExampleArtifact(normalized);
  return SECRET_PATH_RULES.find(
    (rule) => rule.pattern.test(normalized) && !(example && rule.exampleExempt),
  );
}

export function findSecretPaths(paths: readonly string[]): SecretPathFinding[] {
  const findings: SecretPathFinding[] = [];
  for (const path of paths) {
    const rule = classifySecretPath(path);
    if (rule !== undefined) {
      findings.push({ path, ruleId: rule.id, why: rule.why });
    }
  }
  return findings;
}

export function formatFindings(findings: readonly SecretPathFinding[]): string {
  return findings.map((f) => `  ${f.path}  [${f.ruleId}] ${f.why}`).join('\n');
}

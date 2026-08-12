/**
 * What "dangerous" means for this repository, expressed once so both the permission-boundary
 * check and the workspace-script check use the same definition.
 *
 * Two separate risks, deliberately kept apart:
 *
 *   - EXTERNAL_EFFECTS: a command that changes something outside this checkout. Deploying,
 *     mutating a secret, signing, broadcasting, or spending. These may never be reachable
 *     from an auto-approved command, directly or through a script wrapper.
 *   - SECRET_READERS: a command that can print the bytes of a credential file. These may not
 *     be auto-approved when pointed at a path the deny list protects.
 */

export interface CommandRule {
  readonly id: string;
  readonly pattern: RegExp;
  /** When this matches too, the command is neutered and the rule does not apply. */
  readonly neutralizedBy?: RegExp;
  readonly why: string;
}

export const EXTERNAL_EFFECTS: readonly CommandRule[] = [
  {
    id: 'cloudflare-deploy',
    pattern: /\bwrangler\s+(deploy|publish)\b/,
    neutralizedBy: /--dry-run\b/,
    why: 'publishes a Worker to Cloudflare',
  },
  {
    id: 'cloudflare-version-upload',
    pattern: /\bwrangler\s+versions\s+(upload|deploy)\b/,
    why: 'uploads or promotes a Worker version',
  },
  {
    id: 'cloudflare-secret-mutation',
    pattern: /\bwrangler\s+secret\b/,
    why: 'creates, replaces or lists a Worker secret',
  },
  {
    id: 'cloudflare-resource-mutation',
    pattern: /\bwrangler\s+(delete|d1|kv|r2)\b/,
    why: 'mutates Cloudflare-hosted state',
  },
  {
    id: 'signed-transaction',
    pattern: /\bcast\s+send\b/,
    why: 'signs and broadcasts a funded transaction',
  },
  {
    id: 'wallet-material',
    pattern: /\bcast\s+wallet\b/,
    why: 'creates, imports or exports private key material',
  },
  {
    id: 'contract-deployment',
    pattern: /\bforge\s+(create|verify-contract)\b/,
    why: 'deploys or claims authorship of a deployed contract',
  },
  {
    id: 'foundry-broadcast',
    pattern: /--broadcast\b/,
    why: 'turns a Foundry script simulation into real transactions',
  },
  {
    id: 'database-mutation',
    pattern: /\b(psql|supabase\s+db\s+(push|reset)|supabase\s+link|drizzle-kit\s+(push|migrate))\b/,
    why: 'mutates a live database',
  },
  {
    id: 'package-publish',
    pattern: /\b(npm|pnpm|yarn)\s+publish\b/,
    why: 'publishes to a public registry',
  },
  { id: 'git-publish', pattern: /\bgit\s+push\b/, why: 'writes to a remote repository' },
  {
    id: 'live-seam-execution',
    pattern: /\bvitest\s+run\s+--dir\s+test\/live\b/,
    why: 'spends the live KeeperHub organization credential and broadcasts real transactions',
  },
  {
    id: 'live-contract-deployment',
    pattern: /\bnode\s+(--experimental-strip-types\s+)?\S*src\/bin\/contracts\.ts\b/,
    neutralizedBy: /--dry-run\b/,
    why: 'deploys the RESURV contracts through KeeperHub and lands real transactions',
  },
  {
    id: 'live-covenant-demo',
    pattern: /\bnode\s+(--experimental-strip-types\s+)?\S*src\/bin\/demo\.ts\b/,
    neutralizedBy: /--dry-run\b/,
    why: 'creates and settles a real covenant on Base Sepolia, moving real test value',
  },
  {
    id: 'github-mutation',
    pattern: /\bgh\s+(pr\s+create|release|repo\s+create|secret)\b/,
    why: 'writes to GitHub',
  },
];

export const SECRET_READERS: readonly CommandRule[] = [
  { id: 'node-eval', pattern: /\bnode\s+(-e|--eval|-p|--print)\b/, why: 'runs arbitrary code' },
  { id: 'shell-eval', pattern: /\b(bash|sh|zsh)\s+-c\b/, why: 'runs arbitrary shell' },
  { id: 'python-eval', pattern: /\bpython3?\s+-c\b/, why: 'runs arbitrary code' },
  { id: 'ripgrep', pattern: /\brg\b/, why: 'prints file contents' },
  { id: 'jq', pattern: /\bjq\b/, why: 'prints file contents' },
  { id: 'binary-dump', pattern: /\b(xxd|od|strings|base64)\b/, why: 'prints file bytes' },
  { id: 'stream-editor', pattern: /\b(sed|awk)\b/, why: 'prints file contents' },
  { id: 'environment-dump', pattern: /\b(printenv|env)\b/, why: 'prints the process environment' },
];

/**
 * Runners that execute their argument as a command. Claude Code does not strip these before
 * matching a rule, so a prefix rule for the runner grants whatever follows it.
 */
export const COMMAND_RUNNERS: readonly RegExp[] = [
  /^pnpm\s+(exec|dlx|run)\b/,
  /^pnpm\s+--filter\b/,
  /^pnpm\s+-r\b/,
  /^npm\s+(run|exec)\b/,
  /^npx\b/,
  /^bunx\b/,
  /^turbo\s+run\b/,
  /^make\b/,
  /^(bash|sh|zsh)\s+-c\b/,
  /^node\s+(-e|--eval)\b/,
];

export function matchRules(command: string, rules: readonly CommandRule[]): readonly CommandRule[] {
  return rules.filter(
    (rule) =>
      rule.pattern.test(command) &&
      (rule.neutralizedBy === undefined || !rule.neutralizedBy.test(command)),
  );
}

export function hasExternalEffect(command: string): boolean {
  return matchRules(command, EXTERNAL_EFFECTS).length > 0;
}

export function readsSecrets(command: string): boolean {
  return matchRules(command, SECRET_READERS).length > 0;
}

export function isCommandRunner(command: string): boolean {
  return COMMAND_RUNNERS.some((pattern) => pattern.test(command.trim()));
}

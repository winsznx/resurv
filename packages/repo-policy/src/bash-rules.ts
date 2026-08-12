/**
 * A model of Claude Code's documented Bash permission matching, written so the repository
 * can assert facts about its own `.claude/settings.json` in a test rather than by reading it.
 *
 * The semantics below are transcribed from the official permissions reference
 * (https://code.claude.com/docs/en/permissions, retrieved 2026-08-11):
 *
 *   - Rules are evaluated deny, then ask, then allow. The first match wins and specificity
 *     does not change the order.
 *   - `*` is a wildcard at any position and matches any sequence of characters, including
 *     spaces. A trailing ` *` enforces a word boundary: the prefix must be followed by a
 *     space or end-of-string. `ls*` without the space has no boundary and matches `lsof`.
 *   - The `:*` suffix is an equivalent spelling of a trailing ` *`, recognized only at the
 *     end of a pattern.
 *   - Compound commands are split on `&&`, `||`, `;`, `|`, `|&`, `&` and newlines, and every
 *     subcommand must match independently.
 *   - A fixed wrapper set is stripped before matching: timeout, time, nice, nohup, stdbuf,
 *     command, builtin, noglob, and bare `xargs` with no flags. Environment runners such as
 *     `npx`, `pnpm exec` and `docker exec` are NOT stripped, which is why they have to be
 *     handled as rules of their own.
 *   - An allow rule does not match past an assignment of an unknown environment variable; a
 *     deny or ask rule does.
 *   - A built-in set of read-only commands (`ls`, `cat`, `echo`, `pwd`, `head`, `tail`,
 *     `grep`, `find`, `wc`, `which`, `diff`, `stat`, `du`, `cd`, and read-only forms of
 *     `git`) runs with no prompt in every mode. The set is not configurable and the only way
 *     to make one of them prompt is an ask or a deny rule. `BUILTIN_READ_ONLY_HEADS` below
 *     models it, because "no rule matched" and "the user is asked" are not the same outcome
 *     for those commands, and a test that only asserts `not.toBe('allow')` cannot tell.
 *
 * One behavior below is measured rather than documented, and it is recorded here because it
 * silently voids a rule: a Bash pattern containing `$` never matches anything. Measured
 * 2026-08-12 against a live session, `docs/phase-logs/PRE_SEAM_HARDENING.md` section 1.
 * `Bash(*~/.*)` denied `ls -d ~/.zshrc`; the sibling rule `Bash(*$HOME/.*)` did not deny
 * `ls -d $HOME/.zshrc`, and `Bash(*echo $*)` did not deny `echo $HOME`. The shape of the
 * failure is consistent with the pattern being compiled to a regular expression without
 * escaping `$`, which then anchors at end-of-input. `patternIsInert` models it and
 * `credential-surfaces.test.ts` fails if any committed rule is inert.
 *
 * This model is deliberately conservative where the documentation is silent: when it is
 * unsure it reports the stricter outcome for allow (no match) and the looser outcome for
 * deny (match). It is a policy check, not a reimplementation of the permission engine, and
 * `docs/THREAT_MODEL.md` states that distinction rather than claiming a sandbox.
 */

export type Decision = 'deny' | 'ask' | 'allow' | 'prompt';

export interface PermissionRules {
  readonly allow: readonly string[];
  readonly ask: readonly string[];
  readonly deny: readonly string[];
}

const COMMAND_SEPARATORS = /\|\||&&|\|&|;|\||&|\n/;

const STRIPPED_WRAPPERS = new Set([
  'timeout',
  'time',
  'nice',
  'nohup',
  'stdbuf',
  'command',
  'builtin',
  'noglob',
]);

/** Variables Claude Code treats as safe to skip past when matching an allow rule. */
const KNOWN_SAFE_ASSIGNMENTS = /^(NODE_ENV|CI|FORCE_COLOR|NO_COLOR|TERM|LANG|LC_ALL)=/;

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

const TOOL_RULE = /^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/s;

export function bashPatternOf(rule: string): string | undefined {
  const match = TOOL_RULE.exec(rule.trim());
  if (match === null) {
    return rule.trim() === 'Bash' ? '*' : undefined;
  }
  const [, tool, pattern] = match;
  if (tool !== 'Bash') return undefined;
  return pattern;
}

/**
 * Compiles one Bash pattern. A trailing ` *` (or its `:*` spelling) becomes an optional
 * ` <anything>` tail so the prefix has to end on a word boundary.
 */
export function compileBashPattern(pattern: string): RegExp {
  let source = pattern;
  let boundedTail = false;

  if (source.endsWith(':*')) {
    source = `${source.slice(0, -2)} *`;
  }
  if (source.endsWith(' *')) {
    source = source.slice(0, -2);
    boundedTail = true;
  }

  const body = source
    .split('*')
    .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');

  return new RegExp(`^${body}${boundedTail ? '( .*)?' : ''}$`, 's');
}

export function splitCompound(command: string): string[] {
  return command
    .split(COMMAND_SEPARATORS)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** `timeout` and `stdbuf` carry an argument of their own before the real command. */
function wrapperArgumentCount(head: string, next: string): number {
  if (head === 'timeout' && /^\d+(\.\d+)?[smhd]?$/.test(next)) return 1;
  if (head === 'stdbuf' && next.startsWith('-')) return 1;
  return 0;
}

/** Removes the wrapper prefixes Claude Code strips before matching. */
export function stripWrappers(command: string): string {
  let current = command.trim();
  for (;;) {
    const [head, ...rest] = current.split(/\s+/);
    if (head === undefined || rest.length === 0) return current;

    const next = rest[0] ?? '';
    const isWrapper = STRIPPED_WRAPPERS.has(head);
    const isBareXargs = head === 'xargs' && !next.startsWith('-');
    if (!isWrapper && !isBareXargs) return current;

    current = rest.slice(isWrapper ? wrapperArgumentCount(head, next) : 0).join(' ');
  }
}

function stripAssignments(command: string, allowRule: boolean): string {
  let current = command.trim();
  for (;;) {
    const [head, ...rest] = current.split(/\s+/);
    if (head === undefined || rest.length === 0 || !ASSIGNMENT.test(head)) return current;
    if (allowRule && !KNOWN_SAFE_ASSIGNMENTS.test(head)) return current;
    current = rest.join(' ');
  }
}

function matchesAny(command: string, patterns: readonly string[], allowRule: boolean): boolean {
  const normalized = stripWrappers(stripAssignments(command, allowRule));
  return patterns.some((pattern) => compileBashPattern(pattern).test(normalized));
}

function bashPatterns(rules: readonly string[]): string[] {
  return rules
    .map(bashPatternOf)
    .filter((pattern): pattern is string => pattern !== undefined && !patternIsInert(pattern));
}

/**
 * A pattern that cannot match any command, so the rule reads as a control and is not one.
 * Measured, not documented. See the header note.
 */
export function patternIsInert(pattern: string): boolean {
  return pattern.includes('$');
}

/**
 * Commands Claude Code runs with no prompt in every mode, whatever the rule set says, unless
 * an ask or a deny rule names them.
 */
export const BUILTIN_READ_ONLY_HEADS: ReadonlySet<string> = new Set([
  'ls',
  'cat',
  'echo',
  'pwd',
  'head',
  'tail',
  'grep',
  'find',
  'wc',
  'which',
  'diff',
  'stat',
  'du',
  'cd',
]);

/**
 * `git` is in the built-in set for its read-only forms. Modeled generously on purpose: an
 * over-long list makes `runsWithoutPrompt` report more commands as unprompted, which is the
 * pessimistic direction for a security check.
 */
export const BUILTIN_READ_ONLY_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'blame',
  'branch',
  'cat-file',
  'check-ignore',
  'config',
  'count-objects',
  'describe',
  'diff',
  'grep',
  'help',
  'log',
  'ls-files',
  'ls-remote',
  'ls-tree',
  'name-rev',
  'rev-list',
  'rev-parse',
  'shortlog',
  'show',
  'status',
  'stash',
  'submodule',
  'tag',
  'var',
  'version',
  'whatchanged',
]);

function partIsBuiltinReadOnly(part: string): boolean {
  const normalized = stripWrappers(stripAssignments(part, false));
  const [head, ...rest] = normalized.split(/\s+/);
  if (head === undefined) return false;
  if (head === 'git') {
    const subcommand = rest.find((token) => !token.startsWith('-'));
    return subcommand !== undefined && BUILTIN_READ_ONLY_GIT_SUBCOMMANDS.has(subcommand);
  }
  // `find -exec` and `find -delete` are documented to prompt despite `find` being in the set.
  if (head === 'find' && rest.some((token) => token === '-exec' || token === '-delete')) {
    return false;
  }
  return BUILTIN_READ_ONLY_HEADS.has(head);
}

export function isBuiltinReadOnly(command: string): boolean {
  const parts = splitCompound(command);
  return parts.length > 0 && parts.every(partIsBuiltinReadOnly);
}

/**
 * Whether Claude Code executes this command with no human in the loop. `decide` returning
 * `prompt` is not the same answer: for the built-in read-only set, `prompt` means "runs
 * immediately". Every assertion about a credential surface has to be written against this,
 * not against `decide`.
 */
export function runsWithoutPrompt(command: string, rules: PermissionRules): boolean {
  const decision = decide(command, rules);
  if (decision === 'deny' || decision === 'ask') return false;
  if (decision === 'allow') return true;
  return isBuiltinReadOnly(command);
}

/**
 * The outcome for a Bash command under a rule set. `prompt` means no rule matched, so the
 * default permission mode asks. Deny and ask match if ANY subcommand matches; allow requires
 * EVERY subcommand to match, which is how a compound command is handled.
 */
export function decide(command: string, rules: PermissionRules): Decision {
  const parts = splitCompound(command);
  if (parts.length === 0) return 'prompt';

  const deny = bashPatterns(rules.deny);
  const ask = bashPatterns(rules.ask);
  const allow = bashPatterns(rules.allow);

  if (parts.some((part) => matchesAny(part, deny, false))) return 'deny';
  if (parts.some((part) => matchesAny(part, ask, false))) return 'ask';
  if (parts.every((part) => matchesAny(part, allow, true))) return 'allow';
  return 'prompt';
}

export function isAutoApproved(command: string, rules: PermissionRules): boolean {
  return decide(command, rules) === 'allow';
}

/**
 * What an auto-approved command actually runs.
 *
 * An exact-match rule like `Bash(pnpm lint)` approves a *name*. The body behind that name
 * lives in `package.json`, the permission engine never sees it, and nothing stopped it from
 * changing. The Phase 0 remediation review proved the gap twice: adding `&& wrangler deploy`
 * to the root `lint` script survived the whole suite (C8), and so did a brand new root script
 * plus a matching allow rule (C8b). Eleven root scripts were auto-approved and enumerated by
 * no test at all.
 *
 * This module resolves an allow rule to the set of commands it can reach, following
 * `pnpm <script>`, `pnpm --filter <pkg> <script>` and `turbo run <task>` through the
 * workspace, and classifies the leaves against a declared graph of non-destructive commands.
 * Three independent controls sit on top of it in `approved-scripts.test.ts`:
 *
 *   1. structural — every reachable leaf must match `APPROVED_LEAF_COMMANDS`, so a leaf that
 *      invokes deployment tooling, arbitrary package execution or an unreviewed binary fails
 *      whether or not anyone thought of that binary in advance;
 *   2. inventory — the set of auto-approved script identities must equal
 *      `REVIEWED_AUTO_APPROVED_SCRIPTS`, so a newly allow-listed script fails until someone
 *      adds it here;
 *   3. body pin — each reviewed script's body must still be the reviewed text.
 *
 * What this is not: protection against a contributor who edits the policy and the manifest in
 * the same change. It is a drift guard. Someone with commit access can always rewrite the
 * thing that would have objected, and `docs/THREAT_MODEL.md` T14 says exactly that.
 */

import { EXTERNAL_EFFECTS, matchRules } from './dangerous-commands.ts';
import { readRepoJson, rootScripts, workspacePackages } from './repo.ts';

/** The package name used for the repository root, which has no `name` worth filtering on. */
export const ROOT_PACKAGE = '<root>';

export interface ScriptNode {
  /** Workspace package name, or `ROOT_PACKAGE`. */
  readonly package: string;
  readonly script: string;
  readonly body: string;
  /** The allow rule, or the parent script, that made this reachable. */
  readonly reachedBy: string;
}

export interface ApprovedLeaf {
  readonly id: string;
  /** Must match the entire leaf command, so a suffix cannot ride along. */
  readonly pattern: RegExp;
  readonly why: string;
}

/**
 * The non-destructive command graph. Every leaf an auto-approved script can reach has to be
 * one of these. Anchored at both ends on purpose: `forge test -vv && wrangler deploy` splits
 * into two leaves and the second one matches nothing here.
 */
export const APPROVED_LEAF_COMMANDS: readonly ApprovedLeaf[] = [
  {
    id: 'biome',
    pattern: /^biome (?:format|check)(?: --write)? \.$/,
    why: 'formats or lints this checkout and writes nothing outside it',
  },
  {
    id: 'typescript',
    pattern: /^tsc --noEmit$/,
    why: 'typechecks and emits no artifact',
  },
  {
    id: 'vitest',
    pattern: /^vitest run(?: --dir [A-Za-z0-9._][A-Za-z0-9._/-]*)?(?: --passWithNoTests)?$/,
    why: 'runs the local test suite',
  },
  {
    id: 'vite',
    pattern: /^vite(?: (?:build|preview))?$/,
    why: 'local dev server, local bundle, or local preview of that bundle',
  },
  {
    id: 'wrangler-dev',
    pattern: /^wrangler dev$/,
    why: 'runs workerd locally and uploads nothing',
  },
  {
    id: 'wrangler-dry-run',
    pattern: /^wrangler deploy --dry-run --outdir [A-Za-z0-9._][A-Za-z0-9._/-]*$/,
    why: 'bundles the Worker without publishing it; the --dry-run is load-bearing',
  },
  {
    id: 'foundry',
    pattern: /^forge (?:build|fmt|test|coverage|clean)(?: [^&|;]*)?$/,
    why: 'compiles, formats or tests contracts against a local EVM',
  },
  {
    id: 'drizzle-generate',
    pattern: /^drizzle-kit generate$/,
    why: 'diffs the schema and writes SQL; opens no connection',
  },
  {
    id: 'remove-build-output',
    pattern: /^rm -rf(?: [A-Za-z0-9._][A-Za-z0-9._/-]*)+$/,
    why: 'removes build output by relative path; no absolute, home or flag-shaped target',
  },
];

export function classifyLeaf(command: string): ApprovedLeaf | undefined {
  return APPROVED_LEAF_COMMANDS.find((leaf) => leaf.pattern.test(command));
}

const LEAF_SEPARATORS = /\|\||&&|\|&|;|\||&|\n/;

export function splitScriptBody(body: string): string[] {
  return body
    .split(LEAF_SEPARATORS)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const FILTER_RULE = /^Bash\(pnpm --filter (\S+) ([A-Za-z0-9:._-]+)\)$/;
const ROOT_RULE = /^Bash\(pnpm ([A-Za-z0-9:._-]+)\)$/;
const TURBO_RULE = /^Bash\(turbo run ([A-Za-z0-9:._-]+)(?: --force)?\)$/;

const FILTER_CALL = /^pnpm --filter (\S+) ([A-Za-z0-9:._-]+)$/;
const ROOT_CALL = /^pnpm (?:run )?([A-Za-z0-9:._-]+)$/;
const TURBO_CALL = /^turbo run ([A-Za-z0-9:._-]+)(?: .*)?$/;

interface TurboConfig {
  readonly tasks?: Record<string, { readonly dependsOn?: readonly string[] }>;
}

/** A task's `dependsOn`, read from `turbo.json` rather than assumed. `^` prefixes are kept. */
function turboPrerequisites(task: string): readonly string[] {
  return readRepoJson<TurboConfig>('turbo.json').tasks?.[task]?.dependsOn ?? [];
}

function key(node: { package: string; script: string }): string {
  return `${node.package}#${node.script}`;
}

function bodyOf(packageName: string, script: string): string | undefined {
  if (packageName === ROOT_PACKAGE) return rootScripts()[script];
  return workspacePackages().find((pkg) => pkg.name === packageName)?.scripts[script];
}

/**
 * The packages `turbo run <task>` executes, and the upstream tasks its `dependsOn` pulls in.
 * A `^` prefix means "in my workspace dependencies", so the dependency graph is walked rather
 * than assumed: `turbo run test:e2e` does not compile contracts, because nothing that defines
 * `test:e2e` depends on `contracts`. Verified against `turbo run <task> --dry=json`.
 */
function turboFanOut(task: string): { package: string; script: string }[] {
  const packages = workspacePackages();
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const out = new Map<string, { package: string; script: string }>();

  const add = (packageName: string, script: string): void => {
    const pkg = byName.get(packageName);
    if (pkg?.scripts[script] === undefined) return;
    out.set(`${packageName}#${script}`, { package: packageName, script });
  };

  const upstream = (packageName: string, script: string, seen: Set<string>): void => {
    if (seen.has(packageName)) return;
    seen.add(packageName);
    const pkg = byName.get(packageName);
    if (pkg === undefined) return;
    for (const dependency of pkg.dependencies) {
      if (!byName.has(dependency)) continue;
      add(dependency, script);
      upstream(dependency, script, seen);
    }
  };

  const dependsOn = turboPrerequisites(task);
  for (const pkg of packages) {
    if (pkg.scripts[task] === undefined) continue;
    add(pkg.name, task);
    for (const entry of dependsOn) {
      if (entry.startsWith('^')) {
        upstream(pkg.name, entry.slice(1), new Set());
      } else {
        add(pkg.name, entry);
      }
    }
  }
  return [...out.values()];
}

/** The scripts an allow rule names directly, before any expansion. */
export function autoApprovedEntryPoints(allow: readonly string[]): ScriptNode[] {
  const seeds: ScriptNode[] = [];
  const push = (packageName: string, script: string, rule: string): void => {
    const body = bodyOf(packageName, script);
    if (body === undefined) return;
    seeds.push({ package: packageName, script, body, reachedBy: rule });
  };

  for (const rule of allow) {
    const filter = FILTER_RULE.exec(rule);
    if (filter?.[1] !== undefined && filter[2] !== undefined) {
      push(filter[1], filter[2], rule);
      continue;
    }
    const root = ROOT_RULE.exec(rule);
    if (root?.[1] !== undefined) {
      push(ROOT_PACKAGE, root[1], rule);
      continue;
    }
    const turbo = TURBO_RULE.exec(rule);
    if (turbo?.[1] !== undefined) {
      for (const target of turboFanOut(turbo[1])) push(target.package, target.script, rule);
    }
  }
  return seeds;
}

/**
 * Every script an auto-approved command can reach, following the three runners the workspace
 * actually uses. Breadth-first, cycle-safe, so a script that calls itself terminates.
 */
export function autoApprovedScriptGraph(allow: readonly string[]): ScriptNode[] {
  const found = new Map<string, ScriptNode>();
  const queue = [...autoApprovedEntryPoints(allow)];

  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) continue;
    if (found.has(key(node))) continue;
    found.set(key(node), node);

    for (const leaf of splitScriptBody(node.body)) {
      for (const target of resolveLeafToScripts(leaf)) {
        const body = bodyOf(target.package, target.script);
        if (body === undefined) continue;
        queue.push({ ...target, body, reachedBy: key(node) });
      }
    }
  }
  return [...found.values()].sort((a, b) => key(a).localeCompare(key(b)));
}

/** A leaf that is itself a script invocation, expanded. An ordinary command expands to nothing. */
export function resolveLeafToScripts(leaf: string): { package: string; script: string }[] {
  const filter = FILTER_CALL.exec(leaf);
  if (filter?.[1] !== undefined && filter[2] !== undefined) {
    return [{ package: filter[1], script: filter[2] }];
  }
  const turbo = TURBO_CALL.exec(leaf);
  if (turbo?.[1] !== undefined) return turboFanOut(turbo[1]);
  const root = ROOT_CALL.exec(leaf);
  if (root?.[1] !== undefined && rootScripts()[root[1]] !== undefined) {
    return [{ package: ROOT_PACKAGE, script: root[1] }];
  }
  return [];
}

export interface LeafFinding {
  readonly node: ScriptNode;
  readonly leaf: string;
  readonly reason: string;
}

/** Leaves that are neither a script invocation nor a member of the approved command graph. */
export function unapprovedLeaves(graph: readonly ScriptNode[]): LeafFinding[] {
  const findings: LeafFinding[] = [];
  for (const node of graph) {
    for (const leaf of splitScriptBody(node.body)) {
      if (resolveLeafToScripts(leaf).length > 0) continue;
      const external = matchRules(leaf, EXTERNAL_EFFECTS);
      if (external.length > 0) {
        findings.push({ node, leaf, reason: `external effect: ${external[0]?.why}` });
        continue;
      }
      if (classifyLeaf(leaf) === undefined) {
        findings.push({ node, leaf, reason: 'outside the approved command graph' });
      }
    }
  }
  return findings;
}

/** Whether an auto-approved root command needs a Foundry toolchain. Consumed by the CI policy. */
export function scriptNeedsFoundry(packageName: string, script: string): boolean {
  const body = bodyOf(packageName, script);
  if (body === undefined) return false;
  const graph = autoApprovedScriptGraph([
    packageName === ROOT_PACKAGE
      ? `Bash(pnpm ${script})`
      : `Bash(pnpm --filter ${packageName} ${script})`,
  ]);
  return graph.some((node) =>
    splitScriptBody(node.body).some((leaf) => /^forge\b/.test(leaf) || /^cast\b/.test(leaf)),
  );
}

/**
 * The reviewed graph. Key is `<package>#<script>`, value is the exact body that was read and
 * accepted during the pre-seam hardening pass on 2026-08-12.
 *
 * Changing a script here is a two-line edit and a deliberate act. That is the point: C8 was a
 * one-line edit to `package.json` that nothing noticed.
 */
export const REVIEWED_AUTO_APPROVED_SCRIPTS: Readonly<Record<string, string>> = {
  '<root>#build': 'turbo run build',
  '<root>#clean': 'turbo run clean && rm -rf node_modules/.cache .turbo',
  '<root>#format': 'biome format --write .',
  '<root>#format:check': 'biome format .',
  '<root>#gate':
    'pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e && pnpm build && pnpm --filter contracts test && pnpm --filter contracts test:invariant',
  '<root>#lint': 'biome check . && pnpm --filter contracts lint',
  '<root>#lint:fix': 'biome check --write .',
  '<root>#test': 'turbo run test',
  '<root>#test:e2e': 'turbo run test:e2e',
  '<root>#test:integration': 'turbo run test:integration',
  '<root>#typecheck': 'turbo run typecheck',

  '@resurv/chain#clean': 'rm -rf dist .turbo',
  '@resurv/cli#clean': 'rm -rf dist .turbo',
  // The `live:` scripts are deliberately absent from this manifest and from every allow rule.
  // They spend the organization credential and land real transactions, and `EXTERNAL_EFFECTS`
  // classifies them, so a future allow rule for one fails this suite.
  '@resurv/cli#test': 'vitest run',
  '@resurv/cli#typecheck': 'tsc --noEmit',
  '@resurv/chain#test': 'vitest run',
  '@resurv/chain#typecheck': 'tsc --noEmit',
  '@resurv/config#clean': 'rm -rf dist .turbo',
  '@resurv/config#test': 'vitest run',
  '@resurv/config#typecheck': 'tsc --noEmit',
  '@resurv/db#clean': 'rm -rf dist .turbo',
  '@resurv/db#migrate:generate': 'drizzle-kit generate',
  '@resurv/db#test': 'vitest run',
  '@resurv/db#typecheck': 'tsc --noEmit',
  '@resurv/domain#clean': 'rm -rf dist .turbo',
  '@resurv/domain#test': 'vitest run',
  '@resurv/domain#typecheck': 'tsc --noEmit',
  '@resurv/keeperhub-client#clean': 'rm -rf dist .turbo',
  '@resurv/node-runtime#clean': 'rm -rf dist .turbo',
  '@resurv/node-runtime#test': 'vitest run',
  '@resurv/node-runtime#typecheck': 'tsc --noEmit',
  '@resurv/orchestrator#clean': 'rm -rf dist .turbo',
  '@resurv/orchestrator#test': 'vitest run',
  '@resurv/orchestrator#typecheck': 'tsc --noEmit',
  '@resurv/keeperhub-client#test': 'vitest run',
  '@resurv/keeperhub-client#typecheck': 'tsc --noEmit',
  '@resurv/repo-policy#clean': 'rm -rf dist .turbo',
  '@resurv/repo-policy#test': 'vitest run',
  '@resurv/repo-policy#typecheck': 'tsc --noEmit',
  '@resurv/seam-probe#clean': 'rm -rf dist .turbo',
  // The offline half only. `test:seam` runs `vitest run --dir test/live`, which
  // `EXTERNAL_EFFECTS` classifies as an external effect, and no allow rule reaches it.
  '@resurv/seam-probe#test': 'vitest run --dir test/offline',
  '@resurv/seam-probe#typecheck': 'tsc --noEmit',

  '@resurv/web#build': 'vite build',
  '@resurv/web#clean': 'rm -rf dist .turbo',
  '@resurv/web#dev': 'vite',
  '@resurv/web#test': 'vitest run --passWithNoTests',
  '@resurv/web#test:e2e': 'vitest run --dir test/e2e --passWithNoTests',
  '@resurv/web#typecheck': 'tsc --noEmit',

  '@resurv/worker#build': 'wrangler deploy --dry-run --outdir dist',
  '@resurv/worker#clean': 'rm -rf dist .turbo .wrangler',
  '@resurv/worker#dev': 'wrangler dev',
  '@resurv/worker#test': 'vitest run',
  '@resurv/worker#test:integration': 'vitest run --dir test/integration --passWithNoTests',
  '@resurv/worker#typecheck': 'tsc --noEmit',

  'contracts#build': 'forge build',
  'contracts#clean': 'forge clean',
  'contracts#coverage': 'forge coverage --report lcov',
  'contracts#lint': 'forge fmt --check',
  'contracts#lint:fix': 'forge fmt',
  'contracts#test': 'forge test -vv',
  'contracts#test:fuzz': 'forge test --match-test testFuzz -vv',
  'contracts#test:invariant': "forge test --match-path 'test/invariant/*' -vv",
  'contracts#typecheck': 'forge build --sizes',
};

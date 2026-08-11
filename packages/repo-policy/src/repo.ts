import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `packages/repo-policy/src` -> repository root. */
export const REPO_ROOT = resolve(HERE, '..', '..', '..');

export function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

export function readRepoJson<T>(relativePath: string): T {
  return JSON.parse(readRepoFile(relativePath)) as T;
}

export interface WorkspacePackage {
  readonly dir: string;
  readonly name: string;
  readonly scripts: Readonly<Record<string, string>>;
}

interface PackageManifest {
  readonly name?: string;
  readonly scripts?: Record<string, string>;
}

const WORKSPACE_DIRS = ['apps', 'packages'] as const;

export function workspacePackages(): WorkspacePackage[] {
  const found: WorkspacePackage[] = [];
  for (const group of WORKSPACE_DIRS) {
    for (const entry of readdirSync(join(REPO_ROOT, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = `${group}/${entry.name}`;
      let manifest: PackageManifest;
      try {
        manifest = readRepoJson<PackageManifest>(`${dir}/package.json`);
      } catch {
        continue;
      }
      if (manifest.name === undefined) continue;
      found.push({ dir, name: manifest.name, scripts: manifest.scripts ?? {} });
    }
  }
  return found;
}

export function rootScripts(): Readonly<Record<string, string>> {
  return readRepoJson<PackageManifest>('package.json').scripts ?? {};
}

/** Tracked paths, POSIX separators, exactly as git records them. */
export function gitTrackedPaths(): string[] {
  return runGit(['ls-files', '-z']).split('\0').filter(Boolean);
}

/**
 * Every path that was ever added in reachable history. A shallow clone truncates this, so
 * callers that depend on completeness must fetch full history first.
 */
export function gitHistoricallyAddedPaths(): string[] {
  const output = runGit([
    'log',
    '--all',
    '--diff-filter=A',
    '--name-only',
    '--pretty=format:',
    '-z',
  ]);
  return [...new Set(output.split('\0').filter(Boolean))];
}

export function gitHistoryIsShallow(): boolean {
  return runGit(['rev-parse', '--is-shallow-repository']).trim() === 'true';
}

function runGit(args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

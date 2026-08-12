/**
 * A shallow structural reader for the committed GitHub Actions workflows.
 *
 * This is not a YAML parser and does not pretend to be one. It splits `jobs:` into blocks by
 * indentation and pulls out the three things the CI policy needs: the `run` commands, the
 * `uses` actions, and the `with:` keys that decide whether the checkout carries submodules and
 * full history. Anything more would need a YAML dependency, and the lockfile is pinned.
 *
 * It exists because the Phase 0 remediation review found a job that could not have passed on a
 * clean runner: `pnpm typecheck` and `pnpm build` reach `forge`, and that job installed neither
 * Foundry nor the submodules. Nobody noticed because this repository has no git remote, so no
 * CI run has ever happened. A committed job that cannot pass is worse than no job, because it
 * reads as coverage.
 */

import { readRepoFile } from './repo.ts';

export interface WorkflowJob {
  readonly id: string;
  readonly name: string | undefined;
  readonly runsOn: string | undefined;
  readonly runCommands: readonly string[];
  readonly usesActions: readonly string[];
  readonly checksOutSubmodules: boolean;
  readonly fetchesFullHistory: boolean;
  readonly needs: readonly string[];
  readonly text: string;
}

const JOB_HEADER = /^ {2}([A-Za-z0-9_-]+):\s*$/;
const RUN_STEP = /^\s*-?\s*run:\s*(.+?)\s*$/;
const USES_STEP = /^\s*-\s*uses:\s*(\S+)\s*$/;
const NAME_KEY = /^\s{4}name:\s*(.+?)\s*$/;
const RUNS_ON_KEY = /^\s{4}runs-on:\s*(.+?)\s*$/;
const NEEDS_KEY = /^\s{4}needs:\s*\[(.*)\]\s*$/;

export function workflowFiles(): readonly string[] {
  return ['.github/workflows/ci.yml'];
}

interface JobBlock {
  readonly id: string;
  readonly lines: string[];
}

function splitJobBlocks(lines: readonly string[]): JobBlock[] {
  const jobsIndex = lines.indexOf('jobs:');
  if (jobsIndex === -1) return [];

  const blocks: JobBlock[] = [];
  for (const line of lines.slice(jobsIndex + 1)) {
    const header = JOB_HEADER.exec(line);
    if (header?.[1] !== undefined) {
      blocks.push({ id: header[1], lines: [] });
      continue;
    }
    blocks.at(-1)?.lines.push(line);
  }
  return blocks;
}

/** Single-line `run:` steps. A block scalar (`run: |`) is skipped rather than guessed at. */
function stepCommands(lines: readonly string[]): string[] {
  const commands: string[] = [];
  for (const line of lines) {
    // `defaults: run:` opens a mapping rather than naming a command.
    if (/^\s*run:\s*$/.test(line)) continue;
    const run = RUN_STEP.exec(line);
    if (run?.[1] !== undefined && !run[1].startsWith('|')) commands.push(stripQuotes(run[1]));
  }
  return commands;
}

function firstMatch(lines: readonly string[], pattern: RegExp): string | undefined {
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match?.[1] !== undefined) return stripQuotes(match[1]);
  }
  return undefined;
}

function readJob(block: JobBlock): WorkflowJob {
  const text = block.lines.join('\n');
  const needsList = firstMatch(block.lines, NEEDS_KEY) ?? '';
  return {
    id: block.id,
    name: firstMatch(block.lines, NAME_KEY),
    runsOn: firstMatch(block.lines, RUNS_ON_KEY),
    runCommands: stepCommands(block.lines),
    usesActions: block.lines
      .map((line) => USES_STEP.exec(line)?.[1])
      .filter((action): action is string => action !== undefined),
    checksOutSubmodules: /^\s*submodules:\s*recursive\s*$/m.test(text),
    fetchesFullHistory: /^\s*fetch-depth:\s*0\s*$/m.test(text),
    needs: needsList
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
    text,
  };
}

export function readWorkflowJobs(relativePath: string): WorkflowJob[] {
  return splitJobBlocks(readRepoFile(relativePath).split('\n')).map(readJob);
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(['"])(.*)\1$/.exec(trimmed);
  return quoted?.[2] ?? trimmed;
}

export function usesFoundryToolchain(job: WorkflowJob): boolean {
  return job.usesActions.some((action) => action.startsWith('foundry-rs/foundry-toolchain'));
}

export function installsPnpmWorkspace(job: WorkflowJob): boolean {
  return job.runCommands.some((command) => command.startsWith('pnpm install --frozen-lockfile'));
}

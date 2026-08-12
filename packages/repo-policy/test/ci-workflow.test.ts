import { describe, expect, it } from 'vitest';
import {
  ROOT_PACKAGE,
  resolveLeafToScripts,
  scriptNeedsFoundry,
  splitScriptBody,
} from '../src/approved-scripts.ts';
import {
  installsPnpmWorkspace,
  readWorkflowJobs,
  usesFoundryToolchain,
  type WorkflowJob,
  workflowFiles,
} from '../src/ci-workflows.ts';
import { rootScripts, workspacePackages } from '../src/repo.ts';

/**
 * The Phase 0 remediation review recorded a CI job that could not pass on a clean runner. It
 * ran `pnpm typecheck` and `pnpm build`, both of which turbo fans out to `forge`, while
 * installing no Foundry toolchain and checking out no submodules. It had never been observed
 * failing because this repository has no git remote and no CI run has ever happened.
 *
 * The requirement below is derived, not listed: `scriptNeedsFoundry` walks the same script
 * graph the permission policy walks. Adding `forge` to a script that CI runs makes this test
 * fail until the job that runs it installs the toolchain.
 */

const jobs = workflowFiles().flatMap((file) => readWorkflowJobs(file));
const byId = new Map(jobs.map((job) => [job.id, job]));

const REQUIRED_GATE_COMMANDS: readonly string[] = [
  'pnpm format:check',
  'pnpm lint',
  'pnpm typecheck',
  'pnpm test',
  'pnpm test:integration',
  'pnpm test:e2e',
  'pnpm build',
  'pnpm --filter contracts test',
  'pnpm --filter contracts test:invariant',
];

/** `pnpm <script>` when the run command is one, otherwise undefined. */
function rootScriptOf(command: string): string | undefined {
  const match = /^pnpm ([A-Za-z0-9:._-]+)$/.exec(command);
  const script = match?.[1];
  if (script === undefined) return undefined;
  return rootScripts()[script] === undefined ? undefined : script;
}

function commandNeedsFoundry(command: string): boolean {
  if (/^(forge|cast|anvil)\b/.test(command)) return true;
  const script = rootScriptOf(command);
  if (script !== undefined) return scriptNeedsFoundry(ROOT_PACKAGE, script);
  const [target] = resolveLeafToScripts(command);
  return target === undefined ? false : scriptNeedsFoundry(target.package, target.script);
}

/** The commands a job actually executes, or the bodies they resolve to. */
function executedCommands(job: WorkflowJob): string[] {
  const out: string[] = [];
  for (const command of job.runCommands) {
    out.push(command);
    for (const target of resolveLeafToScripts(command)) {
      out.push(`${target.package}#${target.script}`);
    }
  }
  return out;
}

describe('every committed job can pass on a clean runner', () => {
  it('finds the jobs, so a parse failure cannot make this suite vacuous', () => {
    expect(jobs.map((job) => job.id)).toStrictEqual(['workspace', 'contracts', 'policy', 'gate']);
    for (const job of jobs) {
      expect(job.runsOn, `${job.id} has no runs-on`).toBeDefined();
    }
    expect(byId.get('workspace')?.runCommands.length).toBeGreaterThan(5);
  });

  it.each(jobs.map((job) => [job.id, job] as const))(
    '%s installs Foundry and submodules if any command it runs reaches forge',
    (id, job) => {
      const foundryCommands = job.runCommands.filter(commandNeedsFoundry);
      if (foundryCommands.length === 0) return;
      expect(
        usesFoundryToolchain(job),
        `${id} runs ${foundryCommands.join(', ')} but installs no Foundry toolchain`,
      ).toBe(true);
      expect(
        job.checksOutSubmodules,
        `${id} runs ${foundryCommands.join(', ')} but checks out no submodules`,
      ).toBe(true);
    },
  );

  it.each(jobs.map((job) => [job.id, job] as const))(
    '%s installs the workspace if it runs a pnpm command',
    (id, job) => {
      const pnpmCommands = job.runCommands.filter(
        (command) => command.startsWith('pnpm ') && command !== 'pnpm install --frozen-lockfile',
      );
      if (pnpmCommands.length === 0) return;
      expect(installsPnpmWorkspace(job), `${id} runs pnpm without a frozen-lockfile install`).toBe(
        true,
      );
      expect(job.usesActions.some((action) => action.startsWith('pnpm/action-setup'))).toBe(true);
      expect(job.usesActions.some((action) => action.startsWith('actions/setup-node'))).toBe(true);
    },
  );

  it('installs no toolchain a job does not need, so the split stays meaningful', () => {
    const policy = byId.get('policy');
    expect(policy?.runCommands.some(commandNeedsFoundry)).toBe(false);
    expect(usesFoundryToolchain(policy as WorkflowJob)).toBe(false);
  });
});

function scriptBody(target: { package: string; script: string }): string {
  if (target.package === ROOT_PACKAGE) return rootScripts()[target.script] ?? '';
  return (
    workspacePackages().find((pkg) => pkg.name === target.package)?.scripts[target.script] ?? ''
  );
}

describe('CI runs the whole gate', () => {
  const executed = jobs.flatMap(executedCommands);

  it.each(REQUIRED_GATE_COMMANDS)('runs %s, directly or as the body it resolves to', (command) => {
    if (executed.includes(command)) return;

    // The contracts job runs `forge test -vv` rather than `pnpm --filter contracts test`, so a
    // command counts as covered when a job runs the body that command would have run.
    const [target] = resolveLeafToScripts(command);
    expect(target, `${command} is in the gate and no CI job runs it`).toBeDefined();
    if (target === undefined) return;

    const leaves = splitScriptBody(scriptBody(target));
    expect(leaves.length, `${command} resolves to an empty body`).toBeGreaterThan(0);
    expect(
      leaves.every((leaf) => executed.includes(leaf)),
      `${command} is in the gate; no CI job runs it or its body (${leaves.join(' | ')})`,
    ).toBe(true);
  });
});

describe('the aggregate gate job', () => {
  const gate = byId.get('gate');

  it('depends on every other job, so a green check means the whole repository is green', () => {
    const others = jobs.filter((job) => job.id !== 'gate').map((job) => job.id);
    expect([...(gate?.needs ?? [])].sort()).toStrictEqual([...others].sort());
  });

  it('reports rather than skips when a dependency fails', () => {
    expect(gate?.text).toContain('if: always()');
    expect(gate?.text).toContain("contains(needs.*.result, 'failure')");
  });
});

describe('the tracked-secret job sees full history', () => {
  it('fetches depth 0, because a shallow clone cannot answer the history question', () => {
    const policy = byId.get('policy');
    expect(policy?.fetchesFullHistory).toBe(true);
    expect(policy?.runCommands).toContain('pnpm --filter @resurv/repo-policy test');
  });
});

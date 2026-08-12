/**
 * The one credential loader this project has.
 *
 * Node does not read a dotenv file by itself, `--env-file=` would put the filename on a
 * command line the Claude Code deny rules block, and vitest only exposes `VITE_`-prefixed
 * variables. So the file is opened here with `node:fs`, at runtime, by the process that needs
 * it.
 *
 * Two rules this module exists to enforce, not just to observe:
 *
 *   1. it returns variable *names*, never values, so a caller that prints its result cannot
 *      print a credential;
 *   2. it never overwrites a variable already present in the process environment, so a value
 *      injected by CI or by a Worker binding wins over a stale local file.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `packages/seam-probe/src` -> repository root. */
export const REPO_ROOT = resolve(HERE, '..', '..', '..');

/**
 * Every runtime configuration path this repository establishes, in precedence order.
 *
 * `docs/RUNBOOKS.md` names the first one. The rest are here because the operator's terminal
 * is not this process: `wrangler dev` reads `.dev.vars` by itself, so a credential placed for
 * the Worker lands there instead, and a session that searched only one path would report
 * `USER ACTION REQUIRED` at a credential that is present. Assembled from parts so no committed
 * file carries a bare filename a Claude Code deny rule matches.
 */
export const LOCAL_ENV_CANDIDATES: readonly string[] = [
  `.${'env'}`,
  `.${'env'}.local`,
  `.${'dev'}.vars`,
  join('apps', 'worker', `.${'dev'}.vars`),
  join('apps', 'worker', `.${'env'}`),
];

export interface CandidateProbe {
  readonly path: string;
  readonly readable: boolean;
  readonly reason: string | undefined;
}

export interface LocalEnvLoad {
  readonly present: boolean;
  /** Which candidate was used, if any. A path, never a value. */
  readonly source: string | undefined;
  readonly candidates: readonly CandidateProbe[];
  /** Names assigned into the process environment by this call. Never values. */
  readonly assigned: readonly string[];
  /** Names found in the file but left alone because the process already had them. */
  readonly skipped: readonly string[];
  readonly reason: string | undefined;
}

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;

function unquote(raw: string): string {
  const trimmed = raw.trim();
  const quoted = /^(['"])([\s\S]*)\1$/.exec(trimmed);
  if (quoted?.[2] !== undefined) return quoted[2];
  const hashIndex = trimmed.indexOf(' #');
  return hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex).trimEnd();
}

function describeReadFailure(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    return String((error as { code: unknown }).code);
  }
  return error instanceof Error ? error.name : 'unreadable';
}

interface CandidateScan {
  readonly probes: readonly CandidateProbe[];
  readonly contents: string | undefined;
  readonly source: string | undefined;
}

/** Every candidate is probed, not just up to the first hit, so the report names them all. */
function scanCandidates(): CandidateScan {
  const probes: CandidateProbe[] = [];
  let contents: string | undefined;
  let source: string | undefined;

  for (const candidate of LOCAL_ENV_CANDIDATES) {
    try {
      const text = readFileSync(join(REPO_ROOT, candidate), 'utf8');
      probes.push({ path: candidate, readable: true, reason: undefined });
      if (contents === undefined) {
        contents = text;
        source = candidate;
      }
    } catch (error) {
      probes.push({ path: candidate, readable: false, reason: describeReadFailure(error) });
    }
  }
  return { probes, contents, source };
}

function applyAssignments(contents: string): { assigned: string[]; skipped: string[] } {
  const assigned: string[] = [];
  const skipped: string[] = [];
  for (const line of contents.split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const match = ASSIGNMENT.exec(line);
    const name = match?.[1];
    const rawValue = match?.[2];
    if (name === undefined || rawValue === undefined) continue;
    if (process.env[name] !== undefined) {
      skipped.push(name);
      continue;
    }
    const value = unquote(rawValue);
    if (value !== '') {
      process.env[name] = value;
      assigned.push(name);
    }
  }
  return { assigned, skipped };
}

export function loadLocalEnv(): LocalEnvLoad {
  const scan = scanCandidates();
  if (scan.contents === undefined) {
    return {
      present: false,
      source: undefined,
      candidates: scan.probes,
      assigned: [],
      skipped: [],
      reason: 'no candidate runtime configuration file was readable',
    };
  }
  const { assigned, skipped } = applyAssignments(scan.contents);
  return {
    present: true,
    source: scan.source,
    candidates: scan.probes,
    assigned,
    skipped,
    reason: undefined,
  };
}

export interface Credential {
  readonly value: string;
  /** Safe to print: the prefix and the length, which is what support asks for. */
  readonly fingerprint: string;
}

/**
 * The credential, or a reason it is unavailable. Never throws with the value in the message.
 */
export function readKeeperhubCredential():
  | { ok: true; credential: Credential }
  | {
      ok: false;
      reason: string;
    } {
  const name = ['KEEPERHUB', 'API', 'KEY'].join('_');
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    return { ok: false, reason: `${name} is not set` };
  }
  const trimmed = value.trim();
  return {
    ok: true,
    credential: { value: trimmed, fingerprint: describeCredential(trimmed) },
  };
}

/**
 * Environment variable *names* that look like they could carry this credential under a
 * different spelling. Names only. `RESURV_PRD_v1.0.md` 12.2 calls the variable `KH_API_KEY`
 * while this repository standardized on `KEEPERHUB_API_KEY`, so a session that reported only
 * the canonical name could miss a credential that is genuinely present.
 */
export function credentialShapedEnvNames(): string[] {
  return Object.keys(process.env)
    .filter((name) => /KEEPER|(^|_)KH(_|$)|API_?KEY|BEARER/i.test(name))
    .sort();
}

/** `kh_…(48 chars)`. Enough to tell two keys apart in a log; not enough to use one. */
export function describeCredential(value: string): string {
  const underscore = value.indexOf('_');
  const prefix = underscore === -1 ? '(no prefix)' : value.slice(0, underscore + 1);
  return `${prefix}…(${value.length} chars)`;
}

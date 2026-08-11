import { describe, expect, it } from 'vitest';
import { compileBashPattern, decide, splitCompound, stripWrappers } from '../src/bash-rules.ts';

const rules = {
  allow: ['Bash(pnpm test)', 'Bash(git status *)'],
  ask: ['Bash(curl *)'],
  deny: ['Bash(*.env*)'],
};

describe('pattern compilation follows the documented Bash rule semantics', () => {
  it('treats a trailing space-star as a word boundary', () => {
    const pattern = compileBashPattern('ls *');
    expect(pattern.test('ls -la')).toBe(true);
    expect(pattern.test('ls')).toBe(true);
    expect(pattern.test('lsof')).toBe(false);
  });

  it('treats a star without a space as an unbounded prefix', () => {
    expect(compileBashPattern('ls*').test('lsof')).toBe(true);
  });

  it('reads the colon-star suffix as an equivalent trailing wildcard', () => {
    expect(compileBashPattern('pnpm test:*').test('pnpm test --watch')).toBe(true);
    expect(compileBashPattern('pnpm test:*').test('pnpm test:integration')).toBe(false);
  });

  it('matches a wildcard in the middle and at the start', () => {
    expect(compileBashPattern('git * main').test('git push origin main')).toBe(true);
    expect(compileBashPattern('*wrangler deploy*').test('pnpm exec wrangler deploy')).toBe(true);
  });

  it('does not treat a colon inside a pattern as a wildcard', () => {
    expect(compileBashPattern('git:* push').test('git push origin main')).toBe(false);
  });
});

describe('compound commands and wrappers', () => {
  it('splits on every documented separator', () => {
    expect(splitCompound('a && b || c ; d | e & f')).toStrictEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('strips the documented wrapper set', () => {
    expect(stripWrappers('timeout 30 pnpm test')).toBe('pnpm test');
    expect(stripWrappers('nice pnpm test')).toBe('pnpm test');
    expect(stripWrappers('xargs grep pattern')).toBe('grep pattern');
    expect(stripWrappers('xargs -n1 grep pattern')).toBe('xargs -n1 grep pattern');
  });
});

describe('decision order', () => {
  it('requires every subcommand to be allowed before auto-approving a compound command', () => {
    expect(decide('pnpm test', rules)).toBe('allow');
    expect(decide('pnpm test && rm -rf /', rules)).toBe('prompt');
  });

  it('lets deny win over allow and ask', () => {
    expect(decide('git status && cat .env', rules)).toBe('deny');
  });

  it('lets ask win over allow', () => {
    expect(decide('pnpm test && curl https://example.com', rules)).toBe('ask');
  });

  it('prompts when nothing matches', () => {
    expect(decide('some-unknown-binary --flag', rules)).toBe('prompt');
  });

  it('does not let an unknown leading assignment carry an allow rule', () => {
    expect(decide('SECRET=1 pnpm test', rules)).toBe('prompt');
    expect(decide('NODE_ENV=test pnpm test', rules)).toBe('allow');
  });
});

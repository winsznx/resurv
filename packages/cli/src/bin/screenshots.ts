/**
 * Deterministic screenshots of the proof page, for the README and the submission.
 *
 *   pnpm --filter @resurv/cli screenshots            against a local production preview
 *   pnpm --filter @resurv/cli screenshots <base-url> against a deployed origin
 *
 * Two rules, and they are the reason this is a script rather than a person with a cropping tool:
 *
 * 1. **Nothing is staged.** The page renders the committed receipt and reads the same two public
 *    RPC origins any visitor does. If the canonical covenant were re-run, these images would
 *    change with it, which is the correct behaviour for a picture of evidence.
 * 2. **Nothing private can appear**, because there is nothing private to appear: the page holds
 *    no credential and the Worker holds none either. The script still greps its own captures'
 *    page text for credential shapes and fails rather than writing a leaking image.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '@resurv/node-runtime';
import { chromium, type Page } from 'playwright';

const OUT = join(REPO_ROOT, 'docs', 'assets');

const CREDENTIAL_SHAPES: readonly RegExp[] = [
  /\b(kh|wfb)_[A-Za-z0-9_-]{4,}/,
  /\bsb[a-z]?_[A-Za-z0-9_-]{8,}/,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
];

interface Shot {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly path?: string;
  readonly anchor?: string;
  readonly fullPage?: boolean;
  readonly clipTo?: string;
}

const SHOTS: readonly Shot[] = [
  { name: 'hero', width: 1440, height: 900 },
  { name: 'timeline', width: 1440, height: 1600, anchor: '#timeline', clipTo: '#timeline' },
  { name: 'atomic', width: 1440, height: 1000, anchor: '#atomic', clipTo: '#atomic' },
  { name: 'verify', width: 1440, height: 900, anchor: '#verify', clipTo: '#verify' },
  { name: 'full-page', width: 1440, height: 900, fullPage: true },
  { name: 'mobile', width: 390, height: 844, fullPage: true },
  {
    name: 'mobile-timeline',
    width: 390,
    height: 844,
    anchor: '#timeline',
    clipTo: '#timeline',
  },
];

// Read through Playwright's own API rather than `page.evaluate(() => document...)`. The callback
// would run in the browser and be correct, but it makes this Node package depend on DOM lib
// types, which is how a genuine `document` reference in server code stops being a type error.
async function assertNoSecrets(page: Page, name: string): Promise<void> {
  const text = await page.locator('body').innerText();
  for (const shape of CREDENTIAL_SHAPES) {
    if (shape.test(text)) {
      throw new Error(`refusing to write ${name}.png: the page text matches ${shape}`);
    }
  }
}

async function main(): Promise<void> {
  const base = process.argv[2] ?? 'http://localhost:4173';
  mkdirSync(OUT, { recursive: true });
  process.stdout.write(`capturing ${base}\n`);

  const browser = await chromium.launch();
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: 2,
      colorScheme: 'light',
    });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(`${shot.name}: ${message.text()}`);
    });
    page.on('requestfailed', (request) => {
      failedRequests.push(`${shot.name}: ${request.url()} ${request.failure()?.errorText ?? ''}`);
    });

    await page.goto(`${base}${shot.path ?? '/'}`, { waitUntil: 'networkidle' });
    // The live panel reads two public RPC origins. Wait for it to settle so the capture shows
    // real values rather than the loading state, but do not fail the run if a node is slow:
    // the page is designed to be honest about that and the capture should show what it shows.
    await page
      .getByText('reading…')
      .first()
      .waitFor({ state: 'hidden', timeout: 25_000 })
      .catch(() => process.stdout.write(`  ${shot.name}: live panel did not settle in time\n`));

    if (shot.anchor !== undefined) {
      await page.locator(shot.anchor).scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
    }

    await assertNoSecrets(page, shot.name);

    const file = join(OUT, `${shot.name}.png`);
    if (shot.clipTo !== undefined) {
      const element = page.locator(shot.clipTo);
      await element.screenshot({ path: file });
    } else {
      await page.screenshot({ path: file, fullPage: shot.fullPage ?? false });
    }
    process.stdout.write(`  ${shot.name}.png  ${shot.width}x${shot.height}\n`);
    await context.close();
  }

  await browser.close();

  const report = {
    capturedAt: new Date().toISOString(),
    base,
    shots: SHOTS.map((shot) => shot.name),
    // Recorded rather than suppressed, and worth reading rather than skimming. Every entry here
    // is a *browser* failure, because the page reads the two public RPC origins directly from
    // the visitor's browser with no RESURV server in the trust path. Seven captures back to back
    // is far more traffic than a visitor generates, and the public endpoints start refusing:
    // CORS preflights get dropped, TLS records fail. A shot that hits that shows the page's
    // honest "RPC down" state, which is the correct behaviour and the reason that state exists.
    // Nothing here indicates a defect in the page, and nothing here is a request the page makes
    // to a RESURV origin, because there are none.
    consoleErrors,
    failedRequests,
  };
  // Generated output, excluded from the formatter in `biome.json`: it is a record of what a
  // capture run observed, and reformatting it on every run would make the gate fail after every
  // capture for no reason a reader benefits from.
  writeFileSync(join(OUT, 'capture-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (consoleErrors.length > 0) {
    process.stdout.write(`\nconsole errors:\n${consoleErrors.join('\n')}\n`);
  }
  if (failedRequests.length > 0) {
    process.stdout.write(`\nfailed requests:\n${failedRequests.join('\n')}\n`);
  }
  process.stdout.write(`\nwrote ${SHOTS.length} images to docs/assets\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

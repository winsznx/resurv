import type { ReceiptStep } from '@resurv/proof';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Timeline } from '../../src/proof/timeline.tsx';

/**
 * The timeline, driven by synthetic steps rather than by the committed receipt.
 *
 * The page-level specs next door all render `RECEIPT`, so between them they exercise exactly the
 * one label-and-state combination that happens to be committed today. That is the right harness
 * for "does the page show the evidence" and the wrong one for "what does the page do when the
 * evidence is not what it expected", which is the question that matters for a proof surface: a
 * component whose narrative is keyed by label and whose status is read live can render a
 * confident sentence next to a contradicting chip, and nothing would notice.
 */

function step(overrides: Partial<ReceiptStep> & Pick<ReceiptStep, 'label' | 'state'>): ReceiptStep {
  return {
    note: 'a note',
    transactionHash: undefined,
    explorer: undefined,
    ...overrides,
  } as ReceiptStep;
}

const render = (steps: readonly ReceiptStep[]) => renderToStaticMarkup(<Timeline steps={steps} />);

describe('a step whose state contradicts its narrative', () => {
  it('shows the live state rather than the story the label expects', () => {
    // #given the refused primary action, recorded as confirmed
    const markup = render([step({ label: 'attempt-primary', state: 'CONFIRMED' })]);

    // #then the chip follows the receipt
    expect(markup).toContain('confirmed on chain');
    expect(markup).not.toContain('refused, not broadcast');
  });

  it('does not claim a refusal marker for a step that was not refused', () => {
    // #given
    const refused = render([step({ label: 'attempt-primary', state: 'SIMULATION_REJECTED' })]);
    const confirmed = render([step({ label: 'attempt-primary', state: 'CONFIRMED' })]);

    // #then the marker is evidence-driven, not narrative-driven
    expect(refused).toContain('resurv-rail__marker--refused');
    expect(confirmed).not.toContain('resurv-rail__marker--refused');
  });
});

describe('steps the page has no narrative for', () => {
  it('renders an unknown label instead of silently dropping it', () => {
    // #given a receipt that recorded something this build has never heard of
    const markup = render([
      step({ label: 'attempt-fallback', state: 'CONFIRMED', transactionHash: '0xabc' }),
      step({ label: 'a-step-from-the-future', state: 'CONFIRMED', note: 'recorded anyway' }),
    ]);

    // #then it is visible, with its own note as the explanation
    expect(markup).toContain('a-step-from-the-future');
    expect(markup).toContain('recorded anyway');
    expect(markup).toContain('Also recorded');
  });

  it('renders an unrecognized state readably rather than as a raw enum', () => {
    // #given
    const markup = render([
      step({ label: 'attempt-fallback', state: 'RECONCILIATION_REQUIRED' as ReceiptStep['state'] }),
    ]);

    // #then
    expect(markup).toContain('reconciliation required');
    expect(markup).not.toContain('RECONCILIATION_REQUIRED');
  });
});

describe('steps that share a label', () => {
  it('renders both rather than collapsing them to whichever came last', () => {
    // #given two records under one label, which a keyed lookup would silently merge
    const markup = render([
      step({ label: 'attempt-fallback', state: 'CONFIRMED', transactionHash: '0xaaa' }),
      step({ label: 'attempt-fallback', state: 'REJECTED', note: 'the second one' }),
    ]);

    // #then neither is dropped: a proof surface that hides a record is not a proof surface
    expect(markup).toContain('0xaaa');
    expect(markup).toContain('the second one');
  });
});

describe('evidence', () => {
  it('links a step that has a transaction and explains one that does not', () => {
    // #given
    const markup = render([
      step({ label: 'attempt-primary', state: 'SIMULATION_REJECTED', note: 'would have reverted' }),
      step({
        label: 'attempt-fallback',
        state: 'CONFIRMED',
        transactionHash: '0xabcdef1234567890',
      }),
    ]);

    // #then
    expect(markup).toContain('No transaction');
    expect(markup).toContain('would have reverted');
    expect(markup).toContain('0xabcdef1234567890');
  });

  it('renders nothing at all for an empty receipt rather than an empty narrative', () => {
    // #given a receipt with no steps, which should never happen and must not invent one
    const markup = render([]);

    // #then
    expect(markup).not.toContain('resurv-rail__node');
  });
});

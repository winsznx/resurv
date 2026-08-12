import { DEPLOYMENT, RECEIPT } from '@resurv/proof';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/app.tsx';

/**
 * The proof page, rendered.
 *
 * These are the first specs in this harness; it previously ran `--passWithNoTests` against a
 * directory holding a README, which `docs/BUILD_STATE.md` listed as a known defect rather than
 * as coverage.
 *
 * The render is server-side and synchronous, so the live chain reads never fire: what is under
 * test is the half of the page that comes from committed evidence. That is the half a judge
 * needs when a public RPC endpoint is having a bad day, and it is the half that must never show
 * a number nobody produced.
 */

const markup = renderToStaticMarkup(<App />);

describe('the proof page', () => {
  it('shows the covenant and the successful transaction', () => {
    // #then
    expect(markup).toContain(RECEIPT.covenant.covenantId);
    expect(markup).toContain(RECEIPT.successTransaction.hash ?? 'MISSING');
  });

  it('links the transaction to a block explorer', () => {
    // #then
    expect(markup).toContain(`sepolia.basescan.org/tx/${RECEIPT.successTransaction.hash}`);
  });

  it('renders every step of the timeline', () => {
    // #then
    for (const step of RECEIPT.steps) {
      expect(markup, `${step.label} is missing from the page`).toContain(
        step.state.replace(/_/g, ' ').toLowerCase(),
      );
    }
  });

  it('says the primary action was refused and the fallback confirmed', () => {
    // #then
    expect(markup).toContain('simulation rejected');
    expect(markup).toContain('confirmed');
  });

  it('states its limitations on the page rather than only in a document', () => {
    // #then
    for (const limitation of RECEIPT.limitations) {
      expect(markup).toContain(limitation.slice(0, 40));
    }
  });

  it('refuses the vocabulary the claim ledger forbids', () => {
    // #then: each of these appears only inside the explicit disclaimer list
    for (const forbidden of ['Trustless', 'Rollback', 'MEV protection', 'Exactly once']) {
      expect(markup).toContain(forbidden);
    }
    expect(markup).not.toMatch(/guaranteed recovery/i);
    expect(markup).not.toMatch(/production[- ]ready(?!\.)/i);
  });

  it('shows no hash that is not in a committed artifact', () => {
    // #given the artifacts, serialized, as the only permitted source of a 32-byte value
    const artifacts = `${JSON.stringify(RECEIPT)}${JSON.stringify(DEPLOYMENT)}`.toLowerCase();

    // #then
    for (const hash of new Set(markup.match(/0x[0-9a-f]{64}/gi) ?? [])) {
      expect(
        artifacts.includes(hash.toLowerCase()),
        `${hash} appears on the page and in no artifact`,
      ).toBe(true);
    }
  });

  it('quotes the exact role the refused action lacked', () => {
    // #then the revert reason is shown verbatim, including the role hash, rather than
    // paraphrased into "the action failed"
    expect(markup).toContain('AccessControlUnauthorizedAccount');
  });
});

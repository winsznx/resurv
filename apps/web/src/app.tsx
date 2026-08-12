import { explorerAddressUrl, explorerTxUrl } from '@resurv/chain';
import { ATOMIC_LOG_ORDER, DEPLOYMENT, RECEIPT, type ReceiptStep } from '@resurv/proof';
import { useEffect, useState } from 'react';
import {
  Card,
  Chip,
  type ChipTone,
  ExternalLink,
  Mono,
  Row,
  SectionHeading,
  Stat,
} from './proof/components.tsx';
import {
  decodeVerifierContext,
  formatUsd,
  type LiveVerification,
  shorten,
  verifyLive,
} from './proof/verify.ts';

/**
 * The public proof page.
 *
 * It answers the five questions PRD 17.4 asks, in the order a sceptic asks them, and it needs no
 * login and no credential. Everything about the past is read from artifacts the live run
 * committed; everything about the present is read from two public RPC origins in the visitor's
 * own browser, so nothing here depends on a RESURV server telling the truth.
 */

const STEP_TONE: Record<string, ChipTone> = {
  CONFIRMED: 'confirmed',
  SIMULATION_REJECTED: 'refused',
  REJECTED: 'rejected',
};

const STEP_TITLES: Record<string, string> = {
  'revoke-pauser': 'The primary lever is quietly revoked',
  'mint-fee': 'The success fee is minted to the requester',
  'approve-escrow': 'The escrow is approved to take the fee',
  'covenant-create': 'Covenant created: outcome, plan and authority committed',
  'covenant-arm': 'Covenant funded and ARMED',
  trigger: 'Signed risk trigger accepted',
  'attempt-primary': 'Attempt 1, pause: refused before broadcast',
  'attempt-fallback': 'Attempt 2, evacuate: executed and confirmed',
  'replay-trigger': 'The same trigger, replayed',
  'replay-attempt': 'The same attempt, replayed',
};

function stepTone(step: ReceiptStep): ChipTone {
  return STEP_TONE[step.state] ?? 'neutral';
}

export function App() {
  const [live, setLive] = useState<LiveVerification | undefined>(undefined);
  const [liveError, setLiveError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    verifyLive()
      .then((result) => {
        if (!cancelled) setLive(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLiveError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const context = decodeVerifierContext();
  const success = RECEIPT.successTransaction;

  // Derived, never typed in. A replay that produced a transaction would raise this number, and
  // the page would say so rather than continuing to assert a zero nobody re-checked.
  const duplicateEffects = RECEIPT.steps.filter(
    (step) => step.label.startsWith('replay-') && step.transactionHash !== undefined,
  ).length;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-cloud/70 border-b bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-[var(--page-max-width)] items-center justify-between px-6 py-4">
          <span className="font-semibold text-obsidian tracking-tight" style={{ fontSize: 18 }}>
            RESURV
          </span>
          <nav className="flex items-center gap-5" style={{ fontSize: 'var(--text-caption)' }}>
            <a href="#timeline" className="text-iron hover:text-obsidian">
              Timeline
            </a>
            <a href="#atomic" className="text-iron hover:text-obsidian">
              One transaction
            </a>
            <a href="#verify" className="text-iron hover:text-obsidian">
              Verify now
            </a>
            <a href="#evidence" className="text-iron hover:text-obsidian">
              Evidence
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[var(--page-max-width)] px-6 pb-24">
        {/* ---------------------------------------------------------------- hero */}
        <section className="py-16 md:py-20">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="confirmed">Base Sepolia · live</Chip>
            <Chip tone="neutral">executed through KeeperHub</Chip>
            <Chip tone="neutral">no credential needed to check this page</Chip>
          </div>
          <h1
            className="mt-6 max-w-4xl font-semibold text-obsidian"
            style={{ fontSize: 'clamp(38px, 6vw, 64px)', lineHeight: 1.08 }}
          >
            The transaction landed. That was never the question.
          </h1>
          <p className="mt-6 max-w-2xl text-steel" style={{ fontSize: 'var(--text-body-lg)' }}>
            RESURV is an outcome covenant. A protocol commits, before an incident, to what safe
            means and to a short list of pre-authorized recovery actions. The responder is paid only
            when a verifier observes that state, inside the same transaction that produced it. This
            page is one covenant that ran.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <Stat
                label="Covenant"
                value={live?.statusName ?? '…'}
                hint="read from chain just now"
              />
            </Card>
            <Card>
              <Stat
                label="Declared outcome"
                value={live === undefined ? '…' : live.satisfied ? 'True' : 'False'}
                hint="the verifier, called live"
              />
            </Card>
            <Card>
              <Stat
                label="Success fee released"
                value={live === undefined ? '…' : `${formatUsd(live.responderBalance)} rUSD`}
                hint="in the same transaction"
              />
            </Card>
            <Card>
              <Stat
                label="Duplicate attempts"
                value={`${duplicateEffects} effects`}
                hint="trigger and attempt both replayed"
              />
            </Card>
          </div>

          {success.hash === undefined ? null : (
            <div className="mt-8">
              <ExternalLink href={explorerTxUrl(success.hash)}>
                <span
                  className="font-semibold text-obsidian"
                  style={{ fontSize: 'var(--text-body)' }}
                >
                  Open the successful attempt on Basescan
                </span>
              </ExternalLink>
              <p className="mt-2">
                <Mono>{success.hash}</Mono>
              </p>
            </div>
          )}
        </section>

        {/* ------------------------------------------------------------- covenant */}
        <section className="py-10">
          <SectionHeading
            eyebrow="what was promised"
            title="The covenant, committed before anything happened"
          />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <p className="text-graphite" style={{ fontSize: 'var(--text-body)' }}>
                Safe means: <strong className="text-obsidian">the vault is paused</strong>, or{' '}
                <strong className="text-obsidian">
                  the vault is empty and the approved recipient received at least{' '}
                  {formatUsd(context.minimumReceived)} rUSD
                </strong>
                . Two recovery actions were approved, in order, with their targets, recipients and
                amount bounds fixed at creation. Nothing could add a third.
              </p>
              <div className="mt-6">
                {RECEIPT.recoveryPlan.map((action) => (
                  <Row key={action.index} label={`Action ${action.index}: ${action.name}`}>
                    <ExternalLink href={explorerAddressUrl(action.adapter)}>
                      <Mono>{shorten(action.adapter)}</Mono>
                    </ExternalLink>
                  </Row>
                ))}
                <Row label="Approved recipient">
                  <Mono>{shorten(context.safe)}</Mono>
                </Row>
                <Row label="Responder, paid on success">
                  <Mono>{shorten(RECEIPT.covenant.responder)}</Mono>
                </Row>
                <Row label="Trigger authority">
                  <Mono>{shorten(RECEIPT.covenant.triggerAuthority)}</Mono>
                </Row>
              </div>
            </Card>
            <Card tone="dark">
              <p style={{ fontSize: 'var(--text-caption)' }} className="text-ash">
                COVENANT ID
              </p>
              <p className="mt-2 break-all font-mono" style={{ fontSize: 'var(--text-caption)' }}>
                {RECEIPT.covenant.covenantId}
              </p>
              <p className="mt-6 text-ash" style={{ fontSize: 'var(--text-caption)' }}>
                VERIFIER CONTEXT HASH
              </p>
              <p className="mt-2 break-all font-mono" style={{ fontSize: 'var(--text-caption)' }}>
                {RECEIPT.covenant.verifierContextHash}
              </p>
              <p className="mt-6 text-ash" style={{ fontSize: 'var(--text-caption)' }}>
                The manager stores this hash. An attempt that supplies any other context is rejected
                before it reaches an adapter.
              </p>
            </Card>
          </div>
        </section>

        {/* ------------------------------------------------------------- timeline */}
        <section id="timeline" className="py-10">
          <SectionHeading eyebrow="what happened" title="The execution timeline" />
          <Card>
            <ol>
              {RECEIPT.steps.map((step, index) => (
                <li
                  key={step.label}
                  className="grid gap-3 border-cloud border-b py-5 last:border-b-0 md:grid-cols-[2.5rem_1fr_auto]"
                >
                  <span className="text-ash" style={{ fontSize: 'var(--text-caption)' }}>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <p
                      className="font-medium text-obsidian"
                      style={{ fontSize: 'var(--text-body)' }}
                    >
                      {STEP_TITLES[step.label] ?? step.label}
                    </p>
                    <p className="mt-1 text-steel" style={{ fontSize: 'var(--text-caption)' }}>
                      {step.note}
                    </p>
                    {step.explorer === undefined ? null : (
                      <p className="mt-2">
                        <ExternalLink href={step.explorer}>
                          <Mono>{shorten(step.transactionHash ?? '', 14, 10)}</Mono>
                        </ExternalLink>
                      </p>
                    )}
                  </div>
                  <div className="md:text-right">
                    <Chip tone={stepTone(step)}>{step.state.replace(/_/g, ' ').toLowerCase()}</Chip>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
          <p className="mt-4 max-w-3xl text-steel" style={{ fontSize: 'var(--text-caption)' }}>
            Step 8 is the one that matters. The primary action was refused by simulation, so no
            transaction was ever sent and nothing on chain moved. RESURV did not retry it, did not
            widen its authority and did not guess: it moved to the next action its covenant had
            already approved.
          </p>
        </section>

        {/* --------------------------------------------------------------- atomic */}
        <section id="atomic" className="py-10">
          <SectionHeading
            eyebrow="why it is not just a bot"
            title="One transaction, six logs, in this order"
          />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <ol>
                {ATOMIC_LOG_ORDER.map((entry, index) => (
                  <li
                    key={entry.id}
                    className="flex items-baseline gap-4 border-cloud border-b py-3 last:border-b-0"
                  >
                    <span className="text-ash" style={{ fontSize: 'var(--text-caption)' }}>
                      {index + 1}
                    </span>
                    <span
                      className="font-medium text-obsidian"
                      style={{ fontSize: 'var(--text-body)', minWidth: '11rem' }}
                    >
                      {entry.event}
                    </span>
                    <span className="text-steel" style={{ fontSize: 'var(--text-caption)' }}>
                      {entry.meaning}
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
            <Card tone="dark">
              <p className="font-semibold" style={{ fontSize: 'var(--text-subheading)' }}>
                Had the verifier returned false, none of these six logs would exist.
              </p>
              <p className="mt-4 text-ash" style={{ fontSize: 'var(--text-caption)' }}>
                The adapter's transfer, the covenant's state change and the fee release are the same
                transaction as the outcome check. A false postcondition reverts all of them
                together.
              </p>
              <p className="mt-4 text-ash" style={{ fontSize: 'var(--text-caption)' }}>
                This is not rollback. RESURV cannot undo a transaction that already confirmed, and
                never claims to. It makes sure the one it sends either produces the promised state
                or produces nothing.
              </p>
            </Card>
          </div>
        </section>

        {/* --------------------------------------------------------------- verify */}
        <section id="verify" className="py-10">
          <SectionHeading
            eyebrow="check it yourself"
            title="Read live, from two independent nodes"
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              {liveError !== undefined ? (
                <p className="text-ember" style={{ fontSize: 'var(--text-body)' }}>
                  A public RPC endpoint did not answer: {liveError}. The committed receipt below is
                  unaffected, and the same reads work from `cast`.
                </p>
              ) : live === undefined ? (
                <p className="text-steel" style={{ fontSize: 'var(--text-body)' }}>
                  Reading chain…
                </p>
              ) : (
                <div>
                  <Row label="Covenant status">{live.statusName}</Row>
                  <Row label="Verifier returns">
                    {live.satisfied ? 'satisfied' : 'not satisfied'}
                  </Row>
                  <Row label="Vault balance">{formatUsd(live.vaultBalance)} rUSD</Row>
                  <Row label="Approved recipient">{formatUsd(live.safeBalance)} rUSD</Row>
                  <Row label="Responder">{formatUsd(live.responderBalance)} rUSD</Row>
                  <Row label="Receipt, two origins">
                    {live.receiptOriginsAgreed ? 'agree' : 'disagree'}
                  </Row>
                  <Row label="Agrees with the committed receipt">
                    {live.matchesCommittedReceipt ? 'yes' : 'no'}
                  </Row>
                  <p className="mt-4 text-fog" style={{ fontSize: 'var(--text-caption)' }}>
                    {live.origins.join(' · ')}
                  </p>
                </div>
              )}
            </Card>
            <Card tone="dark">
              <p style={{ fontSize: 'var(--text-caption)' }} className="text-ash">
                OR FROM A TERMINAL
              </p>
              <pre
                className="mt-3 overflow-x-auto whitespace-pre text-snow"
                style={{ fontSize: 'var(--text-caption)', lineHeight: 1.7 }}
              >
                {`cast call ${RECEIPT.covenant.manager} \\
  "statusOf(bytes32)(uint8)" \\
  ${RECEIPT.covenant.covenantId} \\
  --rpc-url https://sepolia.base.org

cast receipt ${success.hash ?? ''} \\
  --rpc-url https://sepolia.base.org`}
              </pre>
              <p className="mt-4 text-ash" style={{ fontSize: 'var(--text-caption)' }}>
                Status 5 is SATISFIED. The receipt carries the six logs above, in that order.
              </p>
            </Card>
          </div>
        </section>

        {/* ------------------------------------------------------------ contracts */}
        <section className="py-10">
          <SectionHeading
            eyebrow="deployed without a funded deployer"
            title="Contracts, and how they got there"
          />
          <Card>
            <p className="mb-6 max-w-3xl text-steel" style={{ fontSize: 'var(--text-body)' }}>
              The KeeperHub organization wallet holds no native currency and the Direct Execution
              API has no deployment endpoint. Every contract below was deployed by a sponsored
              contract call to a public CREATE2 factory. Each address was computed before its
              transaction was sent, and each matched.
            </p>
            {Object.values(DEPLOYMENT.contracts).map((contract) => (
              <Row key={contract.name} label={contract.name}>
                <ExternalLink href={explorerAddressUrl(contract.address)}>
                  <Mono>{shorten(contract.address, 12, 10)}</Mono>
                </ExternalLink>
                {contract.predictedAddressMatched ? (
                  <span className="ml-3 text-steel">predicted ✓</span>
                ) : (
                  <span className="ml-3 text-ember">prediction missed</span>
                )}
              </Row>
            ))}
            <p className="mt-6 text-fog" style={{ fontSize: 'var(--text-caption)' }}>
              solc {DEPLOYMENT.solcVersion} · evm {DEPLOYMENT.evmVersion} · optimizer{' '}
              {DEPLOYMENT.optimizer.runs} runs · commit {DEPLOYMENT.gitCommit?.slice(0, 10)}
            </p>
          </Card>
        </section>

        {/* ------------------------------------------------------------- evidence */}
        <section id="evidence" className="py-10">
          <SectionHeading eyebrow="what this page does not claim" title="The evidence ledger" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <p className="font-medium text-obsidian" style={{ fontSize: 'var(--text-body)' }}>
                Limitations, stated here rather than left to be found
              </p>
              <ul className="mt-4 space-y-3">
                {RECEIPT.limitations.map((limitation) => (
                  <li
                    key={limitation}
                    className="text-steel"
                    style={{ fontSize: 'var(--text-caption)' }}
                  >
                    — {limitation}
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <p className="font-medium text-obsidian" style={{ fontSize: 'var(--text-body)' }}>
                Words this project does not use
              </p>
              <ul className="mt-4 space-y-3 text-steel" style={{ fontSize: 'var(--text-caption)' }}>
                <li>
                  — <strong>Trustless.</strong> The KeeperHub organization wallet and the RESURV
                  admin are trusted parties.
                </li>
                <li>
                  — <strong>Rollback.</strong> One attempt is one transaction. Nothing undoes a
                  confirmed one.
                </li>
                <li>
                  — <strong>MEV protection.</strong> Base Sepolia was measured with private mempool
                  routing off.
                </li>
                <li>
                  — <strong>Exactly once.</strong> KeeperHub bounds effects per idempotency key for
                  24 hours. Permanence comes from the onchain attempt id.
                </li>
                <li>
                  — <strong>Production ready.</strong> No external audit. This is a testnet
                  demonstration.
                </li>
              </ul>
            </Card>
          </div>
        </section>
      </main>

      <footer className="border-cloud border-t">
        <div
          className="mx-auto max-w-[var(--page-max-width)] px-6 py-10 text-fog"
          style={{ fontSize: 'var(--text-caption)' }}
        >
          RESURV · outcome-gated execution covenants · receipt generated{' '}
          {RECEIPT.generatedAt.slice(0, 19).replace('T', ' ')} UTC · chain {RECEIPT.chain.name} (
          {RECEIPT.chain.chainId})
        </div>
      </footer>
    </div>
  );
}

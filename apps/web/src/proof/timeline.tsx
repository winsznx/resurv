import { explorerTxUrl } from '@resurv/chain';
import type { ReceiptStep } from '@resurv/proof';
import { Chip, type ChipTone, ExternalLink, Mono } from './components.tsx';
import { shorten } from './verify.ts';

/**
 * The execution timeline: the one surface a judge has to understand, and the only place where
 * the product's argument is visible rather than asserted.
 *
 * It is a rail rather than a card grid on purpose. A grid says "here are some facts about a
 * run"; a rail says "this happened, then this happened, and the order is the point". The order
 * *is* the point: the primary action was refused, nothing was broadcast, and the next thing that
 * happened was the covenant's own second choice rather than a retry, a widened permission, or a
 * guess.
 *
 * Two beats are styled louder than the rest, because they are the two a reader must not skim:
 * the refusal, and the attempt that carried the whole outcome. Everything else is deliberately
 * quiet.
 */

interface Beat {
  /** Matches `ReceiptStep.label`. */
  readonly label: string;
  readonly phase: string;
  readonly title: string;
  /** What it means, in the language a protocol operator would use. */
  readonly meaning: string;
  readonly weight?: 'loud' | 'quiet';
}

const BEATS: readonly Beat[] = [
  {
    label: 'revoke-pauser',
    phase: 'Before the incident',
    title: 'The primary emergency lever is quietly revoked',
    meaning:
      'Six months of drift, in one transaction. The vault role the covenant’s first action depends on is taken away, and nobody finds out until it is needed.',
  },
  {
    label: 'mint-fee',
    phase: 'The covenant',
    title: 'The success fee is minted to the requester',
    meaning: 'One test dollar, which is what the responder will be paid if, and only if, it works.',
    weight: 'quiet',
  },
  {
    label: 'approve-escrow',
    phase: 'The covenant',
    title: 'The escrow is approved to take the fee',
    meaning: 'Standard ERC-20 approval. Nothing has moved yet.',
    weight: 'quiet',
  },
  {
    label: 'covenant-create',
    phase: 'The covenant',
    title: 'Covenant created',
    meaning:
      'The verifier, the two recovery actions with their exact targets, recipients and bounds, the trigger authority and the deadline are all committed. Nothing can add a third action after this point.',
  },
  {
    label: 'covenant-arm',
    phase: 'The covenant',
    title: 'Funded and ARMED',
    meaning: 'The fee is in escrow. The covenant is now live and waiting.',
  },
  {
    label: 'trigger',
    phase: 'The incident',
    title: 'A signed risk trigger is accepted',
    meaning:
      'EIP-712, signed by the covenant’s trigger authority and relayable by anyone. The nonce is consumed on acceptance. ARMED → TRIGGERED.',
  },
  {
    label: 'attempt-primary',
    phase: 'Recovery',
    title: 'Attempt 1 — pause — refused before broadcast',
    meaning:
      'KeeperHub simulated it first and it would have reverted: the adapter no longer holds the vault’s pauser role. No transaction was sent. Nothing on chain moved. RESURV did not retry it and did not widen its own authority.',
    weight: 'loud',
  },
  {
    label: 'attempt-fallback',
    phase: 'Recovery',
    title: 'Attempt 2 — evacuate — executed and confirmed',
    meaning:
      'The covenant’s own second choice, simulated clean and then executed through KeeperHub. One transaction carries the evacuation, the verifier result, the covenant’s state change and the fee release. Had the verifier returned false, none of it would exist.',
    weight: 'loud',
  },
  {
    label: 'replay-trigger',
    phase: 'Duplicate protection',
    title: 'The same signed trigger, replayed',
    meaning: 'Rejected. The nonce is spent and the covenant is terminal — two independent grounds.',
  },
  {
    label: 'replay-attempt',
    phase: 'Duplicate protection',
    title: 'The same attempt, replayed',
    meaning:
      'Rejected. The attempt id was burned on chain, permanently, in the transaction that used it.',
  },
];

const STATE_TONE: Record<string, ChipTone> = {
  CONFIRMED: 'confirmed',
  SIMULATION_REJECTED: 'refused',
  REJECTED: 'rejected',
};

const STATE_LABEL: Record<string, string> = {
  CONFIRMED: 'confirmed on chain',
  SIMULATION_REJECTED: 'refused, not broadcast',
  REJECTED: 'rejected',
};

export function Timeline({ steps }: { steps: readonly ReceiptStep[] }) {
  const byLabel = new Map(steps.map((step) => [step.label, step]));
  // Anything the receipt records that this page has no beat for is still shown, rather than
  // silently dropped: a page that hides a step it did not expect is not a proof surface.
  const extra = steps.filter((step) => !BEATS.some((beat) => beat.label === step.label));

  let lastPhase = '';

  return (
    <ol className="resurv-rail" aria-label="Execution timeline of the canonical covenant">
      {BEATS.map((beat, index) => {
        const step = byLabel.get(beat.label);
        if (step === undefined) return null;
        const showPhase = beat.phase !== lastPhase;
        lastPhase = beat.phase;
        return (
          <TimelineNode
            key={beat.label}
            index={index + 1}
            beat={beat}
            step={step}
            phase={showPhase ? beat.phase : undefined}
          />
        );
      })}
      {extra.map((step, index) => (
        <TimelineNode
          key={step.label}
          index={BEATS.length + index + 1}
          beat={{
            label: step.label,
            phase: 'Also recorded',
            title: step.label,
            meaning: step.note,
          }}
          step={step}
          phase={index === 0 ? 'Also recorded' : undefined}
        />
      ))}
    </ol>
  );
}

function TimelineNode({
  index,
  beat,
  step,
  phase,
}: {
  index: number;
  beat: Beat;
  step: ReceiptStep;
  phase: string | undefined;
}) {
  const loud = beat.weight === 'loud';
  const refused = step.state === 'SIMULATION_REJECTED';

  return (
    <li className="resurv-rail__item">
      {phase === undefined ? null : (
        <p className="resurv-rail__phase" aria-hidden="true">
          {phase}
        </p>
      )}
      <div className={`resurv-rail__node${loud ? ' resurv-rail__node--loud' : ''}`}>
        <span
          className={`resurv-rail__marker${refused ? ' resurv-rail__marker--refused' : ''}`}
          aria-hidden="true"
        >
          {String(index).padStart(2, '0')}
        </span>

        <div className="resurv-rail__body">
          <div className="resurv-rail__head">
            <h3 className={`resurv-rail__title${loud ? ' resurv-rail__title--loud' : ''}`}>
              {beat.title}
            </h3>
            <Chip tone={STATE_TONE[step.state] ?? 'neutral'}>
              {STATE_LABEL[step.state] ?? step.state.replace(/_/g, ' ').toLowerCase()}
            </Chip>
          </div>

          <p className="resurv-rail__meaning">{beat.meaning}</p>

          {step.transactionHash === undefined ? (
            <p className="resurv-rail__evidence">
              No transaction. This step is offchain evidence, and the reason is recorded verbatim:
              <span className="resurv-rail__note">{step.note}</span>
            </p>
          ) : (
            <p className="resurv-rail__evidence">
              <ExternalLink href={step.explorer ?? explorerTxUrl(step.transactionHash)}>
                <Mono>{shorten(step.transactionHash, 16, 12)}</Mono>
              </ExternalLink>
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

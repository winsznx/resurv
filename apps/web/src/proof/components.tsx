import type { ReactNode } from 'react';

/**
 * The visual vocabulary from `design.md`, as small pieces rather than repeated class strings.
 *
 * The register is Awesomic's: a near-achromatic zinc scale, 36px cards, hairline borders in
 * place of shadows, and one vivid accent used as punctuation and never as decoration. Here the
 * accent means exactly one thing, and it is the thing the page exists to say: an action that
 * was refused.
 */

export function Card({
  children,
  tone = 'light',
  className = '',
}: {
  children: ReactNode;
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const surface =
    tone === 'dark' ? 'bg-slate text-snow border-slate' : 'bg-snow text-graphite border-cloud';
  return (
    <section
      className={`rounded-[36px] border p-7 ${surface} ${className}`}
      style={{ borderWidth: 1 }}
    >
      {children}
    </section>
  );
}

export function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header className="mb-8">
      <p className="text-fog" style={{ fontSize: 'var(--text-caption)', letterSpacing: '0.08em' }}>
        {eyebrow.toUpperCase()}
      </p>
      <h2
        className="mt-2 font-semibold text-obsidian"
        style={{ fontSize: 'var(--text-heading-sm)', lineHeight: 1.25 }}
      >
        {title}
      </h2>
    </header>
  );
}

export type ChipTone = 'confirmed' | 'refused' | 'neutral' | 'rejected';

const CHIP_STYLES: Record<ChipTone, string> = {
  confirmed: 'bg-obsidian text-snow border-obsidian',
  refused: 'bg-ember text-snow border-ember',
  rejected: 'bg-iron text-snow border-iron',
  neutral: 'bg-transparent text-iron border-cloud',
};

export function Chip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-[12px] border px-2 py-1 ${CHIP_STYLES[tone]}`}
      style={{ fontSize: 'var(--text-caption)', borderWidth: 1, whiteSpace: 'nowrap' }}
    >
      {children}
    </span>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-iron" style={{ fontSize: 'var(--text-caption)' }}>
      {children}
    </span>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div>
      <p className="text-fog" style={{ fontSize: 'var(--text-caption)' }}>
        {label}
      </p>
      <p
        className="mt-1 font-semibold text-obsidian"
        style={{ fontSize: 'var(--text-heading-sm)', lineHeight: 1.15 }}
      >
        {value}
      </p>
      {hint === undefined ? null : (
        <p className="mt-1 text-steel" style={{ fontSize: 'var(--text-caption)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="underline decoration-mist underline-offset-4 hover:decoration-obsidian"
    >
      {children}
      <span aria-hidden="true"> ↗</span>
    </a>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-cloud border-b py-3 last:border-b-0">
      <span className="text-steel" style={{ fontSize: 'var(--text-caption)' }}>
        {label}
      </span>
      <span className="text-right" style={{ fontSize: 'var(--text-caption)' }}>
        {children}
      </span>
    </div>
  );
}

/**
 * Application shell. Deliberately empty of product surfaces: PRD Phase 0 forbids UI work
 * before the foundation gate passes, and the covenant, run and proof pages are built in the
 * frontend phase against design.md.
 */
export function App() {
  return (
    <main className="mx-auto max-w-[var(--page-max-width)] px-6 py-20">
      <h1
        className="font-semibold text-obsidian"
        style={{
          fontSize: 'var(--text-heading)',
          lineHeight: 'var(--leading-heading)',
        }}
      >
        RESURV
      </h1>
      <p className="mt-4 max-w-2xl text-steel">
        Outcome-gated execution covenants. Recovery actions execute until a declared onchain safe
        state is true, then the responder is paid in the same transaction.
      </p>
    </main>
  );
}

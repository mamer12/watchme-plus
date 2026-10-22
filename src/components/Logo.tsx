/** The Watchme+ wordmark: WATCHME with a red plus. */
export function Logo({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <span className="logo logo--compact" aria-label="Watchme+">
        W<span className="logo__plus">+</span>
      </span>
    );
  }
  return (
    <span className="logo" aria-label="Watchme+">
      WATCHME<span className="logo__plus">+</span>
    </span>
  );
}

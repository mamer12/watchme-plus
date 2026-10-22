export function SkeletonRow({ count = 6, portrait = false }: { count?: number; portrait?: boolean }) {
  return (
    <div className="row-track row-track--skeleton" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`skeleton ${portrait ? 'skeleton--portrait' : 'skeleton--card'}`} />
      ))}
    </div>
  );
}

export function SkeletonGrid({ count = 12 }: { count?: number }) {
  return (
    <div className="grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton skeleton--card" />
      ))}
    </div>
  );
}

/** `percent` (0-100) adds a number in the middle; `announce` is the coarser value read to screen readers. */
export function Spinner({ label = 'Loading', percent, announce }: { label?: string; percent?: number | null; announce?: number | null }) {
  if (percent == null) return <div className="spinner" role="status" aria-label={label} />;
  return (
    <div className="spinner-pct" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <span className="spinner-pct__n" aria-hidden="true">
        {percent}%
      </span>
      <span className="sr-only">{`Loading ${announce ?? percent} percent`}</span>
    </div>
  );
}

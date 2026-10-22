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

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="spinner" role="status" aria-label={label} />;
}

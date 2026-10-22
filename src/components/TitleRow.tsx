import { useRef } from 'react';
import type { Title } from '../api/types';
import { useInView } from '../hooks/useInView';
import { useQuery } from '../hooks/useQuery';
import { allowedAtLevel } from '../lib/ratings';
import { useLibrary } from '../state/store';
import { Row } from './Row';
import { SkeletonRow } from './Skeleton';
import { TitleCard } from './TitleCard';

interface Props {
  title: string;
  /** Unique cache key for this row's data (include level and kind). */
  queryKey: string;
  load: () => Promise<Title[]>;
  /** Only fetch once the row is near the viewport (default true). */
  lazy?: boolean;
  min?: number;
}

/** A row that loads its own titles, shows a skeleton meanwhile and hides itself when empty. */
export function TitleRow({ title, queryKey, load, lazy = true, min = 1 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useInView(ref, '500px');
  const level = useLibrary((s) => s.settings.level);
  const enabled = !lazy || near;
  const { data, loading, error } = useQuery(enabled ? queryKey : null, load);
  const items = (data ?? []).filter((t) => allowedAtLevel(t, level));

  if (enabled && !loading && (items.length < min || (error && !data))) return null;
  return (
    <div ref={ref} className="row-slot">
      {!data ? (
        <section className="row" aria-busy="true">
          <h2 className="row__title">{title}</h2>
          <SkeletonRow />
        </section>
      ) : (
        <Row title={title} id={queryKey.replace(/[^a-z0-9]/gi, '-')}>
          {items.map((t) => (
            <TitleCard key={t.id} title={t} />
          ))}
        </Row>
      )}
    </div>
  );
}

/** A row from titles already in memory (My List, Top Picks). */
export function StaticRow({ title, items, id }: { title: string; items: Title[]; id: string }) {
  if (!items.length) return null;
  return (
    <Row title={title} id={id}>
      {items.map((t) => (
        <TitleCard key={t.id} title={t} />
      ))}
    </Row>
  );
}

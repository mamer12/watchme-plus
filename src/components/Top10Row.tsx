import { useRef } from 'react';
import type { Kind, Title } from '../api/types';
import { getTrending, matchToCatalog, tmdbAvailable } from '../api/tmdb';
import { useInView } from '../hooks/useInView';
import { useQuery } from '../hooks/useQuery';
import { useTitleActions } from '../hooks/useTitleActions';
import { displayTitle } from '../lib/format';
import { allowedAtLevel } from '../lib/ratings';
import { useLibrary } from '../state/store';
import { pickImage } from '../lib/imageVariant';
import { Img } from './Img';
import { Row } from './Row';
import { SkeletonRow } from './Skeleton';

export function useTop10(kind: Kind, enabled = true) {
  const level = useLibrary((s) => s.settings.level);
  return useQuery(enabled && tmdbAvailable() ? `top10:${kind}:${level}` : null, async () => {
    const list = await matchToCatalog(await getTrending(kind), kind, level, 10);
    return list.filter((t) => allowedAtLevel(t, level));
  });
}

function Rank({ n }: { n: number }) {
  return (
    <svg className="rank" viewBox="0 0 100 120" preserveAspectRatio="xMaxYMax meet" aria-hidden="true">
      <text x="98" y="116" textAnchor="end">
        {n}
      </text>
    </svg>
  );
}

function Top10Card({ title, rank }: { title: Title; rank: number }) {
  const { openInfo } = useTitleActions();
  const lang = useLibrary((s) => s.settings.titleLang);
  const name = displayTitle(title, lang);
  const card = pickImage(title, 'card');
  return (
    <a
      href={`/title/${title.id}`}
      className={`top10-card ${rank === 10 ? 'top10-card--ten' : ''}`}
      aria-label={`Number ${rank}: ${name}`}
      onClick={(e) => {
        e.preventDefault();
        openInfo(title);
      }}
    >
      <Rank n={rank} />
      <span className="top10-card__poster">
        <Img src={card.src} fallback={card.fallback} width={293} height={439} alt="" />
        {!card.src && <span className="boxart__name">{name}</span>}
      </span>
    </a>
  );
}

/** "Top 10 Movies/Series This Week" with big outlined rank numerals. */
export function Top10Row({ kind }: { kind: Kind }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useInView(ref, '500px');
  const { data, loading } = useTop10(kind, near);
  const label = `Top 10 ${kind === 'movie' ? 'Movies' : 'Series'} This Week`;
  if (near && !loading && (!data || data.length < 3)) return null;
  return (
    <div ref={ref} className="row-slot">
      {!data ? (
        <section className="row row--top10" aria-busy="true">
          <h2 className="row__title">{label}</h2>
          <SkeletonRow portrait count={5} />
        </section>
      ) : (
        <Row title={label} variant="top10" id={`top10-${kind}`}>
          {data.map((t, i) => (
            <Top10Card key={t.id} title={t} rank={i + 1} />
          ))}
        </Row>
      )}
    </div>
  );
}

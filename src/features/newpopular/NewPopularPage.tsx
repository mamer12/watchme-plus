import { useState } from 'react';
import { getBanner, getLatest } from '../../api/catalog';
import type { Title } from '../../api/types';
import { AgeBadge } from '../../components/Badges';
import { InfoIcon, PlayIcon } from '../../components/Icons';
import { Img } from '../../components/Img';
import { useArt } from '../../components/BoxArt';
import { SkeletonGrid } from '../../components/Skeleton';
import { useTop10 } from '../../components/Top10Row';
import { useQuery } from '../../hooks/useQuery';
import { useTitleActions } from '../../hooks/useTitleActions';
import { displayTitle, synopsis } from '../../lib/format';
import { allowedAtLevel } from '../../lib/ratings';
import { useLibrary } from '../../state/store';
import { ListButton } from '../../components/ListButton';

type Tab = 'new' | 'everyone' | 'top-series' | 'top-movies';

const TABS: { id: Tab; label: string }[] = [
  { id: 'new', label: 'New Releases' },
  { id: 'everyone', label: "Everyone's Watching" },
  { id: 'top-series', label: 'Top 10 Series' },
  { id: 'top-movies', label: 'Top 10 Movies' },
];

function Feature({ title, rank }: { title: Title; rank?: number }) {
  const lang = useLibrary((s) => s.settings.titleLang);
  const art = useArt(title, true);
  const { play, openInfo } = useTitleActions();
  const name = displayTitle(title, lang);
  const text = synopsis(title, lang);
  return (
    <article className="feature">
      {rank !== undefined && <span className="feature__rank">{rank}</span>}
      <div className="feature__body">
        <button type="button" className="feature__art" onClick={() => openInfo(title)} aria-label={`More info about ${name}`}>
          <Img src={title.cover ?? art?.backdrop ?? title.poster} alt="" className={title.cover || art?.backdrop ? '' : 'feature__poster'} />
        </button>
        <div className="feature__row">
          <h3 dir="auto">{name}</h3>
          <div className="feature__actions">
            <button type="button" className="icon-btn icon-btn--round icon-btn--primary" aria-label={`Play ${name}`} onClick={() => play(title)}>
              <PlayIcon size={18} />
            </button>
            <ListButton title={title} size="sm" />
            <button type="button" className="icon-btn icon-btn--round" aria-label={`More info about ${name}`} onClick={() => openInfo(title)}>
              <InfoIcon size={18} />
            </button>
          </div>
        </div>
        <div className="meta">
          {title.year && <span>{title.year}</span>}
          <AgeBadge title={title} />
          <span>{title.kind === 'series' ? 'Series' : 'Movie'}</span>
        </div>
        {text && (
          <p className="feature__text" dir="auto">
            {text}
          </p>
        )}
        {title.genres.length > 0 && (
          <ul className="genres">
            {title.genres.slice(0, 4).map((g) => (
              <li key={g.en}>{lang === 'ar' ? g.ar : g.en}</li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

function FeatureList({ items, loading, ranked = false, empty }: { items: Title[]; loading: boolean; ranked?: boolean; empty: string }) {
  const level = useLibrary((s) => s.settings.level);
  const list = items.filter((t) => allowedAtLevel(t, level));
  if (loading && !list.length) return <SkeletonGrid count={4} />;
  if (!list.length) return <p className="empty">{empty}</p>;
  return (
    <div className="feature-list">
      {list.map((t, i) => (
        <Feature key={t.id} title={t} rank={ranked ? i + 1 : undefined} />
      ))}
    </div>
  );
}

/** Coming Soon isn't available from the catalog, so: what's new, what's hot and the Top 10s. */
export function NewPopularPage() {
  const [tab, setTab] = useState<Tab>('new');
  const level = useLibrary((s) => s.settings.level);
  const latest = useQuery(tab === 'new' ? `new-both:${level}` : null, async () => {
    const [m, s] = await Promise.allSettled([getLatest('movie', level, 1, 20), getLatest('series', level, 1, 20)]);
    const movies = m.status === 'fulfilled' ? m.value : [];
    const series = s.status === 'fulfilled' ? s.value : [];
    const out: Title[] = [];
    for (let i = 0; i < Math.max(movies.length, series.length); i++) {
      const a = movies[i];
      const b = series[i];
      if (a) out.push(a);
      if (b) out.push(b);
    }
    return out;
  });
  const banner = useQuery(tab === 'everyone' ? `banner:${level}` : null, () => getBanner(level));
  const topSeries = useTop10('series', tab === 'top-series');
  const topMovies = useTop10('movie', tab === 'top-movies');
  const noTop = 'The weekly Top 10 needs TMDB, which isn’t reachable right now.';

  return (
    <div className="page new-page">
      <h1 className="page-title">New &amp; Popular</h1>
      <nav className="chips chips--scroll" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`chip ${tab === t.id ? 'active' : ''}`} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'new' && <FeatureList items={latest.data ?? []} loading={latest.loading} empty="Nothing new could be loaded." />}
      {tab === 'everyone' && <FeatureList items={banner.data ?? []} loading={banner.loading} empty="Nothing to show right now." />}
      {tab === 'top-series' && <FeatureList items={topSeries.data ?? []} loading={topSeries.loading} ranked empty={noTop} />}
      {tab === 'top-movies' && <FeatureList items={topMovies.data ?? []} loading={topMovies.loading} ranked empty={noTop} />}
    </div>
  );
}

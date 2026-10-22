import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getBanner, KNOWN_GENRES, getByGenre, searchTitles } from '../../api/catalog';
import { CloseIcon, PlayIcon, SearchIcon } from '../../components/Icons';
import { Img } from '../../components/Img';
import { pickImage } from '../../lib/imageVariant';
import { SkeletonGrid } from '../../components/Skeleton';
import { TitleGrid } from '../../components/TitleGrid';
import { useDebounced } from '../../hooks/useDebounced';
import { useQuery } from '../../hooks/useQuery';
import { useTitleActions } from '../../hooks/useTitleActions';
import { displayTitle } from '../../lib/format';
import { allowedAtLevel } from '../../lib/ratings';
import { useLibrary } from '../../state/store';
import { sparkName } from '../../lib/sparkBrand';
import { useTop10 } from '../../components/Top10Row';
import { mergeResults } from './merge';
import type { Title } from '../../api/types';

const DEBOUNCE_MS = 350;

function TopSearches() {
  const level = useLibrary((s) => s.settings.level);
  const lang = useLibrary((s) => s.settings.titleLang);
  const movies = useTop10('movie');
  const series = useTop10('series');
  const banner = useQuery(`banner:${level}`, () => getBanner(level));
  const { openInfo, play } = useTitleActions();
  const seen = new Set<string>();
  const list: Title[] = [];
  for (const t of [...(movies.data ?? []), ...(series.data ?? []), ...(banner.data ?? [])]) {
    if (!seen.has(t.id) && allowedAtLevel(t, level)) {
      seen.add(t.id);
      list.push(t);
    }
  }
  if (!list.length) return banner.loading ? <SkeletonGrid count={8} /> : null;
  return (
    <section className="top-searches">
      <h2 className="page-heading">Top Searches</h2>
      <ul className="top-searches__list">
        {list.slice(0, 20).map((t) => (
          <li key={t.id}>
            <button type="button" className="top-search" onClick={() => openInfo(t)}>
              <span className="top-search__img">
                <Img src={pickImage(t, "card").src} fallback={t.poster} width={293} height={439} alt="" />
              </span>
              <span className="top-search__name" dir="auto">
                {displayTitle(t, lang)}
              </span>
            </button>
            <button type="button" className="icon-btn icon-btn--round top-search__play" aria-label={`Play ${displayTitle(t, lang)}`} onClick={() => play(t)}>
              <PlayIcon size={18} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function GenreResults({ genre }: { genre: number }) {
  const level = useLibrary((s) => s.settings.level);
  const { data, loading } = useQuery(`genre-both:${level}:${genre}`, async () => {
    const [m, s] = await Promise.allSettled([getByGenre('movie', genre, level), getByGenre('series', genre, level)]);
    return mergeResults('', m.status === 'fulfilled' ? m.value : [], s.status === 'fulfilled' ? s.value : []);
  });
  if (loading && !data) return <SkeletonGrid />;
  return <TitleGrid items={(data ?? []).filter((t) => allowedAtLevel(t, level))} label="Genre results" />;
}

/** Instant search across movies and series; Arabic or English. */
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const genre = Number(params.get('genre')) || null;
  const query = useDebounced(q.trim(), DEBOUNCE_MS);
  const level = useLibrary((s) => s.settings.level);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

  const { data, loading, error } = useQuery(query ? `search:${level}:${query.toLowerCase()}` : null, async () => {
    const [m, s] = await Promise.allSettled([searchTitles(query, 'movie', level), searchTitles(query, 'series', level)]);
    if (m.status === 'rejected' && s.status === 'rejected') throw m.reason;
    return mergeResults(query, m.status === 'fulfilled' ? m.value : [], s.status === 'fulfilled' ? s.value : []);
  });
  const results = (data ?? []).filter((t) => allowedAtLevel(t, level));
  const genreName = KNOWN_GENRES.find((g) => g.id === genre)?.title;

  const set = (next: { q?: string; genre?: number | null }) => {
    const p = new URLSearchParams();
    if (next.q) p.set('q', next.q);
    if (next.genre) p.set('genre', String(next.genre));
    setParams(p, { replace: true });
  };

  return (
    <div className="page search-page">
      <h1 className="sr-only">Search</h1>
      <form className="searchbox" role="search" onSubmit={(e) => e.preventDefault()}>
        <SearchIcon size={22} />
        <input
          ref={input}
          type="search"
          dir="auto"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder="Search movies and series · ابحث عن فيلم أو مسلسل"
          aria-label="Search movies and series"
          value={q}
          onChange={(e) => set({ q: e.target.value })}
        />
        {q && (
          <button type="button" className="icon-btn" aria-label="Clear search" onClick={() => set({})}>
            <CloseIcon size={20} />
          </button>
        )}
      </form>

      {!q && (
        <Link to="/tonight" className="chip">
          {sparkName()} Tonight · الليلة
        </Link>
      )}

      {!q && (
        <nav className="chips chips--wrap" aria-label="Browse by genre">
          {KNOWN_GENRES.map((g) => (
            <button key={g.id} type="button" className={`chip ${genre === g.id ? 'active' : ''}`} aria-pressed={genre === g.id} onClick={() => set({ genre: genre === g.id ? null : g.id })}>
              {g.title}
            </button>
          ))}
        </nav>
      )}

      {q ? (
        loading || q.trim() !== query ? (
          <SkeletonGrid />
        ) : results.length ? (
          <>
            <h2 className="page-heading">Results for “{query}”</h2>
            <TitleGrid items={results} label="Search results" />
          </>
        ) : (
          <div className="empty">
            <h2>{error ? "Search isn't responding right now." : `No matches for “${query}”.`}</h2>
            <p>Try another title, an actor-free keyword, or search in Arabic. You can also browse a genre below.</p>
            <nav className="chips chips--wrap" aria-label="Suggestions">
              {KNOWN_GENRES.slice(0, 8).map((g) => (
                <button key={g.id} type="button" className="chip" onClick={() => set({ genre: g.id })}>
                  {g.title}
                </button>
              ))}
            </nav>
          </div>
        )
      ) : genre ? (
        <>
          <h2 className="page-heading">{genreName}</h2>
          <GenreResults genre={genre} />
        </>
      ) : (
        <TopSearches />
      )}
    </div>
  );
}

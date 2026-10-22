import { useMemo } from 'react';
import type { Kind, Title } from '../../api/types';
import { getByGenre, getGroups, getLatest, KNOWN_GENRES, genreId } from '../../api/catalog';
import { getRecommendations, matchToCatalog, tmdbAvailable } from '../../api/tmdb';
import { Billboard } from '../../components/Billboard';
import { Row } from '../../components/Row';
import { TitleCard } from '../../components/TitleCard';
import { StaticRow, TitleRow } from '../../components/TitleRow';
import { Top10Row } from '../../components/Top10Row';
import { useQuery } from '../../hooks/useQuery';
import { useTaste } from '../../hooks/useTaste';
import { displayTitle, episodeLabel } from '../../lib/format';
import { allowedAtLevel } from '../../lib/ratings';
import { topGenres, topPicks } from '../../lib/recommend';
import { continueWatching, excludedIds, fromSnapshot, removeFromContinue, type Snapshot } from '../../state/library';
import { update, useLibrary } from '../../state/store';
import { BECAUSE_LABEL, becauseSources, type BecauseSource } from './sources';

const PAGE_TITLES: Record<string, string> = { all: 'Home', movie: 'Movies', series: 'Series' };

function ContinueRow({ kind }: { kind: Kind | null }) {
  const progress = useLibrary((s) => s.progress);
  const seriesLast = useLibrary((s) => s.seriesLast);
  const snapshots = useLibrary((s) => s.snapshots);
  const items = useMemo(
    () => continueWatching({ progress, seriesLast, snapshots }, kind ?? undefined),
    [progress, seriesLast, snapshots, kind],
  );
  if (!items.length) return null;
  return (
    <Row title="Continue Watching" id="continue">
      {items.map((i) => (
        <TitleCard
          key={i.title.id}
          title={i.title}
          videoId={i.videoId}
          progress={i.fraction}
          label={episodeLabel(i.season, i.episode)}
          from={i.from}
          onRemove={() => update((s) => removeFromContinue(s, i.title.id))}
        />
      ))}
    </Row>
  );
}

function MyListRow({ kind }: { kind: Kind | null }) {
  const ids = useLibrary((s) => s.myList);
  const snapshots = useLibrary((s) => s.snapshots);
  const items = useMemo(
    () =>
      ids
        .map((id) => snapshots[id])
        .filter((s): s is NonNullable<typeof s> => !!s && (!kind || s.kind === kind))
        .map(fromSnapshot),
    [ids, snapshots, kind],
  );
  return <StaticRow title="My List" items={items} id="my-list" />;
}

/** What a loved title's recommendations add to their score in Top Picks (a liked one's: LIKE_BOOST). */
const LOVE_BOOST = 4;
const LIKE_BOOST = 2.5;

function TopPicksRow({ kind }: { kind: Kind | null }) {
  const level = useLibrary((s) => s.settings.level);
  const taste = useTaste();
  const genres = topGenres(taste, 2);
  const ratings = useLibrary((s) => s.ratings);
  const progress = useLibrary((s) => s.progress);
  const snapshots = useLibrary((s) => s.snapshots);
  // Up to three titles rated love (else like): what TMDB recommends for them joins the pool, ranked higher.
  const seeds = useMemo(() => {
    const rated = Object.entries(ratings).filter(([, r]) => r !== 'dislike');
    rated.sort((a, b) => (a[1] === b[1] ? 0 : a[1] === 'love' ? -1 : 1));
    const out: { snap: Snapshot; boost: number }[] = [];
    for (const [id, r] of rated) {
      const snap = snapshots[id];
      if (snap?.imdbId && (!kind || snap.kind === kind)) out.push({ snap, boost: r === 'love' ? LOVE_BOOST : LIKE_BOOST });
    }
    return out.slice(0, 3);
  }, [ratings, snapshots, kind]);
  const seedKey = seeds.map((x) => `${x.snap.id}${x.boost}`).join(',');
  const { data } = useQuery(`picks-pool:${level}:${kind ?? 'all'}:${genres.join(',')}:${seedKey}`, async () => {
    const kinds: Kind[] = kind ? [kind] : ['movie', 'series'];
    const jobs: Promise<Title[]>[] = [
      getGroups(level).then((g) => g.flatMap((x) => x.items)),
      ...kinds.map((k) => getLatest(k, level, 1, 30)),
    ];
    for (const g of genres) {
      const id = genreId(g);
      if (id !== null) for (const k of kinds) jobs.push(getByGenre(k, id, level));
    }
    const boosts = new Map<string, number>();
    if (tmdbAvailable()) {
      for (const { snap, boost } of seeds) {
        jobs.push(
          getRecommendations(snap.imdbId!, snap.kind)
            .then((recs) => matchToCatalog(recs, snap.kind, level, 12))
            .then((list) => {
              for (const t of list) boosts.set(t.id, Math.max(boosts.get(t.id) ?? 0, boost));
              return list;
            }),
        );
      }
    }
    const settled = await Promise.allSettled(jobs);
    return { pool: settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : [])), boosts };
  });
  const items = useMemo(() => {
    if (!data) return [];
    const exclude = excludedIds({ ratings, progress });
    for (const p of Object.values(progress)) exclude.add(p.seriesId ?? p.id);
    for (const { snap } of seeds) exclude.add(snap.id);
    const pool = data.pool.filter((t) => (!kind || t.kind === kind) && allowedAtLevel(t, level));
    return topPicks(pool, taste, exclude, 20, data.boosts);
  }, [data, kind, level, taste, ratings, progress, seeds]);
  if (items.length < 4) return null;
  return <StaticRow title="Top Picks for You" items={items} id="top-picks" />;
}

function BecauseRow({ from }: { from: BecauseSource }) {
  const level = useLibrary((s) => s.settings.level);
  const lang = useLibrary((s) => s.settings.titleLang);
  const source = from.snap;
  const imdb = source.imdbId;
  if (!imdb) return null;
  return (
    <TitleRow
      title={`${BECAUSE_LABEL[from.reason]} ${displayTitle(source, lang)}`}
      queryKey={`because:${level}:${source.id}`}
      min={3}
      load={async () => {
        const recs = await getRecommendations(imdb, source.kind);
        return (await matchToCatalog(recs, source.kind, level, 15)).filter((t) => t.id !== source.id);
      }}
    />
  );
}

/** The "Because You…" rows from `from` up to `to` (the first goes right under Top Picks, the rest after the Top 10s). */
function BecauseRows({ kind, from, to }: { kind: Kind | null; from: number; to: number }) {
  const progress = useLibrary((s) => s.progress);
  const ratings = useLibrary((s) => s.ratings);
  const snapshots = useLibrary((s) => s.snapshots);
  const sources = useMemo(
    () => becauseSources({ progress, ratings, snapshots }, kind, 3),
    [progress, ratings, snapshots, kind],
  );
  if (!tmdbAvailable()) return null;
  return (
    <>
      {sources.slice(from, to).map((s) => (
        <BecauseRow key={s.snap.id} from={s} />
      ))}
    </>
  );
}

function CuratedRows({ kind }: { kind: Kind | null }) {
  const level = useLibrary((s) => s.settings.level);
  const { data } = useQuery(`groups:${level}`, () => getGroups(level));
  if (!data) return null;
  return (
    <>
      {data.map((g) => {
        const items = g.items.filter((t) => (!kind || t.kind === kind) && allowedAtLevel(t, level));
        return items.length >= 4 ? <StaticRow key={g.id} title={g.title} items={items} id={`group-${g.id}`} /> : null;
      })}
    </>
  );
}

function GenreRows({ kind }: { kind: Kind | null }) {
  const level = useLibrary((s) => s.settings.level);
  const taste = useTaste();
  const ordered = useMemo(() => {
    const top = topGenres(taste, 15);
    const rank = (name: string) => {
      const i = top.indexOf(name.toLowerCase());
      return i < 0 ? 100 : i;
    };
    return [...KNOWN_GENRES].sort((a, b) => rank(a.title) - rank(b.title));
  }, [taste]);
  const rows: { kind: Kind; id: number; title: string }[] = [];
  ordered.forEach((g, i) => {
    if (kind) rows.push({ kind, id: g.id, title: `${g.title} ${kind === 'movie' ? 'Movies' : 'Series'}` });
    else if (i < 10) rows.push({ kind: i % 2 ? 'series' : 'movie', id: g.id, title: `${g.title} ${i % 2 ? 'Series' : 'Movies'}` });
  });
  return (
    <>
      {rows.map((r) => (
        <TitleRow key={`${r.kind}-${r.id}`} title={r.title} queryKey={`genre:${level}:${r.kind}:${r.id}`} min={4} load={() => getByGenre(r.kind, r.id, level)} />
      ))}
    </>
  );
}

/** Home, Movies and Series: the billboard and the rows. */
export function HomePage({ kind = null }: { kind?: Kind | null }) {
  const level = useLibrary((s) => s.settings.level);
  const pageKey = kind ?? 'all';
  return (
    <div className="home" data-kind={pageKey}>
      <h1 className="sr-only">{PAGE_TITLES[pageKey]}</h1>
      {kind && <div className="page-kind">{PAGE_TITLES[pageKey]}</div>}
      <Billboard kind={kind} />
      <div className="rows">
        {/* The same order as the TV app: personal rows first, the Top 10s after the first "Because You…". */}
        <ContinueRow kind={kind} />
        <TopPicksRow kind={kind} />
        <BecauseRows kind={kind} from={0} to={1} />
        {kind !== 'series' && <Top10Row kind="movie" />}
        {kind !== 'movie' && <Top10Row kind="series" />}
        <BecauseRows kind={kind} from={1} to={3} />
        <MyListRow kind={kind} />
        {kind !== 'series' && (
          <TitleRow title="New Release Movies" queryKey={`latest:${level}:movie`} lazy={false} load={() => getLatest('movie', level, 1, 30)} />
        )}
        {kind !== 'movie' && (
          <TitleRow title="New Episodes & Series" queryKey={`latest:${level}:series`} lazy={false} load={() => getLatest('series', level, 1, 30)} />
        )}
        <CuratedRows kind={kind} />
        <GenreRows kind={kind} />
      </div>
    </div>
  );
}

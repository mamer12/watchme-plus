import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Kind, Title } from '../../api/types';
import { getByGenre, genreId, KNOWN_GENRES } from '../../api/catalog';
import { getPopularAllTime, matchToCatalog, tmdbAvailable } from '../../api/tmdb';
import { CheckIcon } from '../../components/Icons';
import { Img } from '../../components/Img';
import { pickImage } from '../../lib/imageVariant';
import { Logo } from '../../components/Logo';
import { capabilities } from '../../profiles/logic';
import { profileStore } from '../../profiles/singleton';
import { ResetSiteLink } from '../settings/ResetSiteLink';
import { useQuery } from '../../hooks/useQuery';
import { displayTitle } from '../../lib/format';
import { allowedAtLevel } from '../../lib/ratings';
import { completeOnboarding, type KindChoice } from '../../state/library';
import { update, useLibrary } from '../../state/store';
import { interleave } from './interleave';

const TARGET = 36;
const KIND_OPTIONS: { value: KindChoice; label: string; hint: string }[] = [
  { value: 'movie', label: 'Movies', hint: 'Mostly films' },
  { value: 'series', label: 'Series', hint: 'Mostly shows' },
  { value: 'both', label: 'Both', hint: 'A bit of everything' },
];

/** The all-time most popular titles in the chosen genres that the catalog has; the catalog genre rows without TMDB. */
async function popularTitles(kinds: Kind[], genres: string[], level: 0 | 2 | 3): Promise<Title[]> {
  const perKind = Math.ceil(TARGET / kinds.length);
  const forKind = async (k: Kind): Promise<Title[]> => {
    let list: Title[] = [];
    if (tmdbAvailable()) {
      try {
        list = await matchToCatalog(await getPopularAllTime(k, genres), k, level, perKind);
      } catch {
        list = [];
      }
    }
    if (list.length < 8) {
      const ids = (genres.length ? genres : ['Drama', 'Action', 'Comedy']).map(genreId).filter((n): n is number => n !== null);
      const rows = await Promise.allSettled(ids.slice(0, 4).map((id) => getByGenre(k, id, level)));
      const extra = rows.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      list = [...list, ...extra.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))];
    }
    return list.filter((t) => allowedAtLevel(t, level));
  };
  const lists = await Promise.all(kinds.map(forKind));
  return interleave(lists[0] ?? [], lists[1] ?? [], TARGET);
}

export function Onboarding() {
  const navigate = useNavigate();
  const saved = useLibrary((s) => s.onboarding);
  const level = useLibrary((s) => s.settings.level);
  const lang = useLibrary((s) => s.settings.titleLang);
  const [step, setStep] = useState(0);
  const [kinds, setKinds] = useState<KindChoice>(saved.kinds);
  const [genres, setGenres] = useState<string[]>(saved.genres);
  const [liked, setLiked] = useState<Map<string, Title>>(new Map());
  const kindList: Kind[] = kinds === 'both' ? ['movie', 'series'] : [kinds];
  const key = `onboard:${level}:${kindList.join(',')}:${[...genres].sort().join(',')}`;
  const titles = useQuery(step === 2 ? key : null, () => popularTitles(kindList, genres, level));
  const items = useMemo(() => titles.data ?? [], [titles.data]);

  const finish = (skip = false) => {
    update((s) => completeOnboarding(s, kinds, genres, skip ? [] : [...liked.values()]));
    navigate('/', { replace: true });
  };

  const toggleGenre = (g: string) => setGenres((list) => (list.includes(g) ? list.filter((x) => x !== g) : [...list, g]));
  const toggleTitle = (t: Title) =>
    setLiked((m) => {
      const next = new Map(m);
      if (next.has(t.id)) next.delete(t.id);
      else next.set(t.id, t);
      return next;
    });

  return (
    <div className="onboarding">
      <header className="onboarding__top">
        <Logo />
        <button type="button" className="link" onClick={() => finish(true)}>
          Skip
        </button>
      </header>
      <ol className="onboarding__steps" aria-label="Progress">
        {[0, 1, 2].map((i) => (
          <li key={i} className={i <= step ? 'done' : ''} aria-current={i === step ? 'step' : undefined} />
        ))}
      </ol>

      {step === 0 && (
        <section className="onboarding__panel">
          <h1>What do you like to watch?</h1>
          <p>We'll tune your home screen around it.</p>
          <div className="kind-cards">
            {KIND_OPTIONS.map((o) => (
              <button key={o.value} type="button" className={`kind-card ${kinds === o.value ? 'active' : ''}`} aria-pressed={kinds === o.value} onClick={() => setKinds(o.value)}>
                <strong>{o.label}</strong>
                <span>{o.hint}</span>
              </button>
            ))}
          </div>
          {capabilities(profileStore.active()).reset && (
            <p className="onboarding__reset">
              <ResetSiteLink />
            </p>
          )}
          <div className="onboarding__nav">
            <button type="button" className="btn btn--play" onClick={() => setStep(1)}>
              Continue
            </button>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="onboarding__panel">
          <h1>Pick a few genres</h1>
          <p>Choose as many as you like.</p>
          <div className="chips chips--wrap chips--big">
            {KNOWN_GENRES.map((g) => (
              <button key={g.id} type="button" className={`chip ${genres.includes(g.title) ? 'active' : ''}`} aria-pressed={genres.includes(g.title)} onClick={() => toggleGenre(g.title)}>
                {genres.includes(g.title) && <CheckIcon size={16} />} {g.title}
              </button>
            ))}
          </div>
          <div className="onboarding__nav">
            <button type="button" className="btn btn--info" onClick={() => setStep(0)}>
              Back
            </button>
            <button type="button" className="btn btn--play" onClick={() => setStep(2)}>
              Continue
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="onboarding__panel onboarding__panel--wide">
          <h1>Tap what you've watched or liked</h1>
          <p>All-time favourites{genres.length ? ` in ${genres.slice(0, 3).join(', ')}${genres.length > 3 ? '…' : ''}` : ''}. Pick three or more.</p>
          <div className="poster-grid" role="group" aria-label="Titles">
            {titles.loading && !items.length
              ? Array.from({ length: 18 }, (_, i) => <div key={i} className="skeleton skeleton--portrait" />)
              : items.map((t) => {
                  const on = liked.has(t.id);
                  return (
                    <button key={t.id} type="button" className={`poster-pick ${on ? 'active' : ''}`} aria-pressed={on} onClick={() => toggleTitle(t)} title={displayTitle(t, lang)}>
                      <Img src={pickImage(t, "card").src} fallback={t.poster} width={293} height={439} alt="" />
                      <span className="poster-pick__name" dir="auto">
                        {displayTitle(t, lang)}
                      </span>
                      {on && (
                        <span className="poster-pick__check">
                          <CheckIcon size={22} />
                        </span>
                      )}
                    </button>
                  );
                })}
          </div>
          {!titles.loading && !items.length && <p className="empty">We couldn't load titles right now. You can finish and pick later.</p>}
          <div className="onboarding__nav onboarding__nav--sticky">
            <button type="button" className="btn btn--info" onClick={() => setStep(1)}>
              Back
            </button>
            <button type="button" className="btn btn--play" onClick={() => finish()}>
              {liked.size ? `Done (${liked.size})` : 'Done'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import type { Title } from '../../api/types';
import { Img } from '../../components/Img';
import { CheckIcon, PlayIcon } from '../../components/Icons';
import { runtime, synopsis } from '../../lib/format';
import { useLibrary } from '../../state/store';
import { seasonsOf } from '../player/logic';

interface Props {
  episodes: Title[];
  currentId: string | null;
  onPlay: (episode: Title) => void;
  /** Compact list for the player's Episodes panel. */
  compact?: boolean;
}

export function SeasonSelect({ seasons, value, onChange }: { seasons: number[]; value: number; onChange: (s: number) => void }) {
  if (seasons.length < 2) return <span className="season-single">Season {value}</span>;
  return (
    <select className="select" value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Season">
      {seasons.map((s) => (
        <option key={s} value={s}>
          Season {s}
        </option>
      ))}
    </select>
  );
}

/** Season selector + episode list with thumbnails, length, progress and a ✓ when finished. */
export function Episodes({ episodes, currentId, onPlay, compact = false }: Props) {
  const seasons = useMemo(() => seasonsOf(episodes), [episodes]);
  const current = episodes.find((e) => e.id === currentId);
  const [season, setSeason] = useState<number>(current?.season ?? seasons[0] ?? 1);
  const progress = useLibrary((s) => s.progress);
  const lang = useLibrary((s) => s.settings.titleLang);

  useEffect(() => {
    if (current?.season) setSeason(current.season);
  }, [current?.season]);

  const list = episodes.filter((e) => (e.season ?? 1) === season);
  return (
    <section className={`episodes ${compact ? 'episodes--compact' : ''}`} aria-label="Episodes">
      <div className="episodes__head">
        <h3>Episodes</h3>
        <SeasonSelect seasons={seasons} value={season} onChange={setSeason} />
      </div>
      <ol className="episodes__list">
        {list.map((e, i) => {
          const p = progress[e.id];
          const fraction = p ? (p.completed ? 1 : p.duration > 0 ? p.position / p.duration : 0) : 0;
          const text = synopsis(e, lang);
          return (
            <li key={e.id}>
              <button type="button" className={`episode ${e.id === currentId ? 'is-current' : ''}`} onClick={() => onPlay(e)}>
                <span className="episode__num">{e.episode ?? i + 1}</span>
                <span className="episode__thumb">
                  <Img src={e.posterThumb ?? e.poster} alt="" />
                  <span className="episode__play" aria-hidden="true">
                    <PlayIcon size={20} />
                  </span>
                  {fraction > 0 && (
                    <span className="progress progress--card">
                      <span style={{ width: `${Math.min(100, fraction * 100)}%` }} />
                    </span>
                  )}
                </span>
                <span className="episode__text">
                  <span className="episode__title">
                    Episode {e.episode ?? i + 1}
                    {p?.completed && (
                      <span className="episode__watched" aria-label="Watched">
                        <CheckIcon size={16} />
                      </span>
                    )}
                  </span>
                  {!compact && text && (
                    <span className="episode__synopsis" dir="auto">
                      {text}
                    </span>
                  )}
                </span>
                <span className="episode__len">{runtime(e.duration)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

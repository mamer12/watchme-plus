import { useEffect, useState } from 'react';
import type { SubtitleFiles, Title, TitleDetails, VideoFile } from '../../api/types';
import { getDetails, getEpisodes, getSubtitleFiles, getVideoFiles } from '../../api/catalog';

export interface PlayerData {
  /** The video these answers belong to. */
  id: string;
  details: TitleDetails | null;
  files: VideoFile[];
  subtitles: SubtitleFiles;
  episodes: Title[];
}

type Status = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; data: PlayerData };

/** Everything the player needs for one video. Episodes are kept across episode changes. */
export function usePlayerData(id: string, reloadKey: number): Status {
  const [status, setStatus] = useState<Status>({ state: 'loading' });
  const [episodes, setEpisodes] = useState<{ ids: Set<string>; list: Title[] }>({ ids: new Set(), list: [] });

  useEffect(() => {
    let alive = true;
    setStatus({ state: 'loading' });
    (async () => {
      const [details, files, subtitles] = await Promise.all([
        getDetails(id).catch(() => null),
        getVideoFiles(id),
        getSubtitleFiles(id).catch((): SubtitleFiles => ({ ar: null, en: null })),
      ]);
      let list = episodes.list;
      if (details?.kind === 'series' && !episodes.ids.has(id)) {
        list = await getEpisodes(id).catch(() => []);
        if (alive) setEpisodes({ ids: new Set(list.map((e) => e.id)), list });
      }
      if (!alive) return;
      if (!files.length) {
        setStatus({ state: 'error', message: "This video isn't available right now." });
        return;
      }
      setStatus({ state: 'ready', data: { id, details, files, subtitles, episodes: details?.kind === 'series' ? list : [] } });
    })().catch(() => {
      if (alive) setStatus({ state: 'error', message: "We couldn't reach the catalog. Check your connection and try again." });
    });
    return () => {
      alive = false;
    };
    // Episodes are read, not watched: they only change when this effect sets them.
  }, [id, reloadKey]);

  return status;
}

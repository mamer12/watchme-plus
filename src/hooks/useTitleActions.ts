import { useCallback } from 'react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';
import type { Title } from '../api/types';
import type { Rating } from '../lib/recommend';
import { warmPlayback } from '../lib/warmPlayback';
import { resumeFor, setRating, toggleMyList } from '../state/library';
import { getState, update } from '../state/store';

export interface ModalState {
  background?: Location;
  title?: Title;
}

/** Open the info modal, play (resuming), toggle My List and rate, from anywhere. */
export function useTitleActions() {
  const navigate = useNavigate();
  const location = useLocation();

  const openInfo = useCallback(
    (t: Title) => {
      const current = location.state as ModalState | null;
      const background = current?.background ?? location;
      navigate(`/title/${t.id}`, { state: { background, title: t } satisfies ModalState });
    },
    [navigate, location],
  );

  const play = useCallback(
    (t: Title, opts: { videoId?: string; restart?: boolean } = {}) => {
      const resume = resumeFor(getState(), t);
      const videoId = opts.videoId ?? resume?.videoId ?? t.id;
      warmPlayback(videoId);
      navigate(`/watch/${videoId}`, { state: { restart: !!opts.restart, title: t } });
    },
    [navigate],
  );

  const toggleList = useCallback((t: Title) => update((s) => toggleMyList(s, t)), []);
  const rate = useCallback((t: Title, r: Rating | null) => update((s) => setRating(s, t, r)), []);

  return { openInfo, play, toggleList, rate };
}

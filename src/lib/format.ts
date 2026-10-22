import type { Title, TitleLang } from '../api/types';

export function displayTitle(t: Pick<Title, 'enTitle' | 'arTitle'>, lang: TitleLang): string {
  return (lang === 'ar' ? t.arTitle || t.enTitle : t.enTitle || t.arTitle) || 'Untitled';
}

export function synopsis(t: Pick<Title, 'enContent' | 'arContent'>, lang: TitleLang): string {
  return (lang === 'ar' ? t.arContent || t.enContent : t.enContent || t.arContent).trim();
}

/** "1h 53m", "47m" */
export function runtime(seconds: number | null): string | null {
  if (seconds === null || !(seconds > 0)) return null;
  const mins = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/** "1:02:03" or "42:07" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function minutesLeft(seconds: number | null): string | null {
  if (seconds === null || !(seconds > 0)) return null;
  const m = Math.max(1, Math.round(seconds / 60));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m left`;
}

export function episodeLabel(season: number | null, episode: number | null): string | null {
  if (episode === null) return null;
  return `S${season ?? 1}:E${episode}`;
}

export function seasonsLabel(n: number): string {
  return n === 1 ? '1 Season' : `${n} Seasons`;
}

/** YouTube video id from any watch/share/embed URL. */
export function youtubeId(url: string | null): string | null {
  if (!url) return null;
  const m = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(url);
  return m?.[1] ?? null;
}

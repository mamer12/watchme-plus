import { useEffect, useMemo, useState } from 'react';
import type { SubtitleFiles } from '../../api/types';
import { cuesToVtt, decodeSubtitle, parseSrt, type Cue } from '../../lib/subtitles';
import type { SubtitleLang } from '../../state/library';

const memo = new Map<string, Cue[]>();

async function loadCues(url: string): Promise<Cue[]> {
  const hit = memo.get(url);
  if (hit) return hit;
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const cues = parseSrt(decodeSubtitle(await res.arrayBuffer()));
  memo.set(url, cues);
  return cues;
}

/**
 * Fetches the chosen SRT, decodes it (UTF-8 or Windows-1256) and gives back the cues for the
 * on-screen renderer plus a WebVTT Blob URL for the <track> (used by native fullscreen on iOS).
 */
export function useSubtitles(files: SubtitleFiles | null, lang: SubtitleLang, offset: number) {
  const url = !files || lang === 'off' ? null : files[lang];
  const [cues, setCues] = useState<{ url: string | null; cues: Cue[]; failed: boolean }>({ url: null, cues: [], failed: false });

  useEffect(() => {
    if (!url) {
      setCues({ url: null, cues: [], failed: false });
      return;
    }
    let alive = true;
    loadCues(url).then(
      (c) => alive && setCues({ url, cues: c, failed: false }),
      () => alive && setCues({ url, cues: [], failed: true }),
    );
    return () => {
      alive = false;
    };
  }, [url]);

  const active = cues.url === url ? cues.cues : [];
  const vttUrl = useMemo(() => {
    if (!active.length) return null;
    return URL.createObjectURL(new Blob([cuesToVtt(active, offset)], { type: 'text/vtt' }));
  }, [active, offset]);

  useEffect(() => {
    return () => {
      if (vttUrl) URL.revokeObjectURL(vttUrl);
    };
  }, [vttUrl]);

  return { cues: active, vttUrl, failed: cues.url === url && cues.failed };
}

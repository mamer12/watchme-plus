import { useCallback, useRef, useState } from 'react';
import { genreAffinity } from '../../lib/recommend';
import { excludedIds } from '../../state/library';
import { getState } from '../../state/store';
import { askTonight, realDeps, type AskDeps } from './api';
import { addUser, answerFallback, applyReply, canAnswer, canRefine, historyForApi, reopen, startChat, toFallback, type ChatState } from './machine';
import { resolvePicks, type ResolveDeps, type TonightPick } from './resolver';
import { buildTasteSummary } from './tasteSummary';
import { pick, UI } from './text';
import type { Lang } from './types';

export type Phase = 'chat' | 'finding' | 'results' | 'empty';

/** Drives the chat: asks the AI (or the fixed questions), then resolves the final filters into titles. */
export function useTonight(lang: Lang, level: ResolveDeps['level'], deps: () => AskDeps = realDeps) {
  const [chat, setChat] = useState<ChatState>(() => startChat('ai', lang));
  const [phase, setPhase] = useState<Phase>('chat');
  const [picks, setPicks] = useState<TonightPick[]>([]);
  const run = useRef(0);

  const finish = useCallback(
    async (filters: NonNullable<ChatState['filters']>, id: number) => {
      setPhase('finding');
      const s = getState();
      const affinity = genreAffinity({
        onboardingGenres: s.onboarding.genres,
        ratings: Object.fromEntries(Object.entries(s.ratings).map(([tid, rating]) => [tid, { rating, genres: s.snapshots[tid]?.genres.map((g) => g.en) ?? [] }])),
        watched: Object.values(s.progress).map((p) => ({ genres: s.snapshots[p.seriesId ?? p.id]?.genres.map((g) => g.en) ?? [], fraction: p.completed ? 1 : p.duration > 0 ? p.position / p.duration : 0 })),
      });
      let found: TonightPick[] = [];
      try {
        found = await resolvePicks(filters, { level, affinity, exclude: excludedIds(s), lang });
      } catch {
        found = [];
      }
      if (run.current !== id) return;
      setPicks(found);
      setPhase(found.length ? 'results' : 'empty');
    },
    [lang, level],
  );

  const askAi = useCallback(
    async (base: ChatState, text: string, id: number) => {
      const asked = addUser(base, text);
      if (asked === base) return;
      setChat(asked);
      const res = await askTonight(historyForApi(asked), buildTasteSummary(getState(), new Date(), lang), deps());
      if (run.current !== id) return;
      if (!res.ok) {
        setChat(toFallback(asked));
        setPhase('chat');
        return;
      }
      const next = applyReply(asked, res.reply);
      setChat(next);
      setPhase('chat');
      if (next.status === 'done' && next.filters) void finish(next.filters, id);
    },
    [lang, deps, finish],
  );

  const send = useCallback(
    async (text: string) => {
      if (!canAnswer(chat) || phase !== 'chat') return;
      const id = run.current;
      if (chat.mode === 'fallback') {
        const next = answerFallback(chat, text);
        setChat(next);
        if (next.status === 'done' && next.filters) void finish(next.filters, id);
        return;
      }
      await askAi(chat, text, id);
    },
    [chat, phase, finish, askAi],
  );

  /** After the picks: keep talking ("Funnier"); the AI answers with new filters. */
  const refine = useCallback(
    async (text: string) => {
      if (phase !== 'results' && phase !== 'empty') return;
      const again = reopen(chat);
      if (again === chat) return;
      await askAi(again, text, run.current);
    },
    [chat, phase, askAi],
  );
  const canRefineNow = (phase === 'results' || phase === 'empty') && canRefine(chat);

  const restart = useCallback(() => {
    run.current += 1;
    setChat(startChat('ai', lang));
    setPicks([]);
    setPhase('chat');
  }, [lang]);

  const status = chat.status === 'thinking' ? pick(UI.thinking, lang) : phase === 'finding' ? pick(UI.finding, lang) : '';
  return { chat, phase, picks, send, refine, canRefine: canRefineNow, restart, status };
}

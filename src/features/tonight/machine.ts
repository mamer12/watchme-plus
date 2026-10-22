/** The conversation state machine for Tonight. Pure: every function returns a new state. */
import { MAX_TEXT, MAX_USER_TURNS } from '../../../supabase/functions/spark-tonight/validate';
import { choicesFor, FALLBACK_STEPS, filtersFromAnswers, matchOption, stepAt, type Answers } from './fallback';
import { pick, UI } from './text';
import type { ChatMsg, Choice, Lang, TonightFilters, TonightReply } from './types';

export const MAX_HISTORY = 20;

export type Mode = 'ai' | 'fallback';
export type Status = 'asking' | 'thinking' | 'done';

export interface ChatState {
  mode: Mode;
  lang: Lang;
  messages: ChatMsg[];
  /** How many times the user answered. */
  turns: number;
  status: Status;
  choices: Choice[];
  filters: TonightFilters | null;
  step: number;
  answers: Answers;
}

const say = (s: ChatState, text: string): ChatMsg[] => [...s.messages, { role: 'assistant', text }];

const askStep = (s: ChatState, step: number, prefix?: string): ChatState => {
  const st = stepAt(step);
  if (!st) return s;
  return {
    ...s,
    step,
    status: 'asking',
    choices: choicesFor(st, s.lang),
    messages: [...s.messages, ...(prefix ? [{ role: 'assistant' as const, text: prefix }] : []), { role: 'assistant', text: pick(st.question, s.lang) }],
  };
};

/** A new chat: the greeting is the first fixed question, so both modes start the same way. */
export function startChat(mode: Mode, lang: Lang): ChatState {
  const base: ChatState = { mode, lang, messages: [], turns: 0, status: 'asking', choices: [], filters: null, step: 0, answers: {} };
  return askStep(base, 0);
}

/** Switches to the fixed questions (the AI is unreachable), from the first one, keeping what was said. */
export function toFallback(s: ChatState): ChatState {
  return askStep({ ...s, mode: 'fallback', answers: {}, filters: null, status: 'asking' }, 0, pick(UI.fallbackNote, s.lang));
}

export const canAnswer = (s: ChatState): boolean => s.status === 'asking';

/** Records the user's answer. Returns the same state when the input is empty or the chat is not waiting. */
export function addUser(s: ChatState, text: string): ChatState {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  if (!clean || !canAnswer(s)) return s;
  return { ...s, messages: [...s.messages, { role: 'user', text: clean }], turns: s.turns + 1, status: 'thinking', choices: [] };
}

/** A fixed-question answer (a chip or typed text). An unknown answer asks the same question again. */
export function answerFallback(s: ChatState, input: string): ChatState {
  const step = stepAt(s.step);
  if (!step || !canAnswer(s)) return s;
  const option = matchOption(step, input);
  const withUser = addUser(s, input);
  if (withUser === s) return s;
  if (!option) {
    return { ...withUser, turns: s.turns, status: 'asking', choices: choicesFor(step, s.lang), messages: [...withUser.messages, { role: 'assistant', text: pick(UI.pickOne, s.lang) }] };
  }
  const answers: Answers = { ...withUser.answers, [step.id]: option.id };
  const next = s.step + 1;
  if (next >= FALLBACK_STEPS.length) {
    return { ...withUser, answers, step: next, status: 'done', choices: [], filters: filtersFromAnswers(answers), messages: say(withUser, pick(UI.lead_in, s.lang)) };
  }
  return askStep({ ...withUser, answers }, next);
}

/** The AI's reply: the next question, or the filters (which end the chat). The turn cap ends it too. */
export function applyReply(s: ChatState, r: TonightReply): ChatState {
  const messages = say(s, r.say);
  if (r.filters) return { ...s, messages, status: 'done', choices: [], filters: r.filters };
  if (s.turns >= MAX_USER_TURNS) {
    return { ...s, messages: [...messages, { role: 'assistant', text: pick(UI.capped, s.lang) }], status: 'done', choices: [], filters: { type: 'any', genres: [], excludeGenres: [], keywords: [] } };
  }
  return { ...s, messages, status: 'asking', choices: r.choices.map((c) => ({ label: c, value: c })) };
}

/** The history sent to the AI: the last MAX_HISTORY messages, starting from a message the server accepts. */
export function historyForApi(s: ChatState): ChatMsg[] {
  const tail = s.messages.slice(-MAX_HISTORY);
  // The server wants the last message from the user; leading assistant messages are fine (it adds a start marker).
  return tail;
}

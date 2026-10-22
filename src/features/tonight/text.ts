import type { Lang } from './types';

export interface Bi {
  en: string;
  ar: string;
}

export const pick = (b: Bi, lang: Lang): string => (lang === 'ar' ? b.ar : b.en);

export const UI = {
  title: { en: 'Ask', ar: 'اسأل' },
  lead: { en: 'Tell me how you feel or what is on your mind, and I will find something for you.', ar: 'كللي شلون حاس أو شنو ببالك، وأدور لك على شي يناسبك.' },
  placeholder: { en: 'Type your answer…', ar: 'اكتب جوابك…' },
  send: { en: 'Send', ar: 'إرسال' },
  startOver: { en: 'Start over', ar: 'ابدأ من جديد' },
  thinking: { en: 'Thinking…', ar: 'لحظة…' },
  finding: { en: 'Finding titles…', ar: 'أدور على عناوين…' },
  picks: { en: 'Picked for you', ar: 'مختارة إلك' },
  nothing: { en: 'I could not find a match. Try other answers.', ar: 'ما لقيت شي مناسب. جرّب أجوبة ثانية.' },
  pickOne: { en: 'Please pick one of the options.', ar: 'اختر وحدة من الخيارات.' },
  fallbackNote: { en: 'The smart chat is not available right now, so here are a few quick questions.', ar: 'الدردشة الذكية مو متاحة هسه، فخلينا نكمل بكم سؤال سريع.' },
  lead_in: { en: 'Here is what fits.', ar: 'هاي اللي تناسبك.' },
  capped: { en: 'That is enough questions. Here is what I have.', ar: 'يكفي أسئلة. هاي اللي عندي.' },
  chat: { en: 'Conversation', ar: 'المحادثة' },
  refine: { en: 'Refine', ar: 'عدّل' },
} satisfies Record<string, Bi>;

/** Refine chips after the picks; the label is also what is sent to the AI as the user's message. */
export const REFINE: Bi[] = [
  { en: 'Funnier', ar: 'أضحك' },
  { en: 'Shorter', ar: 'أقصر' },
  { en: 'Older', ar: 'أقدم' },
  { en: 'More intense', ar: 'أقوى' },
  { en: 'Something different', ar: 'شي مختلف' },
];

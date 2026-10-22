import type { Lang } from './types';

export interface Bi {
  en: string;
  ar: string;
}

export const pick = (b: Bi, lang: Lang): string => (lang === 'ar' ? b.ar : b.en);

export const UI = {
  title: { en: 'Tonight', ar: 'الليلة' },
  lead: { en: 'Answer a few quick questions and get titles picked for tonight.', ar: 'جاوب على كم سؤال سريع وأطلع لك أفلام ومسلسلات تناسب الليلة.' },
  placeholder: { en: 'Type your answer…', ar: 'اكتب جوابك…' },
  send: { en: 'Send', ar: 'إرسال' },
  startOver: { en: 'Start over', ar: 'ابدأ من جديد' },
  thinking: { en: 'Thinking…', ar: 'لحظة…' },
  finding: { en: 'Finding titles…', ar: 'أدور على عناوين…' },
  picks: { en: 'Picked for tonight', ar: 'مختارة لليلة' },
  nothing: { en: 'I could not find a match. Try other answers.', ar: 'ما لقيت شي مناسب. جرّب أجوبة ثانية.' },
  pickOne: { en: 'Please pick one of the options.', ar: 'اختر وحدة من الخيارات.' },
  fallbackNote: { en: 'The smart chat is not available right now, so here are a few quick questions.', ar: 'الدردشة الذكية مو متاحة هسه، فخلينا نكمل بكم سؤال سريع.' },
  lead_in: { en: 'Here is what fits tonight.', ar: 'هاي اللي تناسب الليلة.' },
  capped: { en: 'That is enough questions. Here is what I have.', ar: 'يكفي أسئلة. هاي اللي عندي.' },
  chat: { en: 'Conversation', ar: 'المحادثة' },
  openEntry: { en: 'Tonight: help me pick', ar: 'الليلة: ساعدني أختار' },
  back: { en: 'Back to search', ar: 'رجوع للبحث' },
} satisfies Record<string, Bi>;

import { useEffect, useRef, useState } from 'react';
import { Spinner } from '../../components/Skeleton';
import { TitleCard } from '../../components/TitleCard';
import { sparkName } from '../../lib/sparkBrand';
import { useLibrary } from '../../state/store';
import { pick, REFINE, UI } from './text';
import { useTonight } from './useTonight';
import './tonight.css';

/** "Ask Spark": a short chat that ends in real titles. Its own screen; normal search never depends on it. */
export default function TonightPage() {
  const lang = useLibrary((s) => s.settings.titleLang);
  const level = useLibrary((s) => s.settings.level);
  const { chat, phase, picks, send, refine, canRefine, restart, status } = useTonight(lang, level);
  const [text, setText] = useState('');
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const canType = chat.status === 'asking' && phase === 'chat';

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [chat.messages.length, phase]);
  useEffect(() => {
    if (canType) input.current?.focus({ preventScroll: true });
  }, [canType, chat.messages.length]);

  const submit = (value: string) => {
    const v = value.trim();
    if (!v) return;
    setText('');
    void send(v);
  };

  return (
    <div className="page tonight" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
      <h1 className="page-heading">
        {pick(UI.title, lang)} {sparkName()}
      </h1>
      <p className="tonight__lead">{pick(UI.lead, lang)}</p>

      <div className="tonight__log" ref={log} role="log" aria-live="polite" aria-label={pick(UI.chat, lang)}>
        {chat.messages.map((m, i) => (
          <p key={i} className={`bubble bubble--${m.role}`} dir="auto">
            {m.text}
          </p>
        ))}
        {status && (
          <p className="bubble bubble--assistant bubble--status" role="status">
            <Spinner label={status} /> {status}
          </p>
        )}
      </div>

      {canType && chat.choices.length > 0 && (
        <nav className="chips chips--wrap" aria-label={pick(UI.chat, lang)}>
          {chat.choices.map((c) => (
            <button key={c.value} type="button" className="chip" onClick={() => submit(c.value)}>
              {c.label}
            </button>
          ))}
        </nav>
      )}

      <form className="tonight__form" onSubmit={(e) => { e.preventDefault(); submit(text); }}>
        <input ref={input} type="text" dir="auto" autoComplete="off" maxLength={400} disabled={!canType} placeholder={pick(UI.placeholder, lang)} aria-label={pick(UI.placeholder, lang)} value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="chip" disabled={!canType || !text.trim()}>
          {pick(UI.send, lang)}
        </button>
      </form>

      {phase === 'results' && (
        <section aria-label={pick(UI.picks, lang)}>
          <h2 className="page-heading">{pick(UI.picks, lang)}</h2>
          <ul className="tonight__grid">
            {picks.map((p) => (
              <li key={p.title.id}>
                <TitleCard title={p.title} wide />
                <p className="tonight__reason" dir="auto">{p.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {phase === 'empty' && <p className="tonight__empty">{pick(UI.nothing, lang)}</p>}
      {canRefine && (
        <nav className="chips chips--wrap" aria-label={pick(UI.refine, lang)}>
          {REFINE.map((r) => (
            <button key={r.en} type="button" className="chip" onClick={() => void refine(pick(r, lang))}>
              {pick(r, lang)}
            </button>
          ))}
        </nav>
      )}
      {(phase === 'results' || phase === 'empty') && (
        <button type="button" className="chip" onClick={restart}>
          {pick(UI.startOver, lang)}
        </button>
      )}
    </div>
  );
}

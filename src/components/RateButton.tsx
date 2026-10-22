import { useState } from 'react';
import type { Title } from '../api/types';
import type { Rating } from '../lib/recommend';
import { useLibrary } from '../state/store';
import { useTitleActions } from '../hooks/useTitleActions';
import { DoubleThumbIcon, ThumbDownIcon, ThumbUpIcon } from './Icons';

const OPTIONS: { value: Rating; label: string; Icon: typeof ThumbUpIcon }[] = [
  { value: 'dislike', label: 'Not for me', Icon: ThumbDownIcon },
  { value: 'like', label: 'I like this', Icon: ThumbUpIcon },
  { value: 'love', label: 'Love this!', Icon: DoubleThumbIcon },
];

/** One thumb that opens into three choices, like Netflix. */
export function RateButton({ title, size = 'md' }: { title: Title; size?: 'sm' | 'md' }) {
  const rating = useLibrary((s) => s.ratings[title.id]);
  const { rate } = useTitleActions();
  const [open, setOpen] = useState(false);
  const Current = OPTIONS.find((o) => o.value === rating)?.Icon ?? ThumbUpIcon;
  return (
    <div
      className={`rate rate--${size} ${open ? 'rate--open' : ''}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        className={`icon-btn icon-btn--round ${rating ? 'is-active' : ''}`}
        aria-label="Rate"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Current size={size === 'sm' ? 18 : 22} />
      </button>
      {open && (
        <div className="rate__menu" role="group" aria-label="Rate this title">
          {OPTIONS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              className={`rate__opt ${rating === value ? 'is-active' : ''}`}
              aria-label={label}
              aria-pressed={rating === value}
              title={label}
              onClick={() => {
                rate(title, value);
                setOpen(false);
              }}
            >
              <Icon size={size === 'sm' ? 18 : 22} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

import type { Title } from '../api/types';
import { TitleCard } from './TitleCard';

export function TitleGrid({ items, label }: { items: Title[]; label?: string }) {
  return (
    <div className="grid" role="list" aria-label={label}>
      {items.map((t) => (
        <div role="listitem" key={t.id} className="grid__cell">
          <TitleCard title={t} wide />
        </div>
      ))}
    </div>
  );
}

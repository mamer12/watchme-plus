import type { Title } from '../api/types';
import { ageLabel } from '../lib/ratings';

export function AgeBadge({ title }: { title: Pick<Title, 'kind' | 'filmRating' | 'seriesRating'> }) {
  const label = ageLabel(title);
  return label ? <span className="badge badge--age">{label}</span> : null;
}

export function HdBadge({ label = 'HD' }: { label?: string }) {
  return <span className="badge badge--hd">{label}</span>;
}

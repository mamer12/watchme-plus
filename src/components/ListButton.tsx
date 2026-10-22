import type { Title } from '../api/types';
import { useLibrary } from '../state/store';
import { useTitleActions } from '../hooks/useTitleActions';
import { CheckIcon, PlusIcon } from './Icons';

export function ListButton({ title, size = 'md', labeled = false }: { title: Title; size?: 'sm' | 'md'; labeled?: boolean }) {
  const inList = useLibrary((s) => s.myList.includes(title.id));
  const { toggleList } = useTitleActions();
  const label = inList ? 'Remove from My List' : 'Add to My List';
  const Icon = inList ? CheckIcon : PlusIcon;
  if (labeled) {
    return (
      <button type="button" className="text-icon-btn" aria-pressed={inList} onClick={() => toggleList(title)}>
        <Icon size={24} />
        <span>My List</span>
      </button>
    );
  }
  return (
    <button type="button" className="icon-btn icon-btn--round" aria-label={label} title={label} aria-pressed={inList} onClick={() => toggleList(title)}>
      <Icon size={size === 'sm' ? 18 : 22} />
    </button>
  );
}

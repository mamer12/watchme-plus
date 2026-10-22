import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { TitleGrid } from '../../components/TitleGrid';
import { fromSnapshot } from '../../state/library';
import { useLibrary } from '../../state/store';

export function MyListPage() {
  const ids = useLibrary((s) => s.myList);
  const snapshots = useLibrary((s) => s.snapshots);
  const items = useMemo(() => ids.map((id) => snapshots[id]).filter((s): s is NonNullable<typeof s> => !!s).map(fromSnapshot), [ids, snapshots]);
  return (
    <div className="page mylist-page">
      <h1 className="page-title">My List</h1>
      {items.length ? (
        <TitleGrid items={items} label="My List" />
      ) : (
        <div className="empty">
          <h2>Your list is empty</h2>
          <p>Add movies and series with the + button to find them here later.</p>
          <Link to="/" className="btn btn--play">
            Browse titles
          </Link>
        </div>
      )}
    </div>
  );
}

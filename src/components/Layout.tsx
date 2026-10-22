import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useOnline } from '../hooks/useOnline';
import { FlameIcon, GearIcon, HomeIcon, ListIcon, SearchIcon, SparkIcon, WifiOffIcon } from './Icons';
import { capabilities } from '../profiles/logic';
import { ProfileMenu } from '../profiles/ProfileMenu';
import { profileStore, useProfiles } from '../profiles/singleton';
import { sparkAskLabel } from '../lib/sparkBrand';
import { useLibrary } from '../state/store';
import { Logo } from './Logo';

const DESKTOP_LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/series', label: 'Series' },
  { to: '/movies', label: 'Movies' },
  { to: '/new', label: 'New & Popular' },
  { to: '/my-list', label: 'My List' },
];

const TABS = [
  { to: '/', label: 'Home', Icon: HomeIcon, end: true },
  { to: '/new', label: 'New & Hot', Icon: FlameIcon },
  { to: '/search', label: 'Search', Icon: SearchIcon },
  { to: '/my-list', label: 'My List', Icon: ListIcon },
  { to: '/settings', label: 'Settings', Icon: GearIcon },
];

function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > threshold);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [threshold]);
  return scrolled;
}

function TopNav() {
  const scrolled = useScrolled();
  const navigate = useNavigate();
  const location = useLocation();
  const onBrowse = ['/', '/series', '/movies'].includes(location.pathname);
  useProfiles();
  const caps = capabilities(profileStore.active());
  const lang = useLibrary((s) => s.settings.titleLang) === 'ar' ? 'ar' : 'en';
  const askLabel = sparkAskLabel(lang);
  const onSpark = location.pathname === '/spark';
  return (
    <header className={`topnav ${scrolled ? 'topnav--solid' : ''}`}>
      <Link to="/" className="topnav__logo" aria-label="Watchme+ home">
        <Logo />
      </Link>
      <nav className="topnav__links" aria-label="Main">
        {DESKTOP_LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className="topnav__link">
            {l.label}
          </NavLink>
        ))}
      </nav>
      <div className="topnav__tools">
        <button
          type="button"
          className={`icon-btn icon-btn--spark ${onSpark ? 'is-active' : ''}`}
          aria-label={askLabel}
          title={askLabel}
          aria-current={onSpark ? 'page' : undefined}
          onClick={() => navigate('/spark')}
        >
          <SparkIcon size={22} />
        </button>
        <button type="button" className="icon-btn" aria-label="Search" onClick={() => navigate('/search')}>
          <SearchIcon size={22} />
        </button>
        {caps.settings && (
          <NavLink to="/settings" className="icon-btn" aria-label="Settings">
            <GearIcon size={22} />
          </NavLink>
        )}
        <ProfileMenu />
      </div>
      {/* Mobile: chips under the bar, like Netflix's category pills. */}
      {onBrowse && (
        <nav className="chips" aria-label="Browse">
          <NavLink to="/series" className="chip">
            Series
          </NavLink>
          <NavLink to="/movies" className="chip">
            Movies
          </NavLink>
          {location.pathname !== '/' && (
            <NavLink to="/" className="chip chip--clear" aria-label="All titles">
              ✕
            </NavLink>
          )}
        </nav>
      )}
    </header>
  );
}

function TabBar() {
  useProfiles();
  const caps = capabilities(profileStore.active());
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.filter((t) => caps.settings || t.to !== '/settings').map(({ to, label, Icon, end }) => (
        <NavLink key={to} to={to} end={end} className="tabbar__tab">
          <Icon size={22} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      <WifiOffIcon size={18} /> You're offline. Showing what was saved; videos need a connection.
    </div>
  );
}

export function Layout() {
  const location = useLocation();
  useEffect(() => {
    const bg = (location.state as { background?: unknown } | null)?.background;
    if (!bg) window.scrollTo(0, 0);
  }, [location.pathname, location.state]);
  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <TopNav />
      <OfflineBanner />
      <main id="main" className="main">
        <Outlet />
      </main>
      <TabBar />
    </div>
  );
}

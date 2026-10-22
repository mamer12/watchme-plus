import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, type Location } from 'react-router-dom';
import { useProviderState } from './api/provider';
import { Layout } from './components/Layout';
import { Spinner } from './components/Skeleton';
import { HomePage } from './features/home/HomePage';
import { MyListPage } from './features/mylist/MyListPage';
import { NewPopularPage } from './features/newpopular/NewPopularPage';
import { Onboarding } from './features/onboarding/Onboarding';
import { SearchPage } from './features/search/SearchPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { TitleModal } from './features/title/TitleModal';
import { capabilities } from './profiles/logic';
import { ProfilePicker } from './profiles/ProfilePicker';
import { profileStore, useProfiles } from './profiles/singleton';
import { installSpatialNav } from './lib/spatialNav';
import { useLibrary } from './state/store';
import { entryPlan } from './sync/accounts';
import { syncEnabled } from './sync/config';
import { JoinPrompt } from './sync/JoinPrompt';
import { useRecovery } from './sync/recovery';
import { useSyncStatus } from './sync/status';
import { GettingProfiles, RecoveryScreen, WelcomeScreen } from './sync/Welcome';
import { SyncToast } from './sync/SyncToast';
import { TvApprovePrompt, useCapturedTvCode } from './sync/TvApprove';

const PlayerPage = lazy(() => import('./features/player/PlayerPage'));
const TonightPage = lazy(() => import('./features/tonight/TonightPage'));

function PlayerFallback() {
  return (
    <div className="player player--message">
      <Spinner label="Loading player" />
    </div>
  );
}

/** First run (or an old answer): a short splash while the best connection is found. It never lasts past SPLASH_MAX_MS. */
function FindingConnection() {
  return (
    <div className="player player--message" role="status">
      <Spinner label="Finding the best connection…" />
      <p>Finding the best connection…</p>
    </div>
  );
}

function AppRoutes() {
  const conn = useProviderState();
  const profiles = useProfiles();
  const location = useLocation();
  const onboarded = useLibrary((s) => s.onboarding.done);
  const background = (location.state as { background?: Location } | null)?.background;

  const sync = useSyncStatus();
  const recovery = useRecovery();
  const plan = entryPlan({ syncEnabled: syncEnabled(), linked: sync.linked, recoveryPending: !!recovery, pickerWanted: !!profiles.picker, pickAfterSignIn: false, liveProfiles: 0 });
  if (plan === 'recovery') return <RecoveryScreen />;
  if (plan === 'welcome') return <WelcomeScreen />;
  if (sync.gettingProfiles) return <GettingProfiles />;
  if (plan === 'picker') return <ProfilePicker />;
  if (conn.phase === 'detecting') return <FindingConnection />;

  if (!onboarded && location.pathname !== '/welcome' && !location.pathname.startsWith('/watch/')) {
    return <Navigate to="/welcome" replace />;
  }

  return (
    <>
      <Routes location={background ?? location}>
        <Route path="/welcome" element={<Onboarding />} />
        <Route
          path="/watch/:id"
          element={
            <Suspense fallback={<PlayerFallback />}>
              <PlayerPage />
            </Suspense>
          }
        />
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="/movies" element={<HomePage kind="movie" key="movie" />} />
          <Route path="/series" element={<HomePage kind="series" key="series" />} />
          <Route path="/new" element={<NewPopularPage />} />
          <Route path="/my-list" element={<MyListPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route
            path="/tonight"
            element={
              <Suspense fallback={<Spinner label="Loading" />}>
                <TonightPage />
              </Suspense>
            }
          />
          <Route path="/settings" element={capabilities(profileStore.active()).settings ? <SettingsPage /> : <Navigate to="/" replace />} />
          {/* Deep link: the modal over an empty home page. */}
          <Route path="/title/:id" element={<HomePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      {(background || location.pathname.startsWith('/title/')) && (
        <Routes>
          <Route path="/title/:id" element={<TitleModal />} />
        </Routes>
      )}
    </>
  );
}

export function App() {
  useEffect(() => installSpatialNav(), []);
  useCapturedTvCode(); // keep a ?tv= code before the first screen renders
  return (
    <BrowserRouter>
      <AppRoutes />
      <JoinPrompt />
      <TvApprovePrompt />
      <SyncToast />
    </BrowserRouter>
  );
}

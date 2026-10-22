import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { isResetRequested, reloadOnUpdate } from './lib/appUpdate';
import { browserResetEnv, resetSite } from './lib/resetSite';
import { providerManager } from './api/provider';
import { startProviderHints } from './lib/hints';
import { startParallelSync } from './lib/parallelPage';
import { captureRecovery } from './sync/recovery';
import { startSync } from './sync/runtime';
import './styles/base.css';
import './styles/layout.css';
import './styles/rows.css';
import './styles/billboard.css';
import './styles/title.css';
import './styles/pages.css';
import './styles/profiles.css';
import './styles/accounts.css';

function start() {
  reloadOnUpdate(
    navigator.serviceWorker,
    (() => {
      try {
        return window.sessionStorage;
      } catch {
        return null;
      }
    })(),
    () => window.location.reload(),
  );
  registerSW({ immediate: true });
  startProviderHints();
  startParallelSync();
  void providerManager().start();
  captureRecovery(window.location.hash);
  startSync();

  const root = document.getElementById('root');
  if (root) {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  }
}

// `?reset=1` / `#reset`: the person typed it, so no confirmation. Wipe everything, then land on the home page.
if (isResetRequested(window.location.search, window.location.hash)) {
  void resetSite(browserResetEnv(() => {}))
    .catch(() => {})
    .finally(() => window.location.replace('/'));
} else {
  start();
}

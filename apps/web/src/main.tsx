import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { queryClient } from './lib/queryClient';
import { hydrateUIAttributes } from './store/ui';
import { ConfirmProvider } from './components/ConfirmDialog';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initNative } from './lib/native';
import { uiFor } from './lib/chambers';
import './styles/tokens.css';
import './styles/globals.css';
import './styles/chambers.css';
// Per-feature-group Chambers styles, loaded last so they win ties.
import './styles/chambers/case.css';
import './styles/chambers/court.css';
import './styles/chambers/clients.css';
import './styles/chambers/ai.css';
import './styles/chambers/firm.css';

hydrateUIAttributes();
document.documentElement.dataset.ui = uiFor(window.location.pathname);
initNative();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/*
          ErrorBoundary sits inside the router/query providers so it can
          catch render-time exceptions from App and the ~50 lazy-loaded
          views it mounts, without masking a failure in the providers
          themselves (which would indicate a more fundamental setup
          problem the fallback UI below isn't designed to diagnose).
        */}
        <ErrorBoundary>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

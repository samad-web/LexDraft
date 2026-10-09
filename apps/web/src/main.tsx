import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { queryClient } from './lib/queryClient';
import { hydrateUIAttributes } from './store/ui';
import { ConfirmProvider } from './components/ConfirmDialog';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/tokens.css';
import './styles/globals.css';

hydrateUIAttributes();

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

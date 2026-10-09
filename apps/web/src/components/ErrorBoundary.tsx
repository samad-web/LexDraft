import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from '@lexdraft/ui';

/**
 * Top-level safety net for uncaught render-time exceptions anywhere in the
 * route tree (any of the ~50 lazy-loaded views). React only supports catching
 * these via componentDidCatch/getDerivedStateFromError, which have no hook
 * equivalent, hence a class component.
 *
 * This is deliberately minimal: no error-reporting pipeline, just a friendly
 * fallback with a reload action so a bug in one view doesn't present as a
 * blank white screen for the whole app.
 */
interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Unhandled render error caught by ErrorBoundary:', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  override render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-9, 36px)',
          }}
        >
          <div style={{ maxWidth: 420, width: '100%' }}>
            <ErrorState
              title="Something went wrong"
              description="An unexpected error interrupted this page. Reloading usually fixes it; if it keeps happening, please let us know."
              retryLabel="Reload"
              onRetry={this.handleReload}
            />
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

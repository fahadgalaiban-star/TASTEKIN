import React from 'react';

export class ErrorBoundary extends React.Component<React.PropsWithChildren, { hasError: boolean }> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Uncaught error in ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="approved-app">
          <main className="approved-shell">
            <span className="approved-kicker">TASTEKIN</span>
            <h1 className="approved-title">Something went wrong</h1>
            <div className="approved-panel">
              <p>Try reloading the page. If the problem persists, contact support.</p>
            </div>
            <button className="approved-button primary wide" onClick={() => window.location.reload()}>Reload</button>
          </main>
        </div>
      );
    }

    return this.props.children;
  }
}

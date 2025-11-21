import React from 'react';

type ErrorBoundaryState = {
  hasError: boolean;
  error?: unknown;
};

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, errorInfo: unknown) {
    // Minimal logging so we can see silent crashes in production
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Caught error', { error, errorInfo });
  }

  private handleReload = () => {
    window.location.assign('/onboarding');
  };

  private handleClearState = () => {
    try {
      localStorage.removeItem('apex-options-store');
    } catch {}
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">
        <div className="max-w-xl w-full border border-white/20 rounded-2xl p-6 bg-charcoal">
          <h2 className="text-2xl font-semibold mb-2">Something went wrong</h2>
          <p className="text-silver mb-4">The UI crashed during navigation. You can try reloading or clearing local state.</p>
          <div className="flex gap-3">
            <button className="btn-primary px-4 py-2" onClick={this.handleReload}>Go to Onboarding</button>
            <button className="btn-secondary px-4 py-2" onClick={this.handleClearState}>Clear Local State</button>
          </div>
          <pre className="mt-4 text-xs text-silver overflow-auto max-h-48">
            {String(this.state.error)}
          </pre>
        </div>
      </div>
    );
  }
}


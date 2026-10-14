import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[CRITICAL] App Render Crash:', error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full bg-zinc-950 text-zinc-100 p-6 flex flex-col justify-center items-center font-sans z-[99999] select-text">
          <div className="max-w-2xl w-full bg-zinc-900 border border-red-500/40 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <svg className="w-8 h-8 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h1 className="text-xl font-bold">Application Error</h1>
                <p className="text-xs text-zinc-400">A component encountered an unhandled exception</p>
              </div>
            </div>

            <div className="bg-black/60 rounded-xl p-4 border border-zinc-800 overflow-x-auto text-xs font-mono text-red-300">
              {this.state.error?.toString()}
            </div>

            {this.state.errorInfo?.componentStack && (
              <details className="text-xs text-zinc-400 cursor-pointer">
                <summary className="font-semibold text-zinc-300 hover:text-white">View Component Stack</summary>
                <pre className="mt-2 p-3 bg-black/40 rounded-lg overflow-x-auto font-mono text-[11px] leading-relaxed text-zinc-500">
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  window.localStorage.removeItem('locus.theme');
                  window.location.reload();
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-md active:scale-95 transition-all"
              >
                Reload Application
              </button>
              <button
                type="button"
                onClick={() => {
                  this.setState({ hasError: false, error: null, errorInfo: null });
                }}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-semibold transition-all"
              >
                Dismiss & Retry
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

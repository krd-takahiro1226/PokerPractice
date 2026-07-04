import { Component, type ReactNode } from 'react';

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback?: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

// クラスコンポーネントである必要がある: componentDidCatch/getDerivedStateFromError は
// 関数コンポーネントでは実装できない。
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack: string }): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="rounded-xl border border-border bg-surface-2/30 p-3 text-xs text-muted">
          <p>表示中にエラーが発生しました</p>
          <button
            onClick={this.handleRetry}
            className="mt-2 rounded-lg border border-border-bright bg-surface-2 px-3 py-1.5 text-xs font-semibold transition hover:bg-surface-2/80"
          >
            再試行
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

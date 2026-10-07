import { Component, type ReactNode } from 'react';
import { Button } from '@/components/Button';

// App-wide error boundary — the one class component (React has no hook
// for this). A render-time throw anywhere below is caught here and shown
// as a recoverable screen instead of a blank page. Async throws don't
// reach here; they surface as the screen's own red line.
type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('render error boundary', error);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-dvh flex-col items-start justify-center gap-3 px-6">
        <div className="section-label text-err">something went wrong</div>
        <div className="text-fg-muted max-w-[440px]">
          the app hit an unexpected error. try again.
        </div>
        {import.meta.env.DEV ? (
          <div className="text-small text-fg-faint max-w-[440px]">{this.state.error.message}</div>
        ) : null}
        <Button onClick={this.reset}>try again</Button>
      </div>
    );
  }
}

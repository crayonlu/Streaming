import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown) {
    // biome-ignore lint/suspicious/noConsole: intentional crash logging in error boundary
    console.error("[ErrorBoundary]", error);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background px-8 text-center">
          <p className="text-xs tracking-widest text-muted-foreground uppercase">⚠ error</p>
          <h2 className="text-base font-medium text-foreground">应用出现意外错误</h2>
          <p className="text-sm text-muted-foreground">请重启应用，若问题持续请反馈。</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted transition-colors"
          >
            尝试恢复
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

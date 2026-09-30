import { Component, type ReactNode } from "react";
import { strings } from "@/shared/i18n";

interface Props {
  children: ReactNode;
  /**
   * When this value changes the boundary resets itself.  Pass the current
   * route pathname so the error clears automatically on navigation.
   */
  resetKey?: string | number;
}

interface State {
  hasError: boolean;
  resetKey: string | number | undefined;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(_: unknown, prevState: State): State {
    return { ...prevState, hasError: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // If the resetKey changed (e.g. route changed), clear the error.
    if (props.resetKey !== state.resetKey) {
      return { hasError: false, resetKey: props.resetKey };
    }
    return null;
  }

  override componentDidCatch(error: unknown) {
    // biome-ignore lint/suspicious/noConsole: intentional crash logging in error boundary
    console.error("[ErrorBoundary]", error);
  }

  override render() {
    if (this.state.hasError) {
      // A class component cannot subscribe to the language store; reading it
      // here is enough because the crash screen is not language-switchable.
      const s = strings();
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background px-8 text-center">
          <p className="text-xs tracking-caps text-muted-foreground uppercase">⚠ error</p>
          <h2 className="text-base font-medium text-foreground">{s.error.title}</h2>
          <p className="text-sm text-muted-foreground">{s.error.description}</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="mt-2 rounded-sm border border-border px-3 py-2 text-xs text-foreground hover:bg-muted-hover transition-colors"
          >
            {s.common.recover}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

import { Component, type ReactNode } from "react";
import { t } from "../lib/i18n";
import { reportClientError } from "../lib/reportError";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    reportClientError({
      kind: "render",
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-full grid place-items-center p-6">
        <div className="card p-8 max-w-lg w-full">
          <div className="text-2xl mb-2">💥</div>
          <h1 className="text-lg font-semibold">{t("err.title")}</h1>
          <p className="text-sm text-neutral-400 mt-2 mb-4">{t("err.description")}</p>
          <pre className="text-xs text-accent bg-bg-elevated p-3 rounded border border-border overflow-auto max-h-40">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => location.reload()}
            className="btn-primary mt-4 w-full"
          >
            {t("err.reload")}
          </button>
        </div>
      </div>
    );
  }
}

import { Component, type ErrorInfo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  getCopilotDiagnosticStage,
  recordCopilotFailure,
} from "../managerCopilotDiagnostics";
import "../styles/managerCopilot.css";

type Props = {
  children: ReactNode;
  onClose: () => void;
  onRetry: () => void;
};

type State = {
  error: {
    stage: string;
    type: string;
    safeMessage: string;
  } | null;
};

export class ManagerCopilotErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return {
      error: {
        stage: getCopilotDiagnosticStage(),
        type: error instanceof Error ? error.name || "RuntimeError" : "RuntimeError",
        safeMessage: "The Copilot interface could not render.",
      },
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const stage = getCopilotDiagnosticStage();
    recordCopilotFailure(
      "Error boundary triggered",
      "The Copilot interface could not render.",
      error,
    );
    if (import.meta.env.DEV) {
      console.error("[ManagerCopilot] render boundary captured an error", error, info);
    }
    this.setState((current) =>
      current.error ? { error: { ...current.error, stage } } : current,
    );
  }

  render() {
    if (!this.state.error) return this.props.children;
    const fallback = (
      <div className="mcp-crash-layer" role="presentation">
        <section
          className="mcp-crash-panel"
          role="alertdialog"
          aria-modal="true"
          aria-label="Copilot display error"
        >
          <h2>Copilot encountered a display error.</h2>
          <p>The Manager workspace is still available. Retry Copilot or close this message.</p>
          {import.meta.env.DEV && (
            <dl>
              <div><dt>Crash stage</dt><dd>{this.state.error.stage}</dd></div>
              <div><dt>Error type</dt><dd>{this.state.error.type}</dd></div>
              <div><dt>Safe error message</dt><dd>{this.state.error.safeMessage}</dd></div>
            </dl>
          )}
          <footer>
            <button type="button" onClick={this.props.onRetry}>Retry</button>
            <button type="button" onClick={this.props.onClose}>Close</button>
          </footer>
        </section>
      </div>
    );
    return typeof document === "undefined" ? fallback : createPortal(fallback, document.body);
  }
}

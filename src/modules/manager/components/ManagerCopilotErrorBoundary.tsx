import { Component, type ErrorInfo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "../styles/managerCopilot.css";

type Props = {
  children: ReactNode;
  onClose: () => void;
  onRetry: () => void;
};

type State = {
  failed: boolean;
};

export class ManagerCopilotErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("[ManagerCopilot] render boundary captured an error", error, info);
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
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

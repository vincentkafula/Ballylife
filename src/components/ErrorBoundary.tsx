import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; label: string }
interface State { error: Error | null }

/**
 * Without this, an uncaught render-time error anywhere in the wrapped
 * subtree unmounts silently (React logs to the console, but the UI just
 * goes blank/unresponsive with no visible clue why) -- exactly the
 * symptom of a click that "does nothing." Shows the actual error message
 * on screen instead, so a real bug is visible rather than silent.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error(`[ErrorBoundary:${this.props.label}]`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "#fff", padding: 24, overflow: "auto", fontFamily: "monospace" }}>
          <h1 style={{ color: "#B91C1C", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
            Something broke in "{this.props.label}"
          </h1>
          <p style={{ color: "#374151", marginBottom: 16 }}>{this.state.error.message}</p>
          <pre style={{ color: "#6B7280", fontSize: 12, whiteSpace: "pre-wrap" }}>{this.state.error.stack}</pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 16, padding: "8px 16px", background: "#128A43", color: "#fff", borderRadius: 8, border: "none", cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

import React from "react";

// Safety net so a single rendering bug shows a recoverable screen instead of
// a blank white page — especially important out on the water where a guide
// can't just go look something up to figure out what happened.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Field Log crashed:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          padding: "24px",
          textAlign: "center",
          backgroundColor: "#12140D",
          color: "#F4F1E8",
          fontFamily: "monospace",
        }}
      >
        <div style={{ fontSize: "14px", letterSpacing: "0.05em", opacity: 0.85 }}>
          SOMETHING WENT WRONG
        </div>
        <div style={{ fontSize: "12px", opacity: 0.65, maxWidth: "320px" }}>
          Field Log hit an unexpected error. Your saved and queued catches are still on your
          phone — they weren't lost. Reloading usually fixes this.
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: "8px",
            padding: "10px 20px",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.2)",
            background: "#B5482A",
            color: "#F4F1E8",
            fontFamily: "monospace",
            fontSize: "12px",
            fontWeight: 600,
            letterSpacing: "0.05em",
          }}
        >
          RELOAD
        </button>
      </div>
    );
  }
}

"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#141013", color: "#F3ECEE", fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <div style={{ maxWidth: 480, margin: "15vh auto", padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>Katha hit a snag</h1>
          <p style={{ color: "#A99BA0", marginBottom: 20 }}>Something went wrong while loading the page.</p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: "#F05A72",
              color: "#1A0D11",
              border: 0,
              borderRadius: 999,
              padding: "10px 20px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

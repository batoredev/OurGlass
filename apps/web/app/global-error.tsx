"use client";

/**
 * The last resort: the ROOT LAYOUT itself failed, so there is no shell and no
 * stylesheet to lean on. It must render its own <html> and <body> (Next's
 * contract for this file) and inline the little styling it needs.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: "3rem auto", maxWidth: "36rem", padding: "0 1rem" }}>
        <h1>OurGlass couldn&apos;t start</h1>
        <p>Something went wrong on our side. Nothing you&apos;ve told the assistant was changed.</p>
        <button type="button" onClick={reset}>
          Try again
        </button>
        {error.digest ? <p style={{ color: "#666" }}>Reference: {error.digest}</p> : null}
      </body>
    </html>
  );
}

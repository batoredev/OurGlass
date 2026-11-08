"use client";

/**
 * Sign in with the deployment's access token (PHASE-7-PERMISSIONS-DESIGN §8).
 *
 * The token is checked once against /api/session, then kept in this browser
 * (lib/session.ts) and sent as `Authorization: Bearer` with every API call —
 * the API is on another origin, where a session cookie would not be sent.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Landscape } from "../landscape";
import { apiFetch, setToken as saveToken } from "../../lib/session";

export default function LoginPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (response.ok) {
        saveToken(token);
        setToken("");
        router.push("/");
        return;
      }
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? `Sign-in failed (${response.status}).`);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="login-hero landscape-panel">
      <Landscape className="landscape-art" />
      <div className="login-top">
        <span className="wordmark">
          ourglass<span className="wordmark-dot" aria-hidden="true">.</span>
        </span>
      </div>
      <div className="login-body">
        <div className="eyebrow">Your personal assistant</div>
        <h1>
          Know your day.
          <br />
          Know your people.
        </h1>
        <p className="login-lede">
          Commitments, meetings and the people behind them — remembered and kept in order, so you
          don&apos;t have to.
        </p>
        <form className="login-form" onSubmit={submit}>
          <label className="sr-only" htmlFor="access-token">
            Access token
          </label>
          <input
            id="access-token"
            type="password"
            autoComplete="current-password"
            placeholder="Access token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <button className="hero-pill" type="submit" disabled={busy || token === ""}>
            {busy ? "Signing in…" : "Sign in"} <span aria-hidden="true">↗</span>
          </button>
        </form>
        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="hero-meta login-meta">
        <span>Private to you</span>
        <span>Every email waits for your yes</span>
      </div>
    </section>
  );
}

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
import { Page } from "../ui";
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
    <Page title="Sign in">
      <form onSubmit={submit} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <label>
          Access token{" "}
          <input
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            style={{ width: "22rem" }}
          />
        </label>
        <button type="submit" disabled={busy || token === ""}>
          Sign in
        </button>
      </form>
      {error && <p style={{ color: "#b00" }}>{error}</p>}
    </Page>
  );
}

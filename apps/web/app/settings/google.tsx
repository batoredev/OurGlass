"use client";

/**
 * Google Calendar on the Settings page: connected or not, and the way to
 * change that. After Google's consent screen the browser comes back here with
 * ?google=<result> (apps/edge/app/api/google/callback), shown once.
 */
import { useEffect, useState } from "react";
import { fetchGoogleStatus, type GoogleStatus } from "../../lib/api";
import { connectGoogle, disconnectGoogle } from "../../lib/control";

const RESULT: Readonly<Record<string, string>> = {
  connected: "Google Calendar is connected. New meetings will be added to it.",
  denied: "Connecting was cancelled at Google.",
  expired: "That connect link expired — press Connect again.",
  not_configured: "Google Calendar isn't set up on the server yet.",
  error: "Google didn't complete the connection. Try again; if it repeats, reconnect from scratch.",
};

export function GoogleCalendarSetting() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    const result = new URLSearchParams(window.location.search).get("google");
    fetchGoogleStatus()
      .then((value) => {
        if (!live) return;
        setStatus(value);
        if (result) setMessage(RESULT[result] ?? null);
      })
      .catch((error: unknown) => {
        if (live) setMessage(error instanceof Error ? error.message : String(error));
      });
    if (result) window.history.replaceState(null, "", window.location.pathname);
    return () => {
      live = false;
    };
  }, []);

  async function connect() {
    setBusy(true);
    const result = await connectGoogle();
    if (!result.ok) {
      setMessage(result.message);
      setBusy(false);
    }
    // On success the browser is already leaving for Google.
  }

  async function disconnect() {
    setBusy(true);
    const result = await disconnectGoogle();
    setBusy(false);
    if (result.ok) {
      setStatus((current) => (current ? { ...current, connected: false, email: null } : current));
      setMessage("Disconnected. Meetings will stay in OurGlass only.");
    } else {
      setMessage(result.message);
    }
  }

  return (
    <section className="section">
      <h2 className="section-title">Google Calendar</h2>
      <div className="rule-list">
        <div className="row">
          <div>
            <div className="row-title">
              {status === null ? "Checking…" : status.connected ? "Connected" : "Not connected"}
            </div>
            <div className="row-subtitle">
              {status?.connected
                ? `Meetings you schedule are added to ${status.email ?? "your Google Calendar"} after you approve them (or straight away, if you allow it below).`
                : status && !status.configured
                  ? "The server needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI first."
                  : "Connect to have meetings you schedule here appear in your Google Calendar too."}
            </div>
          </div>
          {status?.connected ? (
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void disconnect()}>
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              disabled={busy || !status?.configured}
              onClick={() => void connect()}
            >
              Connect
            </button>
          )}
        </div>
      </div>
      {message && (
        <p className="setting-sub" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

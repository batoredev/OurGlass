"use client";

/**
 * Google Calendar on the Settings page: connected or not, and the way to
 * change that. After Google's consent screen the browser comes back here with
 * ?google=<result> (apps/edge/app/api/google/callback), shown once.
 */
import { useEffect, useState } from "react";
import { fetchGoogleStatus, fetchPermissions, type GoogleStatus } from "../../lib/api";
import { connectGoogle, disconnectGoogle, revokePermission, setPermission } from "../../lib/control";
import { refreshData } from "../../lib/session";

/** The tool that copies a meeting to Google; its grant is the "without asking" switch. */
const CALENDAR_ACTION = "add_to_google_calendar";

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
  // Whether meetings go to Google without a confirmation step — the standing
  // "allow" grant for CALENDAR_ACTION, shown here in plain words because the
  // generic Standing rules list names raw tools, and the wrong one got picked.
  const [autoAdd, setAutoAdd] = useState<boolean | null>(null);

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
    fetchPermissions()
      .then((permissions) => {
        if (live) setAutoAdd(permissions.grants.some((g) => g.action_type === CALENDAR_ACTION && g.decision === "allow"));
      })
      .catch(() => undefined);
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

  async function toggleAutoAdd(next: boolean) {
    setBusy(true);
    const result = next ? await setPermission(CALENDAR_ACTION, "allow") : await revokePermission(CALENDAR_ACTION);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setAutoAdd(next);
    setMessage(next ? "Meetings will now go straight to Google Calendar." : "Meetings will wait for your approval before going to Google.");
    // The Standing rules list on this page shows the same grant.
    refreshData();
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
        {status?.connected && autoAdd !== null && (
          <label className="row setting-toggle">
            <div>
              <div className="row-title">Add meetings without asking</div>
              <div className="row-subtitle">
                {autoAdd
                  ? "On: \"schedule a meeting…\" goes straight to Google Calendar."
                  : "Off: each meeting waits for your approval above before it reaches Google."}
              </div>
            </div>
            <input
              type="checkbox"
              className="toggle-input"
              checked={autoAdd}
              disabled={busy}
              onChange={(event) => void toggleAutoAdd(event.target.checked)}
            />
          </label>
        )}
      </div>
      {message && (
        <p className="setting-sub" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

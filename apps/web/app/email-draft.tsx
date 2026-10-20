"use client";

/**
 * An email draft in the chat: read it, change anything, press Send.
 *
 * send_email is HIGH_IMPACT — an email cannot be unsent — so the assistant
 * never sends one on its own. This card IS the confirmation: Send releases
 * the held action with whatever the user edited; Cancel declines it. A
 * person OurGlass has no address for gets an empty To field, and the address
 * typed here is remembered for next time.
 */
import { useState } from "react";
import type { EmailDraft } from "../lib/api";
import { cancelDraft, sendDraft } from "../lib/control";
import { Icon } from "./icons";

export function EmailDraftCard({ draft, onDone }: { draft: EmailDraft; onDone: (message: string) => void }) {
  const [to, setTo] = useState(draft.to);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = draft.pendingActionId;

  async function send() {
    setBusy(true);
    setError(null);
    const result = await sendDraft(id, { to, subject, body });
    setBusy(false);
    if (result.ok) onDone(`Sent to ${draft.toName} (${to.trim()}).`);
    else setError(result.message);
  }

  async function cancel() {
    setBusy(true);
    const result = await cancelDraft(id);
    setBusy(false);
    if (result.ok) onDone("Draft discarded — nothing was sent.");
    else setError(result.message);
  }

  return (
    <form
      className="context-card email-card"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <div className="context-card-head">
        <div className="context-card-title">
          <Icon name="send" />
          <span>Email to {draft.toName}</span>
        </div>
        <span className="email-card-note">Not sent yet</span>
      </div>
      <div className="context-card-body email-card-body">
        <label className="email-field">
          <span>To</span>
          <input
            type="email"
            required
            placeholder={`${draft.toName}'s email address`}
            value={to}
            onChange={(event) => setTo(event.target.value)}
            disabled={busy}
          />
        </label>
        <label className="email-field">
          <span>Subject</span>
          <input value={subject} onChange={(event) => setSubject(event.target.value)} disabled={busy} required />
        </label>
        <label className="email-field email-field-body">
          <span>Message</span>
          <textarea rows={7} value={body} onChange={(event) => setBody(event.target.value)} disabled={busy} required />
        </label>
        {error && (
          <p className="email-card-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="context-card-actions">
        <button type="submit" className="card-action" disabled={busy || to.trim() === ""}>
          {busy ? "Sending…" : "Send"}
        </button>
        <button type="button" className="card-action" disabled={busy} onClick={() => void cancel()}>
          Cancel
        </button>
      </div>
    </form>
  );
}

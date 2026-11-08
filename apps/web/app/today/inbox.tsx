"use client";

/**
 * Today → Emails to check (ROADMAP Stage 1c): who is waiting on a reply, and what looks
 * suspicious — decided by code from headers and the people you know.
 *
 * Everything shown from an email is QUOTED DATA (sender, subject, Gmail's own
 * snippet); nothing here reaches a model, and nothing here acts. Hidden until
 * Google is connected with read-only Gmail; says how when it is not.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchInbox, type Inbox, type InboxMessage } from "../../lib/api";

function Row({ message }: { message: InboxMessage }) {
  return (
    <li className="inbox-item">
      <span className="inbox-from">{message.personName ?? (message.fromName || message.fromAddress)}</span>
      <span className="inbox-subject">&ldquo;{message.subject}&rdquo;</span>
      {message.snippet ? <span className="inbox-snippet">&ldquo;{message.snippet}&rdquo;</span> : null}
      {message.warnings.map((warning) => (
        <span className="inbox-warning" key={warning}>
          ⚠ {warning}
        </span>
      ))}
    </li>
  );
}

export function InboxSection() {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  useEffect(() => {
    fetchInbox().then(setInbox, () => setInbox(null));
  }, []);
  if (!inbox || inbox.state === "not_configured" || inbox.state === "not_connected") return null;

  if (inbox.state !== "ok") {
    return (
      <section className="section" aria-labelledby="inbox-title">
        <h2 className="section-title" id="inbox-title">
          Emails to check
        </h2>
        <p className="profile-empty">
          {inbox.state === "needs_read_permission" ? (
            <>
              To see who is waiting on a reply, <Link href="/settings">reconnect Google</Link> and allow reading Gmail.
            </>
          ) : (
            "Gmail couldn't be read just now."
          )}
        </p>
      </section>
    );
  }

  const waiting = inbox.messages.filter((message) => message.needsReply);
  const suspicious = inbox.messages.filter((message) => message.warnings.length > 0);
  if (waiting.length === 0 && suspicious.length === 0) return null;
  return (
    <section className="section" aria-labelledby="inbox-title">
      <h2 className="section-title" id="inbox-title">
        Inbox
      </h2>
      {waiting.length > 0 ? (
        <>
          <h3 className="profile-subtitle">Waiting for your reply</h3>
          <ul className="inbox-list">
            {waiting.map((message) => (
              <Row key={message.id} message={message} />
            ))}
          </ul>
        </>
      ) : null}
      {suspicious.length > 0 ? (
        <>
          <h3 className="profile-subtitle">Looks suspicious — check before you act</h3>
          <ul className="inbox-list">
            {suspicious.map((message) => (
              <Row key={message.id} message={message} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

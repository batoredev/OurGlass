"use client";

/**
 * A follow-up about what is open between you, in your own greeting and
 * sign-off (ROADMAP Stage 4). A SUGGESTION: copy it, change it, or ask in the
 * chat ("email Barkha: …") — nothing is sent from here.
 */
import { useState } from "react";

export function FollowUp({ text, name, styleFrom }: { text: string; name: string; styleFrom: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="section" aria-labelledby="follow-up-title">
      <h2 className="section-title" id="follow-up-title">
        A follow-up to {name}
      </h2>
      <p className="profile-empty">
        {styleFrom > 0
          ? `In your own greeting and sign-off, learned from ${styleFrom} email${styleFrom === 1 ? "" : "s"} you sent.`
          : "You haven't sent an email from OurGlass yet, so this uses a plain greeting."}{" "}
        Nothing is sent from here.
      </p>
      <pre className="follow-up-text">{text}</pre>
      <button
        type="button"
        className="secondary-button"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </section>
  );
}

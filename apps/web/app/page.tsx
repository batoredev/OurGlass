/**
 * The home surface.
 *
 * §29 calls the conversation view the primary surface, and it is NOT built
 * here — deliberately. A chat UI is a real interactive feature (streaming,
 * optimistic turns, error recovery), and Phase 5's job is inspection: making
 * state visible so the assistant's behaviour can be checked. The demo
 * endpoint (Phase 3 §9) is the conversational surface until then, and this
 * page says so rather than presenting an empty box that looks broken.
 */
import Link from "next/link";
import { Page } from "./ui";

export default function HomePage() {
  return (
    <Page title="OurGlass">
      <p style={{ marginBottom: "1rem" }}>
        Inspection surfaces for the Batore Personal Assistant. Everything here is{" "}
        <strong>read-only</strong> — you change state by talking to the assistant, which routes
        every mutation through the validated tool layer so it lands in the activity log and can be
        undone.
      </p>

      <p style={{ marginBottom: "1rem", color: "#666", fontSize: "0.9rem" }}>
        Sign in at <Link href="/login">/login</Link> with the deployment&apos;s access token. The
        conversation view lands in a later phase; until then, talk to the assistant through the
        API with the same token:
      </p>

      <pre
        style={{
          background: "#f6f6f6",
          padding: "0.75rem",
          fontSize: "0.8rem",
          overflowX: "auto",
        }}
      >
        {`curl -s localhost:3000/api/turn \\
  -H "authorization: Bearer $OURGLASS_ACCESS_TOKEN" \\
  -H 'content-type: application/json' \\
  -d '{"utterance":"track my gym sessions with a date and a duration"}'`}
      </pre>

      <p style={{ color: "#666", fontSize: "0.85rem" }}>
        Then open <Link href="/types">Types</Link> — the new type is there, with no deploy.
      </p>
    </Page>
  );
}

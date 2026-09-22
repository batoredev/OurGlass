"use client";

/**
 * A page that failed to render — Track P2 of docs/REMAINING-EXECUTION-PLAN.md.
 *
 * Without this, a server error showed Next's default page: framework detail
 * for anyone curious, nothing useful for the user. The shell (nav, sidebar)
 * stays, because this boundary sits inside the root layout.
 *
 * The raw message is NOT shown. In production Next already replaces server
 * error messages with a generic one; a client-side error's message can carry
 * internals. The digest is the reference that ties this screen to the server
 * log line, which is what anyone debugging it actually needs.
 */
import { Page } from "./ui";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Page title="This page couldn't load">
      <p>
        Something went wrong on our side while showing this page. Loading a page never changes
        anything you&apos;ve told the assistant.
      </p>
      <p>
        <button type="button" onClick={reset}>
          Try again
        </button>
      </p>
      {error.digest ? <p style={{ color: "#666" }}>Reference: {error.digest}</p> : null}
    </Page>
  );
}

"use client";

/**
 * "Delete permanently" for one person or one file — ROADMAP Stage 0.
 *
 * Two steps on the page itself: the first click says what will go and that
 * it cannot be undone (unlike Undo, which only hides); the second deletes.
 * The request carries the confirmation word the API requires
 * (apps/edge/app/api/data/delete/route.ts).
 */
import { useState } from "react";
import { apiFetch, refreshData } from "../lib/session";

export function DeletePermanently({
  scope,
  id,
  name,
  consequence,
}: {
  readonly scope: "person" | "document";
  readonly id: string;
  readonly name: string;
  /** What else goes with it, in one sentence. */
  readonly consequence: string;
}) {
  const [stage, setStage] = useState<"idle" | "asking" | "busy">("idle");
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setStage("busy");
    setError(null);
    try {
      const response = await apiFetch("/api/data/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope, id, confirm: "delete" }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Nothing was deleted (${response.status}).`);
        setStage("asking");
        return;
      }
      refreshData();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStage("asking");
    }
  }

  if (stage === "idle") {
    return (
      <button type="button" className="link-button delete-link" onClick={() => setStage("asking")}>
        Delete permanently
      </button>
    );
  }
  return (
    <div className="delete-confirm" role="group" aria-label={`Delete ${name} permanently`}>
      <p>
        Delete <strong>{name}</strong> for good? {consequence} This can&rsquo;t be undone.
      </p>
      <div className="delete-confirm-actions">
        <button type="button" className="danger-button" disabled={stage === "busy"} onClick={() => void remove()}>
          {stage === "busy" ? "Deleting…" : "Delete"}
        </button>
        <button type="button" className="secondary-button" disabled={stage === "busy"} onClick={() => setStage("idle")}>
          Keep
        </button>
      </div>
      {error ? (
        <p className="delete-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

"use client";

/**
 * Settings → Your data: export everything, or delete everything (ROADMAP Stage 0).
 *
 * Export downloads one JSON file of every table. Delete everything asks for
 * the words "delete everything" to be typed — the same words the API
 * requires — because it cannot be undone. Your account and settings stay.
 */
import { useState } from "react";
import { apiFetch, refreshData } from "../../lib/session";

const PHRASE = "delete everything";

export function YourData() {
  const [exportState, setExportState] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function download() {
    setExportState("Preparing…");
    try {
      const response = await apiFetch("/api/data/export");
      if (!response.ok) {
        setExportState(`Could not export (${response.status}).`);
        return;
      }
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "ourglass-export.json";
      const url = URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: "application/octet-stream" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setExportState(null);
    } catch (caught: unknown) {
      setExportState(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function deleteEverything() {
    setBusy(true);
    setResult(null);
    try {
      const response = await apiFetch("/api/data/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "everything", confirm: PHRASE }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; files?: number };
      if (!response.ok) {
        setResult(body.error ?? `Nothing was deleted (${response.status}).`);
        return;
      }
      setTyped("");
      setResult(`Everything was deleted${body.files ? `, including ${body.files} file${body.files === 1 ? "" : "s"}` : ""}.`);
      refreshData();
    } catch (caught: unknown) {
      setResult(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section" aria-labelledby="your-data-title">
      <h2 className="section-title" id="your-data-title">
        Your data
      </h2>
      <div className="rule-list">
        <div className="row">
          <div>
            <div className="row-title">Export everything</div>
            <div className="row-subtitle">
              One JSON file: every person, commitment, memory, message and file&rsquo;s text, including
              what you undid. Uploaded files themselves stay on the Files page.
            </div>
            {exportState ? <p className="row-subtitle" role="status">{exportState}</p> : null}
          </div>
          <button type="button" className="secondary-button" onClick={() => void download()}>
            Export
          </button>
        </div>
        <div className="row delete-everything">
          <div>
            <div className="row-title">Delete everything</div>
            <div className="row-subtitle">
              Removes every person, commitment, memory, message and file for good — not like Undo, which
              only hides. Your sign-in and your rules here stay. To delete one person or one file, use
              their page.
            </div>
            <label className="delete-phrase">
              <span>
                Type <strong>{PHRASE}</strong> to confirm
              </span>
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            {result ? <p className="row-subtitle" role="status">{result}</p> : null}
          </div>
          <button
            type="button"
            className="danger-button"
            disabled={busy || typed.trim().toLowerCase() !== PHRASE}
            onClick={() => void deleteEverything()}
          >
            {busy ? "Deleting…" : "Delete everything"}
          </button>
        </div>
      </div>
    </section>
  );
}

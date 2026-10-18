"use client";

/**
 * Downloads an uploaded file — never opens it.
 *
 * The file route needs the access token, which a plain `<a href>` cannot
 * carry, so the bytes are fetched with it and handed to the browser as a
 * download. The blob is typed `application/octet-stream` on purpose: an
 * uploaded HTML or SVG file opened from a blob: URL would run as THIS site,
 * with the access token in reach. The API's sandbox CSP protected the old
 * inline view; on a static site, downloading is what keeps that guarantee.
 */
import { useState } from "react";
import { apiFetch } from "../../lib/session";

export function DownloadLink({ id, filename }: { id: string; filename: string }) {
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setError(null);
    try {
      const response = await apiFetch(`/api/documents/${encodeURIComponent(id)}/file`);
      if (!response.ok) {
        setError(`Could not download (${response.status}).`);
        return;
      }
      const bytes = await response.arrayBuffer();
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <>
      <button type="button" className="link-button" onClick={() => void download()}>
        {filename}
      </button>
      {error ? <span style={{ color: "#b00", marginLeft: "0.5rem" }}>{error}</span> : null}
    </>
  );
}

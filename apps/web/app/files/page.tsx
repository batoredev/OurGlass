/**
 * Files — what was sent, what it says, what it belongs to (spec §32, §33).
 *
 * An INSPECTION surface, like Memory: the description is the Read stage's,
 * shown as quoted data, and nothing here writes. Acting on a file is done in
 * conversation, in the user's own words (docs/PHASE-6-DESIGN.md §1).
 */
import { fetchDocuments, type SavedDocument } from "../../lib/api";
import { EmptyState, LoadFailure, PageHeader } from "../surface";

export const dynamic = "force-dynamic";

/** read_failure codes (ingest/reply.ts UnreadReason), as a short label. */
const UNREAD: Readonly<Record<string, string>> = {
  no_model: "Not read — no AI model is set up",
  no_image_model: "Not read — no image-reading model is set up",
  model_failed: "Not read — the AI models didn't answer",
  no_text: "No text in it (a scan?)",
  password_protected: "Password-protected",
  damaged: "Looks damaged",
  too_large: "Too large to read",
  image_too_large: "Image over 7 MB — not read",
};

const KIND_LABEL: Readonly<Record<SavedDocument["kind"], string>> = {
  pdf: "PDF",
  docx: "Word",
  xlsx: "Excel",
  text: "Text",
  image: "Image",
};

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Mentions({ doc }: { doc: SavedDocument }) {
  const reading = doc.reading;
  if (!reading) return null;
  const items = [
    ...reading.deadlines.map((deadline) => `${deadline.what} — due ${deadline.when}`),
    ...reading.events.map((event) => [event.name, event.when, event.venue].filter(Boolean).join(" · ")),
  ];
  if (items.length === 0) return null;
  return (
    <ul className="file-mentions">
      {items.map((item, index) => (
        <li key={`${doc.id}-mention-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

export default async function FilesPage() {
  let docs: readonly SavedDocument[];
  try {
    docs = await fetchDocuments();
  } catch (error: unknown) {
    return (
      <section className="page">
        <PageHeader title="Files" />
        <LoadFailure error={error} />
      </section>
    );
  }

  return (
    <section className="page">
      <PageHeader
        title="Files"
        subtitle="What you've sent, what it says, and who it belongs to."
        eyebrow="Files"
      />
      <div className="rule-list">
        {docs.length === 0 ? (
          <EmptyState
            title="No files yet"
            body="Attach a PDF, Word or Excel file, a text file or an image in the conversation."
          />
        ) : (
          docs.map((doc) => (
            <div className="row memory-row" key={doc.id}>
              <div>
                <div className="memory-text">
                  <a href={`/api/documents/${doc.id}/file`}>{doc.filename}</a>
                  {doc.reading?.title ? ` — ${doc.reading.title}` : ""}
                </div>
                {doc.reading?.summary ? <p className="file-summary">{doc.reading.summary}</p> : null}
                <Mentions doc={doc} />
                <div className="memory-tags">
                  <span className="meta-tag">{KIND_LABEL[doc.kind]}</span>
                  <span className="meta-tag">{size(doc.byte_size)}</span>
                  {doc.read_failure ? <span className="meta-tag">{UNREAD[doc.read_failure] ?? "Not read"}</span> : null}
                  {doc.text_truncated ? <span className="meta-tag">Read in part</span> : null}
                  {doc.links.map((link) => (
                    <span className="meta-tag" key={`${doc.id}-${link.kind}-${link.id}`}>
                      {link.name}
                    </span>
                  ))}
                </div>
              </div>
              <div className="memory-date">
                {new Date(doc.t_created).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

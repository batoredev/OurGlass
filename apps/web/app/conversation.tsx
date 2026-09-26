"use client";

/**
 * The conversation — §29's primary surface, and the first one this app has had.
 *
 * ┌─ WHAT IT SHOWS, AND WHY THAT MATTERS ──────────────────────────────────┐
 * │ The reply is the assistant's own words. Everything else on screen is    │
 * │ read back from what the TURN returned: which tools committed, what it   │
 * │ asked, and whether the deterministic template wrote the reply. None of  │
 * │ it is inferred from the prose — a UI that guesses "looks like it saved  │
 * │ something" would be lying on the one surface the user has for catching  │
 * │ mistakes (§28).                                                         │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MAX_UPLOAD_BYTES } from "@ourglass/shared";
import { Icon } from "./icons";
import { useDictation } from "./use-dictation";

/** What /api/documents returns for an upload — IngestResponse in @ourglass/api/ingest. */
interface UploadResult {
  readonly outcome: "saved" | "unread" | "duplicate" | "rejected" | "failed";
  readonly documentId: string | null;
  readonly turnId: string | null;
  readonly reply: string;
}

/**
 * What the picker offers. A HINT for the dialog only — the server decides
 * from the bytes (ingest/sniff.ts), whatever the extension says.
 */
const ACCEPTED_FILES = ".pdf,.docx,.xlsx,.txt,.md,.csv,image/png,image/jpeg,image/webp,image/gif";

/** The user's line for an upload — the same text the server stores, so a reload looks identical. */
function uploadLine(note: string, filename: string): string {
  return note === "" ? `📎 ${filename}` : `${note}\n📎 ${filename}`;
}

interface StoredMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly body: string;
  readonly degraded: boolean | null;
  readonly turn_id: string | null;
}

/** What /api/turn returns — TurnResponse in @ourglass/api/assistant. */
interface TurnResult {
  readonly turnId: string | null;
  readonly reply: string;
  readonly asked: readonly string[];
  readonly committed: readonly string[];
  readonly degraded: boolean;
}

interface Entry {
  readonly key: string;
  readonly role: "user" | "assistant";
  readonly body: string;
  readonly degraded?: boolean;
  readonly turnId?: string | null;
  readonly committed?: readonly string[];
  readonly asked?: readonly string[];
}

/** `create_commitment` -> "Create commitment". The tool layer's vocabulary, in words. */
function toolLabel(name: string): string {
  const spaced = name.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning.";
  if (hour < 17) return "Good afternoon.";
  return "Good evening.";
}

/**
 * The current time AS THE READER SEES IT — null while rendering on the server.
 *
 * The date and the greeting are facts about where the person is sitting: their
 * locale orders "18 September" differently from the server's, and their
 * timezone decides whether it is evening. Rendering either on the server makes
 * it guess, React finds two different strings, and the tree is thrown away
 * (hydration mismatch — reported from a real browser).
 *
 * `useSyncExternalStore` is React's own answer for a value that exists only on
 * the client: it renders the server snapshot (null), then the client snapshot,
 * with no state written from an effect. The snapshot is cached because the hook
 * demands a STABLE reference — a fresh `new Date()` per call would re-render
 * forever.
 */
let readerNow: Date | null = null;
const subscribeToNothing = () => () => undefined;
const clientNow = (): Date => (readerNow ??= new Date());
const serverNow = (): null => null;

function useReaderNow(): Date | null {
  return useSyncExternalStore(subscribeToNothing, clientNow, serverNow);
}

export function Conversation() {
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // A file waiting to go with the next send; the typed words become its note.
  const [attachment, setAttachment] = useState<File | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Speech fills the composer; it never sends (Stage 15's scope). The
  // transcript is APPENDED, so dictating after typing keeps both.
  const dictation = useDictation({
    onTranscript: (append) => setDraft(append),
    onError: setNotice,
  });

  // THE READER'S CLOCK, NOT THE SERVER'S. See `useReaderNow` below.
  const now = useReaderNow();

  // History first, so a reload does not look like amnesia.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/messages", { cache: "no-store" });
        if (response.status === 401) {
          setNotice("Not signed in. Open /login with the deployment's access token.");
          return;
        }
        if (!response.ok) {
          setNotice(`Could not load the conversation (${response.status}).`);
          return;
        }
        const body = (await response.json()) as { messages: StoredMessage[] };
        if (cancelled) return;
        setEntries(
          body.messages.map((message) => ({
            key: message.id,
            role: message.role,
            body: message.body,
            degraded: message.degraded ?? false,
            turnId: message.turn_id,
          })),
        );
      } catch (error: unknown) {
        if (!cancelled) setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const stream = streamRef.current;
    if (stream) stream.scrollTop = stream.scrollHeight;
  }, [entries, busy]);

  const send = useCallback(async () => {
    const utterance = draft.trim();
    const file = attachment;
    if ((utterance === "" && file === null) || busy) return;
    // Checked here only to save a pointless upload; the server enforces it.
    if (file !== null && file.size > MAX_UPLOAD_BYTES) {
      setNotice("That file is over 10 MB — too large to send.");
      return;
    }

    setDraft("");
    setAttachment(null);
    setNotice(null);
    // A turn is on its way; anything said now belongs to the NEXT one, and a
    // microphone left open after sending is its own kind of surprise.
    dictation.stop();
    setBusy(true);
    const stamp = `local-${Date.now()}`;
    const line = file === null ? utterance : uploadLine(utterance, file.name);
    setEntries((current) => [...current, { key: stamp, role: "user", body: line }]);

    try {
      // A file goes to the upload pipeline, never to /api/turn: its words
      // must not reach Interpret (docs/PHASE-6-DESIGN.md §1). The typed text
      // travels with it as a NOTE, used to link it to people and projects.
      let response: Response;
      if (file !== null) {
        const form = new FormData();
        form.append("file", file);
        if (utterance !== "") form.append("note", utterance);
        response = await fetch("/api/documents", { method: "POST", body: form });
      } else {
        response = await fetch("/api/turn", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ utterance }),
        });
      }

      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as { error?: string } | null;
        setNotice(failure?.error ?? `That didn't go through (${response.status}).`);
        return;
      }

      if (file !== null) {
        const result = (await response.json()) as UploadResult;
        setEntries((current) => [
          ...current,
          {
            key: `${stamp}-reply`,
            role: "assistant",
            body: result.reply,
            // An upload reply is a template BY DESIGN, so the "template" hint
            // would be noise; an undoable save shows its card like a turn.
            turnId: result.turnId,
            committed: result.turnId ? ["save_document"] : [],
          },
        ]);
        return;
      }

      const result = (await response.json()) as TurnResult;
      setEntries((current) => [
        ...current,
        {
          key: `${stamp}-reply`,
          role: "assistant",
          body: result.reply,
          degraded: result.degraded,
          turnId: result.turnId,
          committed: result.committed,
          asked: result.asked,
        },
      ]);
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [draft, attachment, busy, dictation]);

  const undo = useCallback(async (turnId: string) => {
    setNotice(null);
    const response = await fetch("/api/undo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnId }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    setNotice(response.ok ? "That turn was undone." : (body?.error ?? "Could not undo that turn."));
    if (response.ok) {
      setEntries((current) =>
        current.map((entry) =>
          entry.turnId === turnId ? { ...entry, committed: [], turnId: null } : entry,
        ),
      );
    }
  }, []);

  const empty = loaded && entries.length === 0;

  return (
    <section className="chat-page">
      <header className="chat-head">
        <div>
          <h1>OurGlass</h1>
          <div className="date">
            {now
              ? now.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })
              : ""}
          </div>
        </div>
      </header>

      {/* A live LOG, so a screen reader hears "Thinking…" and then the reply.
          Off until history has loaded, or the whole past conversation would be
          read out as if it had just arrived. */}
      <div
        className="conversation"
        id="conversation"
        ref={streamRef}
        role="log"
        aria-label="Conversation"
        aria-live={loaded ? "polite" : "off"}
      >
        {empty && (
          <div className="greeting">
            <div>
              <div className="hello-kicker">Your world, in context</div>
              <h2>{now ? greeting(now) : "Hello."}</h2>
              <p>Tell me what is happening.</p>
            </div>
            <div className="chat-illustration" aria-hidden="true">
              <span className="sun-disc" />
              <span className="time-arch" />
              <span className="memory-dot one" />
              <span className="memory-dot two" />
              <span className="memory-dot three" />
            </div>
          </div>
        )}

        {entries.map((entry) =>
          entry.role === "user" ? (
            <div className="message-group" key={entry.key}>
              <div className="message user">{entry.body}</div>
            </div>
          ) : (
            <div className="message-group" key={entry.key}>
              <div className="message-label">OurGlass</div>
              <div className="message assistant">{entry.body}</div>

              {entry.committed && entry.committed.length > 0 && (
                <div className="context-card">
                  <div className="context-card-head">
                    <div className="context-card-title">
                      <Icon name="check" />
                      <span>Saved</span>
                    </div>
                    {entry.turnId ? (
                      <button
                        className="card-action"
                        onClick={() => {
                          void undo(entry.turnId as string);
                        }}
                      >
                        Undo
                      </button>
                    ) : null}
                  </div>
                  <div className="context-card-body">
                    {entry.committed.map((tool, index) => (
                      <div className="schedule-line" key={`${entry.key}-${tool}-${index}`}>
                        <div>
                          <div className="schedule-person">{toolLabel(tool)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {entry.degraded ? (
                <div className="composer-hint">
                  Written from the template — the reply model did not answer.
                </div>
              ) : null}
            </div>
          ),
        )}

        {busy && (
          <div className="message-group">
            <div className="message-label">OurGlass</div>
            <div className="message assistant">Thinking…</div>
          </div>
        )}
      </div>

      {/* Announced: "Too many messages", "That turn was undone", a blocked
          microphone — each is something a user who cannot see it needs. */}
      {notice && (
        <div className="composer-hint" role="status">
          {notice}
        </div>
      )}

      <div className="composer-wrap">
        {attachment && (
          <div className="composer-attachment">
            <Icon name="attach" />
            <span className="composer-attachment-name">{attachment.name}</span>
            <button
              type="button"
              className="composer-attachment-remove"
              aria-label={`Remove ${attachment.name}`}
              disabled={busy}
              onClick={() => setAttachment(null)}
            >
              <Icon name="close" />
            </button>
          </div>
        )}
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          {/* FIRST in the form: the composer grid is `auto 1fr auto auto`, a
              tool before the text box (the prototype's layout). The picker
              itself stays hidden (so it takes no grid cell); this button is
              its accessible face. The input is reset after each pick so
              choosing the same file twice still fires a change. */}
          <input
            ref={fileInputRef}
            type="file"
            hidden
            accept={ACCEPTED_FILES}
            onChange={(event) => {
              const picked = event.target.files?.[0] ?? null;
              event.target.value = "";
              if (picked) setAttachment(picked);
            }}
          />
          <button
            type="button"
            className="composer-tool"
            aria-label="Attach a file"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            <Icon name="attach" />
          </button>
          <textarea
            id="composer-input"
            rows={1}
            placeholder={
              dictation.listening
                ? "Listening…"
                : attachment
                  ? "Add a note, like “the final Hult brief” (optional)"
                  : "Tell me anything..."
            }
            aria-label="Message OurGlass"
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter is a newline. A long thought is one
              // utterance, not three turns.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          {/* Rendered only where the browser has SpeechRecognition — Firefox
              gets no button rather than a dead one. Speech goes INTO the box;
              it never sends, so a misheard word is corrected before the turn. */}
          {dictation.supported && (
            <button
              type="button"
              className="composer-tool"
              aria-label={dictation.listening ? "Stop dictating" : "Dictate a message"}
              aria-pressed={dictation.listening}
              disabled={busy}
              onClick={dictation.toggle}
            >
              <Icon name="mic" />
            </button>
          )}
          <button
            type="submit"
            className="composer-tool composer-send"
            aria-label="Send"
            disabled={busy || (draft.trim() === "" && attachment === null)}
          >
            <Icon name="send" />
          </button>
        </form>
        <div className="composer-hint">
          OurGlass can remember, organize, and act on what you share.
        </div>
      </div>
    </section>
  );
}

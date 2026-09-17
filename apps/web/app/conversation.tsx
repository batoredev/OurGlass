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
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

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

export function Conversation() {
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const streamRef = useRef<HTMLDivElement | null>(null);

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
    if (utterance === "" || busy) return;

    setDraft("");
    setNotice(null);
    setBusy(true);
    const stamp = `local-${Date.now()}`;
    setEntries((current) => [...current, { key: stamp, role: "user", body: utterance }]);

    try {
      const response = await fetch("/api/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ utterance }),
      });

      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as { error?: string } | null;
        setNotice(failure?.error ?? `The turn failed (${response.status}).`);
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
  }, [draft, busy]);

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
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </div>
        </div>
      </header>

      <div className="conversation" id="conversation" ref={streamRef}>
        {empty && (
          <div className="greeting">
            <div>
              <div className="hello-kicker">Your world, in context</div>
              <h2>{greeting(new Date())}</h2>
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

      {notice && <div className="composer-hint">{notice}</div>}

      <div className="composer-wrap">
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            id="composer-input"
            rows={1}
            placeholder="Tell me anything..."
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
          <button
            type="submit"
            className="composer-tool composer-send"
            aria-label="Send"
            disabled={busy || draft.trim() === ""}
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

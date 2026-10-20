"use client";

/**
 * The Thoughts board: ideas and goals in three priority columns.
 *
 * Drag a card to another column, or use its ◀ ▶ buttons — the buttons are the
 * keyboard and touch path, since HTML drag-and-drop works with neither. Every
 * change is a tool call through /api/thoughts (validated, logged, undoable);
 * the board updates at once and rolls back if the server refuses.
 */
import { useState, type DragEvent, type FormEvent } from "react";
import { fetchThoughts, type Thought, type ThoughtPriority } from "../../lib/api";
import { createThought, moveThought, removeThought, undoTurn } from "../../lib/control";
import { Icon } from "../icons";

const COLUMNS: readonly { key: ThoughtPriority; label: string; hint: string }[] = [
  { key: "high", label: "High", hint: "Act on these first" },
  { key: "mid", label: "Mid", hint: "Next up" },
  { key: "low", label: "Low", hint: "Someday" },
];

interface Notice {
  readonly text: string;
  readonly turnId: string | null;
}

export function ThoughtsBoard({ initial }: { initial: readonly Thought[] }) {
  const [thoughts, setThoughts] = useState<readonly Thought[]>(initial);
  const [draft, setDraft] = useState("");
  const [priority, setPriority] = useState<ThoughtPriority>("high");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dragOver, setDragOver] = useState<ThoughtPriority | null>(null);

  async function reload() {
    try {
      setThoughts(await fetchThoughts());
    } catch {
      // The board keeps what it shows; the next action will report a real error.
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (body === "" || busy) return;
    setBusy(true);
    const result = await createThought(body, priority);
    setBusy(false);
    if (!result.ok) {
      setNotice({ text: result.message ?? "Couldn't add that thought.", turnId: null });
      return;
    }
    setDraft("");
    setNotice({ text: `Added to ${label(priority)}.`, turnId: result.turnId });
    await reload();
  }

  async function move(thought: Thought, to: ThoughtPriority) {
    if (thought.priority === to) return;
    const before = thoughts;
    setThoughts((current) => current.map((t) => (t.id === thought.id ? { ...t, priority: to } : t)));
    const result = await moveThought(thought.id, to);
    if (!result.ok) {
      setThoughts(before);
      setNotice({ text: result.message ?? "Couldn't move that thought.", turnId: null });
      return;
    }
    setNotice({ text: `Moved to ${label(to)}.`, turnId: result.turnId });
  }

  async function remove(thought: Thought) {
    const before = thoughts;
    setThoughts((current) => current.filter((t) => t.id !== thought.id));
    const result = await removeThought(thought.id);
    if (!result.ok) {
      setThoughts(before);
      setNotice({ text: result.message ?? "Couldn't remove that thought.", turnId: null });
      return;
    }
    setNotice({ text: "Thought removed.", turnId: result.turnId });
  }

  async function undo(turnId: string) {
    const result = await undoTurn(turnId);
    setNotice({ text: result.ok ? "Undone." : (result.message ?? "Couldn't undo that."), turnId: null });
    await reload();
  }

  function onDrop(event: DragEvent, to: ThoughtPriority) {
    event.preventDefault();
    setDragOver(null);
    const id = event.dataTransfer.getData("text/plain");
    const thought = thoughts.find((t) => t.id === id);
    if (thought) void move(thought, to);
  }

  return (
    <>
      <form className="thought-composer" onSubmit={add}>
        <label className="sr-only" htmlFor="thought-input">
          New thought
        </label>
        <input
          id="thought-input"
          className="thought-input"
          placeholder="An idea or goal to act on…"
          maxLength={500}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="priority-picker" role="radiogroup" aria-label="Priority">
          {COLUMNS.map((column) => (
            <button
              key={column.key}
              type="button"
              role="radio"
              aria-checked={priority === column.key}
              className={`priority-chip priority-${column.key} ${priority === column.key ? "selected" : ""}`}
              onClick={() => setPriority(column.key)}
            >
              {column.label}
            </button>
          ))}
        </div>
        <button type="submit" className="primary-button" disabled={busy || draft.trim() === ""}>
          Add
        </button>
      </form>

      {notice && (
        <div className="board-notice" role="status">
          <span>{notice.text}</span>
          {notice.turnId && (
            <button type="button" className="link-button" onClick={() => void undo(notice.turnId!)}>
              Undo
            </button>
          )}
        </div>
      )}

      <div className="board">
        {COLUMNS.map((column, index) => {
          const cards = thoughts.filter((t) => t.priority === column.key);
          return (
            <section
              key={column.key}
              className={`board-column column-${column.key} ${dragOver === column.key ? "drag-over" : ""}`}
              aria-labelledby={`column-${column.key}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(column.key);
              }}
              onDragLeave={() => setDragOver((current) => (current === column.key ? null : current))}
              onDrop={(event) => onDrop(event, column.key)}
            >
              <header className="board-column-head">
                <h2 id={`column-${column.key}`}>{column.label}</h2>
                <span className="board-count">{cards.length}</span>
              </header>
              <p className="board-hint">{column.hint}</p>
              <ul className="board-cards">
                {cards.length === 0 && <li className="board-empty">Drop a thought here</li>}
                {cards.map((thought) => {
                  const left = COLUMNS[index - 1];
                  const right = COLUMNS[index + 1];
                  return (
                    <li
                      key={thought.id}
                      className="thought-card"
                      draggable
                      onDragStart={(event) => event.dataTransfer.setData("text/plain", thought.id)}
                    >
                      <p className="thought-body">{thought.body}</p>
                      <div className="thought-actions">
                        <span className="thought-date">
                          {new Date(thought.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </span>
                        <span className="thought-buttons">
                          {left && (
                            <button
                              type="button"
                              className="thought-button"
                              aria-label={`Move to ${left.label}`}
                              title={`Move to ${left.label}`}
                              onClick={() => void move(thought, left.key)}
                            >
                              ◀
                            </button>
                          )}
                          {right && (
                            <button
                              type="button"
                              className="thought-button"
                              aria-label={`Move to ${right.label}`}
                              title={`Move to ${right.label}`}
                              onClick={() => void move(thought, right.key)}
                            >
                              ▶
                            </button>
                          )}
                          <button
                            type="button"
                            className="thought-button"
                            aria-label="Remove thought"
                            title="Remove"
                            onClick={() => void remove(thought)}
                          >
                            <Icon name="close" />
                          </button>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

function label(priority: ThoughtPriority): string {
  return COLUMNS.find((column) => column.key === priority)?.label ?? priority;
}

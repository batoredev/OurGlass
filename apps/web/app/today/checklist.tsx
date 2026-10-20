"use client";

/**
 * Today's checklist — tick a line to mark it done, tick again to undo.
 *
 * A commitment's tick completes it (the same tool the chat uses); a meeting's
 * or reminder's records the user's own mark. Each line is a real checkbox
 * button, so it works by keyboard and screen reader as well as by tap. The
 * list updates at once and rolls back if the server refuses.
 */
import { useState } from "react";
import type { ChecklistItem } from "../../lib/api";
import { checkItem } from "../../lib/control";
import { refreshData } from "../../lib/session";
import { Icon } from "../icons";

const KIND_LABEL = { commitment: "Commitment", meeting: "Meeting", reminder: "Reminder" } as const;

export function TodayChecklist({ initial }: { initial: readonly ChecklistItem[] }) {
  const [items, setItems] = useState<readonly ChecklistItem[]>(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const done = items.filter((item) => item.done).length;

  async function toggle(item: ChecklistItem) {
    const key = `${item.kind}-${item.id}`;
    if (pending) return;
    setPending(key);
    setMessage(null);
    const before = items;
    setItems((current) => current.map((i) => (i.kind === item.kind && i.id === item.id ? { ...i, done: !i.done } : i)));
    const result = await checkItem(item.kind, item.id, !item.done);
    setPending(null);
    if (!result.ok) {
      setItems(before);
      setMessage(result.message);
      return;
    }
    // Other surfaces on the page (Overdue, Due later) read the same rows.
    refreshData();
  }

  return (
    <section className="section" aria-labelledby="checklist-title">
      <div className="checklist-head">
        <h2 className="section-title" id="checklist-title">
          Today&rsquo;s checklist
        </h2>
        <span className="checklist-count">
          {done} done · {items.length - done} to do
        </span>
      </div>
      <ul className="checklist">
        {items.map((item) => {
          const key = `${item.kind}-${item.id}`;
          return (
            <li key={key}>
              <button
                type="button"
                role="checkbox"
                aria-checked={item.done}
                className={`checklist-item ${item.done ? "done" : "todo"}`}
                disabled={pending === key}
                onClick={() => void toggle(item)}
              >
                <span className="checklist-box" aria-hidden="true">
                  {item.done ? <Icon name="check" /> : null}
                </span>
                <span className="checklist-body">
                  <span className="checklist-title">{item.title}</span>
                  <span className="checklist-meta">
                    {KIND_LABEL[item.kind]} ·{" "}
                    {new Date(item.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    {item.detail ? ` · ${item.detail}` : ""}
                  </span>
                </span>
                <span className="checklist-state">{item.done ? "Done" : "To do"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {message && (
        <p className="composer-hint" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

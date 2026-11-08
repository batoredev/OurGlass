"use client";

/**
 * Today → "Your day, planned" (ROADMAP Stage 3).
 *
 * The scheduler's PROPOSAL: meetings as they are, your work placed around
 * them most-urgent first, nudges for people who run late, and what does not
 * fit — each with its reason. Nothing changes until you press the button;
 * then the work and nudges become events in one undoable turn.
 */
import { useCallback, useEffect, useState } from "react";
import { fetchDayPlan, type DayPlan, type PlannedBlock } from "../../lib/api";
import { apiFetch, refreshData } from "../../lib/session";

/** In YOUR time zone (the one the plan was made in), whatever this browser is set to. */
function time(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone });
}

const LABEL: Readonly<Record<PlannedBlock["kind"], string>> = { meeting: "Meeting", task: "Work", nudge: "Nudge" };

export function DayPlanSection() {
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchDayPlan()
      .then((fresh) => {
        setPlan(fresh);
        setError(null);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, []);
  useEffect(load, [load]);

  const proposed = plan?.blocks.filter((block) => block.kind !== "meeting") ?? [];

  async function accept() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await apiFetch("/api/plan/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blocks: proposed.map(({ kind, title, start, end }) => ({ kind, title, start, end })) }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; added?: number };
      if (!response.ok) {
        setStatus(body.error ?? `Nothing was added (${response.status}).`);
        return;
      }
      setStatus(`Added ${body.added} block${body.added === 1 ? "" : "s"} to your day. Undo it from Activity.`);
      refreshData();
      load();
    } catch (caught: unknown) {
      setStatus(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="row-subtitle">The plan could not load: {error}</p>;
  if (!plan) return null;
  if (plan.blocks.length === 0 && plan.unplaced.length === 0) return null;

  return (
    <section className="section day-plan" aria-labelledby="day-plan-title">
      <div className="checklist-head">
        <h2 className="section-title" id="day-plan-title">
          Your day, planned
        </h2>
        {proposed.length > 0 ? (
          <button type="button" className="primary-button" disabled={busy} onClick={() => void accept()}>
            {busy ? "Adding…" : "Put it on my calendar"}
          </button>
        ) : null}
      </div>
      {plan.next ? (
        <p className="day-plan-next">
          <strong>Next:</strong> {plan.next.title} at {time(plan.next.start, plan.timeZone)} — {plan.next.reason}
        </p>
      ) : null}
      <ol className="day-plan-list">
        {plan.blocks.map((block) => (
          <li key={`${block.kind}-${block.id}`} className={`day-plan-item day-plan-${block.kind}`}>
            <span className="day-plan-time">
              {time(block.start, plan.timeZone)}–{time(block.end, plan.timeZone)}
            </span>
            <span className="day-plan-kind">{LABEL[block.kind]}</span>
            <span className="day-plan-title">{block.title}</span>
            <span className="day-plan-reason">{block.reason}</span>
          </li>
        ))}
      </ol>
      {plan.unplaced.length > 0 ? (
        <div className="day-plan-unplaced">
          <h3 className="profile-subtitle">Doesn&rsquo;t fit today</h3>
          <ul>
            {plan.unplaced.map((item) => (
              <li key={item.id}>
                {item.title} — {item.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {status ? (
        <p className="row-subtitle" role="status">
          {status}
        </p>
      ) : null}
    </section>
  );
}

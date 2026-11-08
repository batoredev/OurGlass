"use client";

/**
 * "Suggest meeting times" on a person's page (ROADMAP Stage 3): three free
 * times in the next week, inside their stated time of day when there is one,
 * with what that is based on. Booking stays a sentence in the chat.
 */
import { useState } from "react";
import { fetchMeetingSlots, type SlotSuggestion } from "../../../lib/api";

export function MeetingSlots({ personId, name }: { personId: string; name: string }) {
  const [result, setResult] = useState<SlotSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function find() {
    setError(null);
    try {
      setResult(await fetchMeetingSlots(personId));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <section className="section" aria-labelledby="slots-title">
      <h2 className="section-title" id="slots-title">
        Meeting times with {name}
      </h2>
      {result === null ? (
        <button type="button" className="secondary-button" onClick={() => void find()}>
          Suggest meeting times
        </button>
      ) : (
        <>
          <p className="profile-empty">Based on: {result.basis}.</p>
          {result.slots.length === 0 ? (
            <p className="profile-empty">No free 30 minutes in the next week.</p>
          ) : (
            <ul className="profile-list">
              {result.slots.map((slot) => (
                <li key={slot.start}>
                  {new Date(slot.start).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: result.timeZone })}
                </li>
              ))}
            </ul>
          )}
          <p className="profile-empty">To book one, say it in the chat: &ldquo;schedule {name} on Tuesday at 10&rdquo;.</p>
        </>
      )}
      {error ? (
        <p className="delete-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

import { describe, expect, it } from "vitest";
import type { PersonProfileData } from "@ourglass/db";
import { briefFor, peopleInMeeting } from "./brief.js";
import { deriveProfile, lateBufferHours } from "./profile.js";

const NOW = new Date("2026-11-08T09:00:00.000Z");
const H = 3_600_000;
const BARKHA = "11111111-1111-4111-8111-111111111111";
const SELF = "99999999-9999-4999-8999-999999999999";
const at = (hoursFromNow: number) => new Date(NOW.getTime() + hoursFromNow * H);

function commitment(over: Partial<PersonProfileData["commitments"][number]>): PersonProfileData["commitments"][number] {
  return {
    id: `c-${Math.random()}`,
    owner_id: BARKHA,
    recipient_id: SELF,
    object_text: "the article",
    status: "pending",
    expected_at: null,
    completed_at: null,
    t_created: at(-500),
    ...over,
  };
}

function data(over: Partial<PersonProfileData> = {}): PersonProfileData {
  return {
    person: { id: BARKHA, display_name: "Barkha", email: null, organization_name: null, t_created: at(-1000) },
    ids: [BARKHA],
    commitments: [],
    memories: [],
    relationships: [],
    files: [],
    emails: [],
    ...over,
  };
}

describe("deriveProfile — every field from stored rows, each with its source", () => {
  it("splits what is open by direction, and marks what is overdue", () => {
    const profile = deriveProfile(
      data({
        commitments: [
          commitment({ object_text: "the article", expected_at: at(-2) }),
          commitment({ object_text: "the poster draft", expected_at: at(48) }),
          commitment({ owner_id: SELF, recipient_id: BARKHA, object_text: "feedback" }),
          commitment({ object_text: "old thing", status: "completed" }),
        ],
      }),
      NOW,
    );
    expect(profile.owesYou.value.map((item) => [item.what, item.overdue])).toEqual([
      ["the article", true],
      ["the poster draft", false],
    ]);
    expect(profile.youOwe.value.map((item) => item.what)).toEqual(["feedback"]);
    expect(profile.owesYou.source).toContain("2");
  });

  it("has NO reliability without a finished commitment that had a deadline — no record, no number", () => {
    expect(deriveProfile(data({ commitments: [commitment({ status: "completed" })] }), NOW).reliability).toBeNull();
  });

  it("counts on time and late from status, and the typical lateness from the two times", () => {
    const profile = deriveProfile(
      data({
        commitments: [
          commitment({ status: "completed", expected_at: at(-100), completed_at: at(-101) }),
          commitment({ status: "completed_late", expected_at: at(-80), completed_at: at(-56) }),
          commitment({ status: "completed_late", expected_at: at(-60), completed_at: at(-36) }),
          commitment({ status: "completed_late", expected_at: at(-40), completed_at: at(-28) }),
        ],
      }),
      NOW,
    );
    expect(profile.reliability).toEqual({
      value: { onTime: 1, late: 3, typicalLateHours: 24 },
      source: "from 4 finished commitments with a deadline",
    });
    expect(lateBufferHours(profile.reliability!.value)).toBe(24);
  });

  it("gives no buffer on a thin or mostly punctual record", () => {
    expect(lateBufferHours({ onTime: 1, late: 1, typicalLateHours: 24 })).toBeNull();
    expect(lateBufferHours({ onTime: 3, late: 1, typicalLateHours: 24 })).toBeNull();
    expect(lateBufferHours(null)).toBeNull();
  });

  it("only counts what THEY owed — your own lateness to them is not theirs", () => {
    const profile = deriveProfile(
      data({
        commitments: [
          commitment({ owner_id: SELF, recipient_id: BARKHA, status: "completed_late", expected_at: at(-50), completed_at: at(-2) }),
        ],
      }),
      NOW,
    );
    expect(profile.reliability).toBeNull();
  });

  it("keeps preferences, facts and patterns apart, each saying how it was learned", () => {
    const profile = deriveProfile(
      data({
        memories: [
          { id: "m1", kind: "preference", body: "Barkha prefers morning meetings", inference_level: "CONFIRMED", source_message_id: null, t_created: new Date("2026-11-03T10:00:00Z") },
          { id: "m2", kind: "fact", body: "Barkha edits the newsletter", inference_level: "INFERRED", source_message_id: null, t_created: new Date("2026-11-04T10:00:00Z") },
        ],
      }),
      NOW,
    );
    expect(profile.preferences).toEqual([{ value: "Barkha prefers morning meetings", source: "you said so on 3 Nov 2026" }]);
    expect(profile.facts).toEqual([{ value: "Barkha edits the newsletter", source: "inferred on 4 Nov 2026" }]);
    expect(profile.patterns).toEqual([]);
  });

  it("names the newest interaction, and never one in the future", () => {
    const profile = deriveProfile(
      data({
        commitments: [commitment({ object_text: "the article", t_created: at(-30) })],
        emails: [{ subject: "Draft", sent_at: at(-5) }],
        files: [{ document_id: "d", filename: "later.pdf", t_created: at(5) }],
      }),
      NOW,
    );
    expect(profile.lastInteraction?.value).toBe("an email: Draft");
  });

  it("shows email, organization and groups only when they exist", () => {
    const bare = deriveProfile(data(), NOW);
    expect([bare.email, bare.organization, bare.groups, bare.lastInteraction]).toEqual([null, null, [], null]);
    const full = deriveProfile(
      data({
        person: { id: BARKHA, display_name: "Barkha", email: "barkha@example.com", organization_name: "Hult", t_created: at(-1) },
        relationships: [{ id: "r", rel_type: "works_on", object_kind: "project", object_name: "the newsletter", inference_level: "CONFIRMED", t_created: at(-3) }],
      }),
      NOW,
    );
    expect(full.email?.value).toBe("barkha@example.com");
    expect(full.organization?.value).toBe("Hult");
    expect(full.groups.map((group) => group.value)).toEqual(["works on the newsletter"]);
  });
});

describe("meeting briefs", () => {
  const people = [
    { id: BARKHA, display_name: "Barkha" },
    { id: "a1", display_name: "Arun" },
    { id: "a2", display_name: "Arun" },
    { id: SELF, display_name: "You" },
  ];

  it("finds the people a meeting names by whole name — and never guesses between two", () => {
    expect(peopleInMeeting({ title: "Coffee with Barkha" }, people, SELF).map((p) => p.name)).toEqual(["Barkha"]);
    expect(peopleInMeeting({ title: "Call with Arun" }, people, SELF)).toEqual([]);
    expect(peopleInMeeting({ title: "Barkhadir review" }, people, SELF)).toEqual([]);
    expect(peopleInMeeting({ title: "Prep", notes: "bring Barkha's notes" }, people, SELF).map((p) => p.name)).toEqual(["Barkha"]);
  });

  it("says what is open between you, the record, and the last interaction", () => {
    const profile = deriveProfile(
      data({
        commitments: [
          commitment({ object_text: "the article", expected_at: at(-2) }),
          commitment({ status: "completed", expected_at: at(-100), completed_at: at(-101) }),
        ],
        memories: [{ id: "m", kind: "preference", body: "Barkha prefers morning meetings", inference_level: "CONFIRMED", source_message_id: null, t_created: at(-24) }],
      }),
      NOW,
    );
    const brief = briefFor(profile);
    expect(brief.lines[0]).toMatch(/^Owes you: the article \(due .*, overdue\)\.$/);
    expect(brief.lines).toContain("On time 1 of 1 (from 1 finished commitment with a deadline).");
    expect(brief.lines.some((line) => line.startsWith("Barkha prefers morning meetings (you said so on"))).toBe(true);
  });

  it("says plainly when nothing is open", () => {
    expect(briefFor(deriveProfile(data(), NOW)).lines).toEqual(["No open commitments between you."]);
  });
});

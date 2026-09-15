import type { Extraction, ExtractedIntent, IntentKind, InferenceLevel, EntityMention } from "@ourglass/shared";
import type { ForbiddableField } from "./match.js";

export interface ExtractionFixture {
  readonly id: string;
  readonly utterance: string;
  readonly expected: Extraction;
  /**
   * Fields the extraction must NOT contain.
   *
   * `expected` can only say what SHOULD be there; the comparator leaves
   * unlabelled fields unconstrained on purpose, so it cannot express "and do
   * not invent a memory here". This can. Used by the negative fixtures, and by
   * a few positive ones where the neighbouring field is the likely mistake --
   * defining a type is not logging one, and a forget is distinguished from a
   * correction only by the ABSENCE of a replacement.
   */
  readonly forbids?: readonly ForbiddableField[];
}

function intent(
  kind: IntentKind,
  sourceText: string,
  inferenceLevel: InferenceLevel = "CONFIRMED",
  details: Omit<ExtractedIntent, "kind" | "sourceText" | "inferenceLevel"> = {},
): ExtractedIntent {
  return { kind, sourceText, inferenceLevel, ...details };
}

const person = (name: string, inferenceLevel: InferenceLevel = "CONFIRMED"): EntityMention => ({
  name,
  kind: "person",
  inferenceLevel,
});
const org = (name: string): EntityMention => ({ name, kind: "organization", inferenceLevel: "CONFIRMED" });
const project = (name: string): EntityMention => ({ name, kind: "project", inferenceLevel: "CONFIRMED" });
const deterministic = (sourcePhrase: string) => ({ kind: "deterministic" as const, sourcePhrase });
const relational = (sourcePhrase: string) => ({ kind: "relational" as const, sourcePhrase });
const eventTrigger = (sourcePhrase: string) => ({ kind: "event_trigger" as const, sourcePhrase });

/** The user themselves. Resolve maps this mention to the account holder in Phase 3. */
const me = person("me");

/**
 * Hand-labelled Phase 2 eval set — 50 cases, every one labelled by hand with the
 * owner, recipient, object, and time the utterance actually implies.
 *
 * Names are the product spec's fictional cast (Barkha, Arun, Karthik, Hult, MTTN)
 * and this repository is public: never substitute a real teammate or customer.
 *
 * Labelling rules, so later additions stay consistent with these:
 *
 * - **Ownership direction is labelled on every commitment.** `owner` is who must
 *   deliver; `recipient` is who receives. Spec §7 and DECISIONS.md #9 make a
 *   reversal the worst failure in the system, so both directions appear here
 *   several times each and the comparator asserts them positionally.
 * - **`time.sourcePhrase` is verbatim from the utterance.** Never a resolved
 *   timestamp — the model is forbidden from calculating one (DECISIONS.md #4).
 * - **Only label what the utterance actually supports.** An unlabelled field is
 *   unconstrained by the comparator, which is preferable to inventing a label and
 *   asserting a hallucination. Where the utterance is genuinely ambiguous the
 *   fixture is UNCERTAIN, which is itself the assertion.
 *
 * Fixture tests run without an API key; they assert schema validity, comparator
 * behaviour, and coverage. They do NOT exercise the model — only `test:live` does.
 */
export const EXTRACTION_FIXTURES: readonly ExtractionFixture[] = [
  // ---------------------------------------------------------------------------
  // Someone owes the user (spec §7 direction A)
  // ---------------------------------------------------------------------------
  {
    id: "barkha-article-and-reminder",
    utterance: "Barkha needs to give me the article by 6. Remind me at 5 to ask her.",
    expected: { intents: [
      intent("information", "Barkha needs to give me the article by 6", "CONFIRMED", { owner: person("Barkha"), recipient: me, objectText: "the article", time: deterministic("by 6") }),
      intent("action", "Remind me at 5 to ask her", "CONFIRMED", { relatedEntity: person("Barkha"), reminderBody: "ask her", time: deterministic("at 5") }),
    ] },
  },
  {
    id: "karthik-poster-tomorrow",
    utterance: "Karthik needs to send me the poster tomorrow.",
    expected: { intents: [intent("information", "Karthik needs to send me the poster tomorrow", "CONFIRMED", { owner: person("Karthik"), recipient: me, objectText: "the poster", time: deterministic("tomorrow") })] },
  },
  {
    id: "information-deadline",
    utterance: "Karthik owes me the budget by Friday.",
    expected: { intents: [intent("information", "Karthik owes me the budget by Friday", "CONFIRMED", { owner: person("Karthik"), recipient: me, objectText: "the budget", time: deterministic("by Friday") })] },
  },
  {
    id: "waiting-on-arun",
    utterance: "Arun still hasn't sent the schema.",
    expected: { intents: [intent("information", "Arun still hasn't sent the schema", "CONFIRMED", { owner: person("Arun"), recipient: me, objectText: "the schema" })] },
  },
  {
    id: "barkha-owes-article-no-date",
    utterance: "Barkha owes me the interview writeup.",
    expected: { intents: [intent("information", "Barkha owes me the interview writeup", "CONFIRMED", { owner: person("Barkha"), recipient: me, objectText: "the interview writeup" })] },
  },
  {
    id: "arun-review-before-standup",
    utterance: "Arun needs to review the migration before standup.",
    expected: { intents: [intent("information", "Arun needs to review the migration before standup", "CONFIRMED", { owner: person("Arun"), recipient: me, objectText: "the migration", time: relational("before standup") })] },
  },

  // ---------------------------------------------------------------------------
  // The user owes someone (spec §7 direction B)
  // ---------------------------------------------------------------------------
  {
    id: "user-owes-hult",
    utterance: "I need to send Hult the final poster by Wednesday.",
    expected: { intents: [intent("information", "I need to send Hult the final poster by Wednesday", "CONFIRMED", { owner: me, recipient: org("Hult"), objectText: "the final poster", time: deterministic("by Wednesday") })] },
  },
  {
    id: "next-friday",
    utterance: "I need to send Karthik the notes next Friday.",
    expected: { intents: [intent("information", "I need to send Karthik the notes next Friday", "CONFIRMED", { owner: me, recipient: person("Karthik"), objectText: "the notes", time: deterministic("next Friday") })] },
  },
  {
    id: "user-owes-barkha-article",
    utterance: "I need to send Barkha the article by 6.",
    expected: { intents: [intent("information", "I need to send Barkha the article by 6", "CONFIRMED", { owner: me, recipient: person("Barkha"), objectText: "the article", time: deterministic("by 6") })] },
  },
  {
    id: "user-owes-arun-after-review",
    utterance: "I owe Arun the schema feedback after the review.",
    expected: { intents: [intent("information", "I owe Arun the schema feedback after the review", "CONFIRMED", { owner: me, recipient: person("Arun"), objectText: "the schema feedback", time: relational("after the review") })] },
  },
  {
    id: "user-owes-mttn-invoice",
    utterance: "I have to get the invoice to MTTN by month end.",
    expected: { intents: [intent("information", "I have to get the invoice to MTTN by month end", "CONFIRMED", { owner: me, recipient: org("MTTN"), objectText: "the invoice", time: deterministic("by month end") })] },
  },
  {
    id: "information-no-date",
    utterance: "I need to review the proposal.",
    expected: { intents: [intent("information", "I need to review the proposal", "CONFIRMED", { owner: me, objectText: "the proposal" })] },
  },

  // ---------------------------------------------------------------------------
  // Completion, late completion, context attached after completion
  // ---------------------------------------------------------------------------
  {
    id: "late-completion",
    utterance: "Barkha gave the article at 11.",
    expected: { intents: [intent("completion_update", "Barkha gave the article at 11", "CONFIRMED", { owner: person("Barkha"), recipient: me, objectText: "the article", time: deterministic("at 11") })] },
  },
  {
    id: "context-after-completion",
    utterance: "She had a family emergency.",
    expected: { intents: [intent("context", "She had a family emergency", "UNCERTAIN", { objectText: "a family emergency" })] },
  },
  {
    id: "finished-poster",
    utterance: "I finished the Hult poster.",
    expected: { intents: [intent("completion_update", "I finished the Hult poster", "CONFIRMED", { owner: me, objectText: "the Hult poster" })] },
  },
  {
    id: "completion-own-work",
    utterance: "I sent the final poster to Hult.",
    expected: { intents: [intent("completion_update", "I sent the final poster to Hult", "CONFIRMED", { owner: me, recipient: org("Hult"), objectText: "the final poster" })] },
  },
  {
    id: "completion-other-work",
    utterance: "Arun sent the schema.",
    expected: { intents: [intent("completion_update", "Arun sent the schema", "CONFIRMED", { owner: person("Arun"), recipient: me, objectText: "the schema" })] },
  },
  {
    id: "completion-late-context",
    utterance: "Barkha finally sent it after dinner.",
    expected: { intents: [intent("completion_update", "Barkha finally sent it after dinner", "UNCERTAIN", { owner: person("Barkha"), recipient: me, time: relational("after dinner") })] },
  },
  // Past-tense completions. These pin the EXTRACTION side of a known Resolve bug:
  // `resolveTime` applies chrono's `forwardDate: true` unconditionally, so a
  // past-tense completion ("at 11", "this morning", "last Friday") resolves into the
  // FUTURE. The fix belongs in apps/api/src/assistant/time.ts, not here — this lane
  // has no clock and no reference instant, so it cannot observe that bug.
  //
  // What these fixtures DO guarantee is that the fix has correct input: the intent
  // arrives as `completion_update` (the signal `resolveTime` needs to choose past
  // instead of forward direction) with the time phrase verbatim and tier
  // `deterministic`. If extraction mislabels these as `information`, the downstream
  // fix silently mis-resolves again — that regression is what this catches.
  {
    id: "completion-past-this-morning",
    utterance: "Karthik sent the budget this morning.",
    expected: { intents: [intent("completion_update", "Karthik sent the budget this morning", "CONFIRMED", { owner: person("Karthik"), recipient: me, objectText: "the budget", time: deterministic("this morning") })] },
  },
  {
    id: "completion-past-last-friday",
    utterance: "Barkha gave me the article last Friday.",
    expected: { intents: [intent("completion_update", "Barkha gave me the article last Friday", "CONFIRMED", { owner: person("Barkha"), recipient: me, objectText: "the article", time: deterministic("last Friday") })] },
  },
  {
    id: "completion-past-yesterday",
    utterance: "I sent Hult the poster yesterday.",
    expected: { intents: [intent("completion_update", "I sent Hult the poster yesterday", "CONFIRMED", { owner: me, recipient: org("Hult"), objectText: "the poster", time: deterministic("yesterday") })] },
  },
  {
    id: "completion-with-reason",
    utterance: "Karthik approved the poster this morning, he was travelling yesterday.",
    expected: { intents: [
      intent("completion_update", "Karthik approved the poster this morning", "CONFIRMED", { owner: person("Karthik"), objectText: "the poster", time: deterministic("this morning") }),
      intent("context", "he was travelling yesterday", "INFERRED", { relatedEntity: person("Karthik"), objectText: "travelling", time: deterministic("yesterday") }),
    ] },
  },

  // ---------------------------------------------------------------------------
  // Reminders — deterministic tier
  // ---------------------------------------------------------------------------
  {
    id: "relative-time",
    utterance: "Remind me in two hours to call Karthik.",
    expected: { intents: [intent("action", "Remind me in two hours to call Karthik", "CONFIRMED", { relatedEntity: person("Karthik"), reminderBody: "call Karthik", time: deterministic("in two hours") })] },
  },
  {
    id: "tomorrow-reminder",
    utterance: "Remind me tomorrow to check the Hult poster.",
    expected: { intents: [intent("action", "Remind me tomorrow to check the Hult poster", "CONFIRMED", { relatedEntity: org("Hult"), reminderBody: "check the Hult poster", time: deterministic("tomorrow") })] },
  },
  {
    id: "tonight-reminder",
    utterance: "Remind me tonight to review the contract.",
    expected: { intents: [intent("action", "Remind me tonight to review the contract", "CONFIRMED", { reminderBody: "review the contract", time: deterministic("tonight") })] },
  },
  {
    id: "this-evening",
    utterance: "Ask me this evening about the venue.",
    expected: { intents: [intent("action", "Ask me this evening about the venue", "CONFIRMED", { reminderBody: "about the venue", time: deterministic("this evening") })] },
  },
  {
    id: "action-reminder-by-day",
    utterance: "Remind me by Wednesday to get the venue confirmed.",
    expected: { intents: [intent("action", "Remind me by Wednesday to get the venue confirmed", "CONFIRMED", { reminderBody: "get the venue confirmed", time: deterministic("by Wednesday") })] },
  },
  {
    id: "action-event",
    utterance: "Remind me at 5 PM to ask Barkha if the article arrived.",
    expected: { intents: [intent("action", "Remind me at 5 PM to ask Barkha if the article arrived", "CONFIRMED", { relatedEntity: person("Barkha"), reminderBody: "ask Barkha if the article arrived", time: deterministic("at 5 PM") })] },
  },
  {
    // Spec §11's two-Aruns case. Deliberately CONFIRMED at the intent level: the
    // utterance itself is unambiguous, and "which Arun" is only ambiguous against a
    // database that contains two of them. That is Phase 3 Resolve's three-band name
    // match (PHASE-2-DESIGN.md "Name resolution is three-band"), not something the
    // extractor can know from one turn. Do NOT relabel this UNCERTAIN to represent
    // the two-Aruns problem — asserting it here would demand the model guess at
    // database state it was deliberately never given. The unresolvable-referent
    // fixtures below are where extraction-time ambiguity is asserted.
    id: "ask-two-aruns",
    utterance: "Remind me to ask Arun about the poster.",
    expected: { intents: [intent("action", "Remind me to ask Arun about the poster", "CONFIRMED", { relatedEntity: person("Arun"), reminderBody: "ask Arun about the poster" })] },
  },
  {
    id: "action-no-date",
    utterance: "Remind me to follow up with Barkha.",
    expected: { intents: [intent("action", "Remind me to follow up with Barkha", "CONFIRMED", { relatedEntity: person("Barkha"), reminderBody: "follow up with Barkha" })] },
  },

  // ---------------------------------------------------------------------------
  // Reminders — relational tier
  // ---------------------------------------------------------------------------
  {
    id: "relational-time",
    utterance: "Remind me before the meeting to send the deck.",
    expected: { intents: [intent("action", "Remind me before the meeting to send the deck", "CONFIRMED", { reminderBody: "send the deck", time: relational("before the meeting") })] },
  },
  {
    id: "relational-after-meeting",
    utterance: "After the meeting, remind me to send the summary.",
    expected: { intents: [intent("action", "After the meeting, remind me to send the summary", "CONFIRMED", { reminderBody: "send the summary", time: relational("After the meeting") })] },
  },
  {
    id: "relational-before-call",
    utterance: "Before the MTTN call, remind me to reread Barkha's notes.",
    expected: { intents: [intent("action", "Before the MTTN call, remind me to reread Barkha's notes", "CONFIRMED", { relatedEntity: org("MTTN"), reminderBody: "reread Barkha's notes", time: relational("Before the MTTN call") })] },
  },

  // ---------------------------------------------------------------------------
  // Reminders — event_trigger tier
  // ---------------------------------------------------------------------------
  {
    id: "event-trigger-time",
    utterance: "After Arun replies, remind me to schedule the review.",
    expected: { intents: [intent("action", "After Arun replies, remind me to schedule the review", "CONFIRMED", { relatedEntity: person("Arun"), reminderBody: "schedule the review", time: eventTrigger("After Arun replies") })] },
  },
  {
    id: "event-trigger-if",
    utterance: "If Barkha does not reply by tomorrow, remind me.",
    expected: { intents: [intent("action", "If Barkha does not reply by tomorrow, remind me", "CONFIRMED", { relatedEntity: person("Barkha"), time: eventTrigger("If Barkha does not reply by tomorrow") })] },
  },
  {
    id: "event-trigger-once-approved",
    utterance: "Once Karthik approves the poster, remind me to send it to Hult.",
    expected: { intents: [intent("action", "Once Karthik approves the poster, remind me to send it to Hult", "CONFIRMED", { relatedEntity: person("Karthik"), reminderBody: "send it to Hult", time: eventTrigger("Once Karthik approves the poster") })] },
  },
  {
    id: "blocked-dependency",
    utterance: "The poster is blocked until Karthik approves it.",
    expected: { intents: [intent("information", "The poster is blocked until Karthik approves it", "CONFIRMED", { relatedEntity: person("Karthik"), objectText: "the poster", time: eventTrigger("until Karthik approves it") })] },
  },

  // ---------------------------------------------------------------------------
  // Information about people, organizations, projects (spec §14-§16)
  // ---------------------------------------------------------------------------
  {
    id: "information-only",
    utterance: "Arun handles backend at Batore.",
    expected: { intents: [intent("information", "Arun handles backend at Batore", "CONFIRMED", { owner: person("Arun"), objectText: "handles backend at Batore" })] },
  },
  {
    id: "relationship",
    utterance: "Karthik works with Hult.",
    expected: { intents: [intent("information", "Karthik works with Hult", "CONFIRMED", { owner: person("Karthik"), relatedEntity: org("Hult"), objectText: "works with Hult" })] },
  },
  {
    id: "organization",
    utterance: "Barkha is at MTTN.",
    expected: { intents: [intent("information", "Barkha is at MTTN", "CONFIRMED", { owner: person("Barkha"), relatedEntity: org("MTTN"), objectText: "is at MTTN" })] },
  },
  {
    id: "project-information",
    utterance: "The CRM project needs a backend review.",
    expected: { intents: [intent("information", "The CRM project needs a backend review", "CONFIRMED", { relatedEntity: project("CRM"), objectText: "a backend review" })] },
  },
  {
    id: "information-correction",
    utterance: "No, Karthik handles the backend now.",
    expected: { intents: [intent("information", "No, Karthik handles the backend now", "CONFIRMED", { owner: person("Karthik"), objectText: "handles the backend" })] },
  },
  {
    id: "context-observation",
    utterance: "Barkha has been coordinating the interviews.",
    expected: { intents: [intent("information", "Barkha has been coordinating the interviews", "CONFIRMED", { owner: person("Barkha"), objectText: "coordinating the interviews" })] },
  },
  {
    id: "information-in-progress",
    utterance: "I started the CRM migration.",
    expected: { intents: [intent("information", "I started the CRM migration", "CONFIRMED", { owner: me, relatedEntity: project("CRM"), objectText: "the CRM migration" })] },
  },
  {
    id: "cancelled-meeting",
    utterance: "The Hult meeting is cancelled.",
    expected: { intents: [intent("information", "The Hult meeting is cancelled", "CONFIRMED", { relatedEntity: org("Hult"), objectText: "the Hult meeting is cancelled" })] },
  },
  {
    id: "yesterday-context",
    utterance: "The MTTN call happened yesterday.",
    expected: { intents: [intent("information", "The MTTN call happened yesterday", "CONFIRMED", { relatedEntity: org("MTTN"), objectText: "the MTTN call", time: deterministic("yesterday") })] },
  },
  {
    id: "duplicate-poster",
    utterance: "Still need to finish that Hult poster.",
    expected: { intents: [intent("information", "Still need to finish that Hult poster", "CONFIRMED", { owner: me, relatedEntity: org("Hult"), objectText: "that Hult poster" })] },
  },

  // ---------------------------------------------------------------------------
  // Context (spec §5 CONTEXT)
  // ---------------------------------------------------------------------------
  {
    id: "context-delay",
    utterance: "The delay was caused by the printer outage.",
    expected: { intents: [intent("context", "The delay was caused by the printer outage", "UNCERTAIN", { objectText: "the printer outage" })] },
  },
  {
    id: "context-explains-miss",
    utterance: "Arun was out sick all week, that's why the schema slipped.",
    expected: { intents: [intent("context", "Arun was out sick all week, that's why the schema slipped", "CONFIRMED", { relatedEntity: person("Arun"), objectText: "out sick all week" })] },
  },

  // ---------------------------------------------------------------------------
  // Ambiguity that must be UNCERTAIN (spec §12)
  //
  // These carry unusual weight. DECISIONS.md open question 2 originally preferred a
  // stronger model for extraction precisely because it is likelier to ASK where a
  // faster one INFERS, which is what spec §27 ("never guess when guessing can cause
  // a meaningful mistake") is about. That safeguard was given up by owner decision
  // in favour of Sonnet, so these fixtures are now the thing holding the line: a
  // model returning CONFIRMED on any of them is a real regression, and the
  // comparator fails it because inferenceLevel is compared exactly.
  //
  // Per that decision, the fix for a failure here is a sharper system prompt plus a
  // pinning fixture — not escalating the model tier.
  // ---------------------------------------------------------------------------
  {
    id: "ambiguous-pronoun",
    utterance: "Send it to her tomorrow.",
    expected: { intents: [intent("execution", "Send it to her tomorrow", "UNCERTAIN", { recipient: person("her", "UNCERTAIN"), objectText: "it", time: deterministic("tomorrow") })] },
  },
  {
    id: "known-pronoun",
    utterance: "Remind me at 6 to ask her.",
    expected: { intents: [intent("action", "Remind me at 6 to ask her", "UNCERTAIN", { reminderBody: "ask her", time: deterministic("at 6") })] },
  },
  {
    id: "uncertain-reference",
    utterance: "Move it to later.",
    expected: { intents: [intent("action", "Move it to later", "UNCERTAIN", { objectText: "it", time: relational("later") })] },
  },
  {
    // Ambiguity visible in the utterance itself, unlike ask-two-aruns: the user
    // names the collision out loud, so the extractor has enough to mark it
    // UNCERTAIN without any database context.
    id: "ambiguous-which-arun",
    utterance: "Ask Arun about the poster — I mean the one at MTTN, or maybe Batore.",
    expected: { intents: [intent("action", "Ask Arun about the poster", "UNCERTAIN", { relatedEntity: person("Arun", "UNCERTAIN"), reminderBody: "Ask Arun about the poster" })] },
  },
  {
    // No deadline stated. The model must not invent one; an emitted `time` here is
    // a fabrication, and the comparator rejects it via the exact intent count and
    // the UNCERTAIN level.
    id: "uncertain-missing-deadline",
    utterance: "Barkha said she'd get it to me sometime.",
    expected: { intents: [intent("information", "Barkha said she'd get it to me sometime", "UNCERTAIN", { owner: person("Barkha"), recipient: me, objectText: "it" })] },
  },

  // ---------------------------------------------------------------------------
  // Questions (spec §5 QUESTION)
  // ---------------------------------------------------------------------------
  {
    id: "question-history",
    utterance: "What happened with Barkha's article?",
    expected: { intents: [intent("question", "What happened with Barkha's article", "CONFIRMED", { relatedEntity: person("Barkha"), objectText: "article" })] },
  },
  // ---------------------------------------------------------------------------
  // Inspections (spec §28) — RECLASSIFIED FROM `question`.
  //
  // These three were labelled `question` before the `inspection` kind existed,
  // and they are precisely what §28 asks for: structured state the assistant
  // can answer EXACTLY from a WHERE clause. Leaving them as `question` would
  // have trained the model to decline answerable questions, which is finding
  // F11 showing up in the fixture set rather than in the code.
  //
  // The distinction the model must learn: `inspection` = show me what you
  // already know; `question` = anything else.
  // ---------------------------------------------------------------------------
  {
    id: "inspection-waiting",
    utterance: "What am I waiting on?",
    expected: { intents: [intent("inspection", "What am I waiting on", "CONFIRMED", { recipient: me })] },
  },
  {
    id: "inspection-owes",
    utterance: "What does Barkha owe me?",
    expected: { intents: [intent("inspection", "What does Barkha owe me", "CONFIRMED", { owner: person("Barkha"), recipient: me })] },
  },
  {
    id: "inspection-today",
    utterance: "What do I need to do today?",
    expected: { intents: [intent("inspection", "What do I need to do today", "CONFIRMED", { owner: me, time: deterministic("today") })] },
  },
  {
    id: "inspection-i-owe",
    utterance: "What do I owe Hult?",
    expected: { intents: [intent("inspection", "What do I owe Hult", "CONFIRMED", { owner: me, recipient: org("Hult") })] },
  },
  {
    id: "inspection-about-person",
    utterance: "What do you know about Arun?",
    expected: { intents: [intent("inspection", "What do you know about Arun", "CONFIRMED", { relatedEntity: person("Arun") })] },
  },
  {
    id: "question-person",
    utterance: "Who is Karthik working with?",
    expected: { intents: [intent("question", "Who is Karthik working with", "CONFIRMED", { relatedEntity: person("Karthik") })] },
  },
  {
    id: "question-conflict",
    utterance: "Does my 5 PM call conflict with anything?",
    expected: { intents: [intent("question", "Does my 5 PM call conflict with anything", "CONFIRMED", { objectText: "my 5 PM call", time: deterministic("5 PM") })] },
  },
  {
    id: "question-status",
    utterance: "Is the Hult poster done?",
    expected: { intents: [intent("question", "Is the Hult poster done", "CONFIRMED", { relatedEntity: org("Hult"), objectText: "the Hult poster" })] },
  },

  // ---------------------------------------------------------------------------
  // Execution requests — a request to act, never permission to act (spec §5)
  // ---------------------------------------------------------------------------
  {
    id: "external-execution",
    utterance: "Send Arun this.",
    expected: { intents: [intent("execution", "Send Arun this", "CONFIRMED", { recipient: person("Arun"), objectText: "this" })] },
  },
  {
    id: "execution-calendar",
    utterance: "Create a calendar event for the Hult review tomorrow.",
    expected: { intents: [intent("execution", "Create a calendar event for the Hult review tomorrow", "CONFIRMED", { relatedEntity: org("Hult"), objectText: "a calendar event for the Hult review", time: deterministic("tomorrow") })] },
  },
  {
    id: "execution-email",
    utterance: "Email the poster to Hult.",
    expected: { intents: [intent("execution", "Email the poster to Hult", "CONFIRMED", { recipient: org("Hult"), objectText: "the poster" })] },
  },
  {
    id: "execution-share-drive",
    utterance: "Put the signed contract in Drive.",
    expected: { intents: [intent("execution", "Put the signed contract in Drive", "CONFIRMED", { objectText: "the signed contract" })] },
  },
  {
    id: "execution-schedule-arun",
    utterance: "Schedule Arun at 5 tomorrow.",
    expected: { intents: [intent("execution", "Schedule Arun at 5 tomorrow", "CONFIRMED", { relatedEntity: person("Arun"), objectText: "Schedule Arun", time: deterministic("at 5 tomorrow") })] },
  },

  // ---------------------------------------------------------------------------
  // Multi-intent utterances (one turn, two mutations — DECISIONS.md #4)
  // ---------------------------------------------------------------------------
  {
    id: "multi-commitment-and-reminder-hult",
    utterance: "I owe Hult the poster by Friday. Remind me Thursday to finish it.",
    expected: { intents: [
      intent("information", "I owe Hult the poster by Friday", "CONFIRMED", { owner: me, recipient: org("Hult"), objectText: "the poster", time: deterministic("by Friday") }),
      intent("action", "Remind me Thursday to finish it", "CONFIRMED", { reminderBody: "finish it", time: deterministic("Thursday") }),
    ] },
  },
  {
    id: "multi-completion-and-new-commitment",
    utterance: "Arun sent the schema. Now I need to review it before the standup.",
    expected: { intents: [
      intent("completion_update", "Arun sent the schema", "CONFIRMED", { owner: person("Arun"), recipient: me, objectText: "the schema" }),
      intent("information", "Now I need to review it before the standup", "CONFIRMED", { owner: me, objectText: "it", time: relational("before the standup") }),
    ] },
  },
  {
    id: "multi-question-and-execution",
    utterance: "Is the poster done? If so, email it to Hult.",
    expected: { intents: [
      intent("question", "Is the poster done", "CONFIRMED", { objectText: "the poster" }),
      intent("execution", "If so, email it to Hult", "CONFIRMED", { recipient: org("Hult"), objectText: "it" }),
    ] },
  },
  // ---------------------------------------------------------------------------
  // The six optional fields that make the stranded tools reachable
  // (docs/PLANNER-WIRING-DESIGN.md). Each block pairs POSITIVE cases with the
  // NEGATIVE ones that look like them and must not fire.
  //
  // The negatives are the load-bearing half. Every one of these fields is a way
  // for the model to OVER-trigger, and a field that fires too eagerly looks
  // exactly like a feature working: a spurious memory reads as a good memory
  // until you notice the assistant believes something nobody said.
  // ---------------------------------------------------------------------------

  // --- newStatus -> update_commitment (spec 22) ------------------------------
  {
    id: "status-blocked",
    utterance: "The Hult poster is blocked on Karthik's photos.",
    expected: { intents: [intent("information", "The Hult poster is blocked on Karthik's photos", "CONFIRMED", { owner: me, recipient: org("Hult"), objectText: "The Hult poster", newStatus: "blocked" })] },
  },
  {
    id: "status-waiting-on-someone",
    utterance: "I'm waiting on Barkha for the article.",
    expected: { intents: [intent("information", "I'm waiting on Barkha for the article", "CONFIRMED", { owner: person("Barkha"), recipient: me, objectText: "the article", newStatus: "waiting_on_someone" })] },
  },
  {
    id: "status-cancelled",
    utterance: "Drop the MTTN invoice, they went with someone else.",
    expected: { intents: [intent("information", "Drop the MTTN invoice, they went with someone else", "CONFIRMED", { owner: me, recipient: org("MTTN"), objectText: "the MTTN invoice", newStatus: "cancelled" })] },
  },
  {
    id: "status-in-progress",
    utterance: "I've started on the Hult poster.",
    expected: { intents: [intent("information", "I've started on the Hult poster", "CONFIRMED", { owner: me, recipient: org("Hult"), objectText: "the Hult poster", newStatus: "in_progress" })] },
  },
  {
    // NEGATIVE. "Done" is a completion, and completion has its own path where
    // lateness is DERIVED from two timestamps (PHASE-3-DESIGN 2). A status hint
    // saying "completed" would be a second completion path that skips that
    // derivation, which is why CommitmentStatusHint excludes the value outright
    // -- this fixture asserts the model does not reach for a status anyway.
    id: "negative-done-is-completion-not-status",
    forbids: ["newStatus"],
    utterance: "The poster is done.",
    expected: { intents: [intent("completion_update", "The poster is done", "CONFIRMED", { objectText: "The poster" })] },
  },
  {
    // NEGATIVE. An inspection ASKS about status; it does not set one.
    id: "negative-asking-what-is-blocked",
    forbids: ["newStatus"],
    utterance: "What's blocked right now?",
    expected: { intents: [intent("inspection", "What's blocked right now", "CONFIRMED", {})] },
  },

  // --- memoryBody -> remember (spec 16) --------------------------------------
  {
    id: "memory-preference",
    utterance: "Barkha prefers WhatsApp over email.",
    expected: { intents: [intent("context", "Barkha prefers WhatsApp over email", "CONFIRMED", { relatedEntity: person("Barkha"), memoryBody: "Barkha prefers WhatsApp over email" })] },
  },
  {
    id: "memory-own-preference",
    utterance: "I prefer morning meetings.",
    expected: { intents: [intent("context", "I prefer morning meetings", "CONFIRMED", { memoryBody: "I prefer morning meetings" })] },
  },
  {
    id: "memory-role",
    utterance: "Arun handles the backend.",
    expected: { intents: [intent("context", "Arun handles the backend", "CONFIRMED", { relatedEntity: person("Arun"), memoryBody: "Arun handles the backend" })] },
  },
  {
    // NEGATIVE, and the subtlest one here. "Remember to" is not a request to
    // REMEMBER -- it is the English idiom for "don't let me forget", which is a
    // reminder. A model that pattern-matches the verb stores a fact and sets
    // nothing, and the user never gets the nudge they asked for.
    id: "negative-remember-to-is-a-reminder",
    forbids: ["memoryBody"],
    utterance: "I should probably remember to call her.",
    expected: { intents: [intent("action", "I should probably remember to call her", "UNCERTAIN", { reminderBody: "call her" })] },
  },
  {
    // NEGATIVE. A commitment is not a memory. This has an owner, a recipient and
    // a deadline; storing it as a durable fact would leave it out of the
    // Commitments surface the user relies on to catch mistakes.
    id: "negative-commitment-is-not-a-memory",
    forbids: ["memoryBody"],
    utterance: "Karthik needs to send me the deck by Tuesday.",
    expected: { intents: [intent("information", "Karthik needs to send me the deck by Tuesday", "CONFIRMED", { owner: person("Karthik"), recipient: me, objectText: "the deck", time: deterministic("by Tuesday") })] },
  },

  // --- correctionTarget -> forget_memory / correct_relationship (spec 17) ----
  {
    // A FORGET: one half stated. Nothing replaces what is being dropped.
    id: "forget-arun-backend",
    forbids: ["memoryBody"],
    utterance: "Forget that Arun works on backend.",
    expected: { intents: [intent("context", "Forget that Arun works on backend", "CONFIRMED", { relatedEntity: person("Arun"), correctionTarget: "Arun works on backend" })] },
  },
  {
    // A CORRECTION: both halves stated, which is the ONLY thing distinguishing
    // it from a forget (assistant-contract.ts, correctionTarget). The planner
    // routes on whether memoryBody accompanies correctionTarget.
    id: "correct-backend-owner",
    utterance: "No, Karthik handles backend now, not Arun.",
    expected: { intents: [intent("context", "No, Karthik handles backend now, not Arun", "CONFIRMED", { relatedEntity: person("Karthik"), correctionTarget: "Arun handles backend", memoryBody: "Karthik handles backend" })] },
  },
  {
    id: "correct-wrong-recipient",
    utterance: "Actually the poster goes to MTTN, not Hult.",
    expected: { intents: [intent("context", "Actually the poster goes to MTTN, not Hult", "CONFIRMED", { relatedEntity: org("MTTN"), correctionTarget: "the poster goes to Hult", memoryBody: "the poster goes to MTTN" })] },
  },
  {
    // NEGATIVE, called out by name in PLANNER-WIRING-DESIGN 3.1. Stating a fact
    // for the first time is a remember, not a correction -- there is nothing on
    // record to supersede. A model that corrects here invalidates a row that
    // does not exist, or worse, the wrong one.
    id: "negative-new-fact-is-not-a-correction",
    forbids: ["correctionTarget"],
    utterance: "Karthik handles the frontend.",
    expected: { intents: [intent("context", "Karthik handles the frontend", "CONFIRMED", { relatedEntity: person("Karthik"), memoryBody: "Karthik handles the frontend" })] },
  },
  {
    // NEGATIVE. "No" disagreeing with a SUGGESTION is not a correction of a
    // stored belief. Nothing is on record to invalidate.
    id: "negative-declining-is-not-a-correction",
    forbids: ["correctionTarget"],
    utterance: "No, don't remind me about that.",
    expected: { intents: [intent("context", "No, don't remind me about that", "UNCERTAIN", {})] },
  },

  // --- condition -> create_workflow (spec 25) --------------------------------
  {
    id: "conditional-schema-friday",
    utterance: "If Arun hasn't sent the schema by Friday, remind me.",
    expected: { intents: [intent("action", "If Arun hasn't sent the schema by Friday, remind me", "CONFIRMED", { relatedEntity: person("Arun"), condition: { subjectText: "the schema", deadlinePhrase: "by Friday", action: "remind", actionBody: "Arun hasn't sent the schema" } })] },
  },
  {
    id: "conditional-ask-barkha",
    utterance: "If Barkha hasn't replied by tomorrow morning, ask me whether to chase her.",
    expected: { intents: [intent("action", "If Barkha hasn't replied by tomorrow morning, ask me whether to chase her", "CONFIRMED", { relatedEntity: person("Barkha"), condition: { subjectText: "Barkha's reply", deadlinePhrase: "by tomorrow morning", action: "ask", actionBody: "whether to chase her" } })] },
  },
  {
    // NEGATIVE. "If so" chains two intents within one turn; it does not create a
    // standing rule. The difference is DURABILITY -- a workflow outlives the
    // turn and keeps evaluating, so one created here would fire forever.
    id: "negative-if-so-is-not-a-workflow",
    forbids: ["condition"],
    utterance: "Is the deck ready? If so, send it to Karthik.",
    expected: { intents: [
      intent("question", "Is the deck ready", "CONFIRMED", { objectText: "the deck" }),
      intent("execution", "If so, send it to Karthik", "CONFIRMED", { recipient: person("Karthik"), objectText: "it" }),
    ] },
  },

  // --- entityTypeDefinition -> define_entity_type (spec 36) -----------------
  {
    // The user's own headline requirement, and the Phase 5 demo utterance: a
    // type invented mid-conversation must appear in the UI with no deploy.
    id: "define-gym-sessions",
    forbids: ["entityRecord"],
    utterance: "Track my gym sessions with a date and a duration.",
    expected: { intents: [intent("action", "Track my gym sessions with a date and a duration", "CONFIRMED", { entityTypeDefinition: { typeKey: "gym_session", displayName: "Gym Sessions", fields: [
      { fieldKey: "date", fieldKind: "date", label: "Date", required: true },
      { fieldKey: "duration", fieldKind: "number", label: "Duration", required: false },
    ] } })] },
  },
  {
    id: "define-book-log",
    forbids: ["entityRecord"],
    utterance: "Start tracking books I read, with a title and whether I finished it.",
    expected: { intents: [intent("action", "Start tracking books I read, with a title and whether I finished it", "CONFIRMED", { entityTypeDefinition: { typeKey: "book", displayName: "Books", fields: [
      { fieldKey: "title", fieldKind: "text", label: "Title", required: true },
      { fieldKey: "finished", fieldKind: "bool", label: "Finished", required: false },
    ] } })] },
  },
  {
    // NEGATIVE. A statement of habit is a durable fact, not a request for
    // structure. A junk type is capped and reversible but clutters the UI
    // persistently (PLANNER-WIRING-DESIGN 2), and nobody asked for a table.
    id: "negative-habit-is-not-a-type-definition",
    forbids: ["entityTypeDefinition"],
    utterance: "I go to the gym on Tuesdays.",
    expected: { intents: [intent("context", "I go to the gym on Tuesdays", "CONFIRMED", { memoryBody: "I go to the gym on Tuesdays" })] },
  },
  {
    // NEGATIVE. "Keep track of" one SPECIFIC thing is a commitment, not a new
    // kind of thing. The tell is that it names one object, not a category.
    id: "negative-track-one-thing-is-a-commitment",
    forbids: ["entityTypeDefinition"],
    utterance: "Keep track of the Hult poster for me.",
    expected: { intents: [intent("information", "Keep track of the Hult poster for me", "CONFIRMED", { owner: me, recipient: org("Hult"), objectText: "the Hult poster" })] },
  },

  // --- entityRecord -> create_entity_record (spec 36) ------------------------
  {
    id: "log-gym-session",
    forbids: ["entityTypeDefinition"],
    utterance: "Log a 45 minute gym session today.",
    expected: { intents: [intent("action", "Log a 45 minute gym session today", "CONFIRMED", { time: deterministic("today"), entityRecord: { typeKey: "gym_session", values: { duration: "45", date: "today" } } })] },
  },
  {
    id: "log-book-finished",
    forbids: ["entityTypeDefinition"],
    utterance: "Add Dune to my books, finished.",
    expected: { intents: [intent("action", "Add Dune to my books, finished", "CONFIRMED", { entityRecord: { typeKey: "book", values: { title: "Dune", finished: "true" } } })] },
  },
  {
    // NEGATIVE, and UNCERTAIN on purpose. Adding a FIELD to an existing type is
    // add_entity_field, which has no contract field yet -- so the honest label
    // is "this needs clarification", not a confident record. Recorded so the
    // gap is visible in the eval set rather than discovered when a user says it.
    id: "negative-adding-a-field-is-not-a-record",
    forbids: ["entityRecord"],
    utterance: "Also track which gym I went to.",
    expected: { intents: [intent("action", "Also track which gym I went to", "UNCERTAIN", { entityTypeDefinition: { typeKey: "gym_session", displayName: "Gym Sessions", fields: [
      { fieldKey: "gym", fieldKind: "text", label: "Gym", required: false },
    ] } })] },
  },
];

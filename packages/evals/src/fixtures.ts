import type { Extraction, ExtractedIntent, IntentKind, InferenceLevel, EntityMention } from "@ourglass/shared";

export interface ExtractionFixture {
  readonly id: string;
  readonly utterance: string;
  readonly expected: Extraction;
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
  {
    id: "question-waiting",
    utterance: "What am I waiting on?",
    expected: { intents: [intent("question", "What am I waiting on", "CONFIRMED", { recipient: me })] },
  },
  {
    id: "question-owes",
    utterance: "What does Barkha owe me?",
    expected: { intents: [intent("question", "What does Barkha owe me", "CONFIRMED", { owner: person("Barkha"), recipient: me })] },
  },
  {
    id: "question-today",
    utterance: "What do I need to do today?",
    expected: { intents: [intent("question", "What do I need to do today", "CONFIRMED", { owner: me, time: deterministic("today") })] },
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
];

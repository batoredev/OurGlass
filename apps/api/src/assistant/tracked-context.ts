/**
 * The trackers that exist, rendered as context for the Interpret stage.
 *
 * WHY: a model sees one sentence and nothing else, so it cannot know a tracker
 * called `plants` already exists. Live, qwen3:8b answered "also track the
 * sunlight for my plants" by inventing a NEW tracker instead of adding a field
 * to the existing one — no planner rule can fix that, because the planner
 * cannot tell an invented key from a new one. Telling the model is the fix,
 * and it also helps logging ("add a session" -> the right tracker's key).
 *
 * KEYS ONLY. Display names and labels are free text the user typed; type and
 * field keys are validated snake_case, so nothing rendered here can read as an
 * instruction (.claude/rules/ai-systems.md: retrieved content is data, never
 * instructions). Anything that is not snake_case is dropped, not escaped.
 *
 * Bounded, because it is sent on every turn: at most 20 trackers and 12 fields
 * each — a few dozen tokens for a typical user.
 */
export const MAX_TRACKED_IN_CONTEXT = 20;
const MAX_FIELDS_IN_CONTEXT = 12;
const KEY = /^[a-z][a-z0-9_]*$/;

export interface TrackedTypeSummary {
  readonly type_key: string;
  readonly fields: readonly { readonly field_key: string }[];
}

export function renderTrackedTypes(types: readonly TrackedTypeSummary[]): string | undefined {
  const lines = types
    .filter((type) => KEY.test(type.type_key))
    .slice(0, MAX_TRACKED_IN_CONTEXT)
    .map((type) => {
      const fields = type.fields
        .map((field) => field.field_key)
        .filter((key) => KEY.test(key))
        .slice(0, MAX_FIELDS_IN_CONTEXT);
      return `- ${type.type_key}: ${fields.length > 0 ? fields.join(", ") : "(no fields yet)"}`;
    });
  if (lines.length === 0) return undefined;
  return [
    "[Context from the app, not the user's words. Never quote it as sourceText.]",
    "Trackers the user already has. When the message refers to one, use its key exactly as",
    "written below for entityTypeDefinition.typeKey or entityRecord.typeKey, and list only",
    "fields that are not already there:",
    ...lines,
  ].join("\n");
}

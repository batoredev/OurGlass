/**
 * add_to_google_calendar — the first tool that reaches outside OurGlass (§34).
 *
 * EXTERNAL_ACTION, so the §35 gate HOLDS it for confirmation unless the user
 * has granted "always allow" for this action in Settings. Planned alongside
 * create_event (orchestrator planEvent) and only when an account is connected.
 *
 * INVERTIBILITY 'none', honestly: undoing the turn cannot unsend a calendar
 * invite from Google, so undo refuses the turn rather than pretending. The
 * user deletes it in Google Calendar.
 *
 * The Google call happens inside commit, inside the turn's transaction. If
 * Google refuses, the whole turn rolls back — the meeting is not half-saved
 * with a calendar copy that does not exist.
 */
import type { Result, ToolContext, ToolDefinition, ToolError } from "@ourglass/shared";
import { err, ok } from "@ourglass/shared";
import { events, googleAccounts } from "@ourglass/db";
import {
  accessToken,
  decryptToken,
  insertEvent,
  type FetchFn,
  type GoogleOAuthConfig,
} from "../integrations/google-calendar.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Input {
  readonly eventId: string;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly refreshTokenEnc: string;
  readonly timeZone: string;
}

export function createAddToGoogleCalendarTool(
  config: GoogleOAuthConfig | null,
  fetchFn: FetchFn = (input, init) => fetch(input, init),
): ToolDefinition<Input, { googleEventId: string }> {
  return {
    name: "add_to_google_calendar",
    description:
      "Put a scheduled event on the user's Google Calendar. External: confirmed unless the user allowed it.",
    async validate(raw: unknown, ctx: ToolContext): Promise<Result<Input, ToolError[]>> {
      const input = (raw ?? {}) as {
        event_id?: unknown;
        title?: unknown;
        starts_at?: unknown;
        ends_at?: unknown;
        time_zone?: unknown;
      };
      const errors: ToolError[] = [];
      if (!config) {
        errors.push({ code: "not_configured", message: "Google Calendar isn't set up on the server." });
      }
      if (typeof input.event_id !== "string" || !UUID_RE.test(input.event_id)) {
        errors.push({ field: "event_id", code: "invalid_uuid", message: "event_id must be the event's UUID." });
      }
      if (typeof input.title !== "string" || input.title.trim() === "") {
        errors.push({ field: "title", code: "missing_title", message: "title is required." });
      }
      if (typeof input.starts_at !== "string" || Number.isNaN(Date.parse(input.starts_at))) {
        errors.push({ field: "starts_at", code: "invalid_instant", message: "starts_at must be an ISO-8601 instant." });
      }
      const endsAt =
        typeof input.ends_at === "string" && !Number.isNaN(Date.parse(input.ends_at)) ? input.ends_at : null;
      // The user's IANA zone, from the planner (users.timezone), so Google
      // shows the meeting at the time the user said.
      if (typeof input.time_zone !== "string" || input.time_zone.trim() === "") {
        errors.push({ field: "time_zone", code: "missing_time_zone", message: "time_zone is required." });
      }
      const account = await googleAccounts.get(ctx.tx);
      if (!account) {
        errors.push({ code: "not_connected", message: "Google Calendar isn't connected — connect it in Settings." });
      }
      if (errors.length > 0 || !account) return err(errors);
      return ok({
        eventId: input.event_id as string,
        title: (input.title as string).trim(),
        startsAt: input.starts_at as string,
        endsAt,
        refreshTokenEnc: account.refresh_token_enc,
        timeZone: input.time_zone as string,
      });
    },
    async commit(input: Input, ctx: ToolContext) {
      // Unreachable without config — validate refused — but the type needs it.
      if (!config) throw new Error("Google Calendar isn't configured");
      const refreshToken = await decryptToken(input.refreshTokenEnc, config.clientSecret);
      const token = await accessToken(config, refreshToken, fetchFn);
      const googleEventId = await insertEvent(
        token,
        { title: input.title, startsAt: input.startsAt, endsAt: input.endsAt, timeZone: input.timeZone },
        fetchFn,
      );
      await events.setGoogleEventId(ctx.tx, input.eventId, googleEventId);
      return {
        output: { googleEventId },
        mutations: [
          {
            targetTable: "events",
            targetId: input.eventId,
            forwardPatch: { googleEventId },
            inversePatch: null,
            invertibility: "none" as const,
          },
        ],
      };
    },
  };
}

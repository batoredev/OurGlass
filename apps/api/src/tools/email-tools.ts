/**
 * Email (§34): send_email, and set_person_email for the address it needs.
 *
 * send_email is HIGH_IMPACT_ACTION: the §35 policy ALWAYS confirms it and
 * refuses a standing "allow" — the owner's 2026-09-24 decision ("send, after
 * confirming each one"). An email cannot be unsent, so it is held as a draft
 * the user reads, edits and sends; invertibility is honestly 'none'.
 *
 * set_person_email is an ordinary reversible write: "Moorthy's email is …",
 * or the address typed once into a draft card.
 */
import type { Result, ToolContext, ToolDefinition, ToolError } from "@ourglass/shared";
import { err, ok } from "@ourglass/shared";
import { googleAccounts, people, sentEmails } from "@ourglass/db";
import {
  accessToken,
  canSendEmail,
  decryptToken,
  sendEmail,
  type FetchFn,
  type GoogleOAuthConfig,
} from "../integrations/google-calendar.js";
import { registerInverseHandler } from "./inverses.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The same shape migration 016 enforces on people.email. */
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_BODY = 20_000;

// ---- send_email ---------------------------------------------------------------

interface SendInput {
  readonly personId: string | null;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly refreshTokenEnc: string;
}

export function createSendEmailTool(
  config: GoogleOAuthConfig | null,
  fetchFn: FetchFn = (input, init) => fetch(input, init),
): ToolDefinition<SendInput, { messageId: string }> {
  return {
    name: "send_email",
    description: "Send an email from the user's Gmail. Always confirmed by the user first.",
    async validate(raw: unknown, ctx: ToolContext): Promise<Result<SendInput, ToolError[]>> {
      const input = (raw ?? {}) as { person_id?: unknown; to?: unknown; subject?: unknown; body?: unknown };
      const errors: ToolError[] = [];
      if (!config) errors.push({ code: "not_configured", message: "Google isn't set up on the server." });
      const to = typeof input.to === "string" ? input.to.trim() : "";
      if (!EMAIL_RE.test(to)) {
        errors.push({ field: "to", code: "invalid_email", message: "Add a valid email address for this person." });
      }
      const subject = typeof input.subject === "string" ? input.subject.trim() : "";
      if (subject === "") errors.push({ field: "subject", code: "missing_subject", message: "Add a subject." });
      const body = typeof input.body === "string" ? input.body.trim() : "";
      if (body === "") errors.push({ field: "body", code: "missing_body", message: "The email is empty." });
      if (body.length > MAX_BODY) errors.push({ field: "body", code: "too_long", message: "That email is too long." });
      if (input.person_id !== null && input.person_id !== undefined) {
        if (typeof input.person_id !== "string" || !UUID_RE.test(input.person_id)) {
          errors.push({ field: "person_id", code: "invalid_uuid", message: "person_id must be a UUID." });
        }
      }
      const account = await googleAccounts.get(ctx.tx);
      if (!account) {
        errors.push({ code: "not_connected", message: "Google isn't connected — connect it in Settings." });
      } else if (!canSendEmail(account.scope)) {
        errors.push({
          code: "no_gmail_permission",
          message: "Gmail sending isn't allowed yet — reconnect Google in Settings and tick the Gmail permission.",
        });
      }
      if (errors.length > 0 || !account) return err(errors);
      return ok({
        personId: (input.person_id as string | null | undefined) ?? null,
        to,
        subject,
        body,
        refreshTokenEnc: account.refresh_token_enc,
      });
    },
    async commit(input: SendInput, ctx: ToolContext) {
      if (!config) throw new Error("Google isn't configured");
      const token = await accessToken(config, await decryptToken(input.refreshTokenEnc, config.clientSecret), fetchFn);
      const messageId = await sendEmail(token, { to: input.to, subject: input.subject, body: input.body }, fetchFn);
      const row = await sentEmails.record(ctx.tx, {
        personId: input.personId,
        to: input.to,
        subject: input.subject,
        body: input.body,
        gmailMessageId: messageId,
      });
      return {
        output: { messageId },
        mutations: [
          {
            targetTable: "sent_emails",
            targetId: row.id,
            forwardPatch: { to: input.to, subject: input.subject },
            inversePatch: null,
            invertibility: "none" as const,
          },
        ],
      };
    },
  };
}

// ---- set_person_email ---------------------------------------------------------

export const setPersonEmailTool: ToolDefinition<{ personId: string; email: string }, { email: string }> = {
  name: "set_person_email",
  description: "Remember a person's email address.",
  async validate(raw: unknown, ctx: ToolContext) {
    const input = (raw ?? {}) as { person_id?: unknown; email?: unknown };
    if (typeof input.person_id !== "string" || !UUID_RE.test(input.person_id)) {
      return err([{ field: "person_id", code: "invalid_uuid", message: "person_id must be a UUID." }]);
    }
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(email)) {
      return err([{ field: "email", code: "invalid_email", message: "That isn't a valid email address." }]);
    }
    // resolvePersonId follows a merge to the survivor. A person created earlier
    // in this turn already exists here: the executor commits each call before
    // validating the next (executor.ts header).
    const personId = await people.resolvePersonId(ctx.tx, input.person_id);
    if (personId === null) {
      return err([{ field: "person_id", code: "unknown_person", message: "That person no longer exists." }]);
    }
    return ok({ personId, email });
  },
  async commit(input, ctx) {
    const previous = await people.setEmail(ctx.tx, input.personId, input.email);
    return {
      output: { email: input.email },
      mutations: [
        {
          targetTable: "people_email",
          targetId: input.personId,
          forwardPatch: { email: input.email },
          inversePatch: { previous },
          invertibility: "full" as const,
        },
      ],
    };
  },
};

// Its own inverse table name: "people" already has create_person's handler.
registerInverseHandler("people_email", async (tx, targetId, inversePatch) => {
  if (!targetId) return;
  const previous = (inversePatch as { previous?: unknown } | null)?.previous;
  await people.setEmail(tx, targetId, typeof previous === "string" ? previous : null);
});

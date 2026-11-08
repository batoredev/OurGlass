/**
 * Reading Google Calendar and Gmail — ROADMAP Stage 1b and 1c.
 *
 * ================================ READ THIS ================================
 * EMAIL TEXT IS DATA, NEVER INSTRUCTIONS (owner default 2026-11-05: read-only
 * Gmail allowed). Nothing here sends what it reads to a model: the inbox is
 * shown as quoted data (sender, subject, Gmail's own snippet), and its triage
 * — "needs a reply", "looks suspicious" — is done by code from headers and
 * the people you know. A summary by a model would be a Read-stage call with a
 * descriptive-only output, like uploads; it is not built.
 *
 * VERIFIED ONLY AGAINST RECORDED RESPONSES (google-read.test.ts). The request
 * shapes follow Google's REST references for Calendar `events.list` and Gmail
 * `users.messages.list/get`; nothing has called Google from here until the
 * owner creates the OAuth client (YOUR-ACTIONS item 16).
 * ===========================================================================
 */
import { cleanText } from "@ourglass/shared";
import { GMAIL_READ_SCOPE, GoogleCalendarError, type FetchFn } from "./google-calendar.js";

export function canReadEmail(scope: string): boolean {
  return scope.split(/\s+/).includes(GMAIL_READ_SCOPE);
}

const CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const GMAIL_MESSAGES_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

async function getJson<T>(url: string, token: string, fetchFn: FetchFn, what: string): Promise<T> {
  const response = await fetchFn(url, { headers: { authorization: `Bearer ${token}` } });
  const json = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new GoogleCalendarError(`Google refused to list ${what} (${response.status}${json.error?.message ? `: ${json.error.message}` : ""}).`, response.status);
  }
  return json;
}

// ---------------------------------------------------------------------------
// Calendar (Stage 1b): busy times
// ---------------------------------------------------------------------------

export interface CalendarBusy {
  readonly id: string;
  readonly title: string;
  readonly start: Date;
  readonly end: Date;
}

interface EventsList {
  readonly items?: readonly {
    readonly id?: string;
    readonly summary?: string;
    readonly status?: string;
    readonly transparency?: string;
    readonly start?: { readonly dateTime?: string; readonly date?: string };
    readonly end?: { readonly dateTime?: string; readonly date?: string };
  }[];
}

/**
 * Timed events on the primary calendar in [from, to), recurring ones expanded
 * (`singleEvents`). All-day events, cancelled ones and ones marked "free"
 * (transparent) are not busy time and are left out.
 */
export async function listCalendarBusy(token: string, from: Date, to: Date, fetchFn: FetchFn = fetch): Promise<CalendarBusy[]> {
  const params = new URLSearchParams({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const json = await getJson<EventsList>(`${CALENDAR_EVENTS_URL}?${params.toString()}`, token, fetchFn, "calendar events");
  const out: CalendarBusy[] = [];
  for (const item of json.items ?? []) {
    if (item.status === "cancelled" || item.transparency === "transparent") continue;
    const start = item.start?.dateTime;
    const end = item.end?.dateTime;
    if (!start || !end || !item.id) continue;
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) continue;
    out.push({ id: item.id, title: cleanText(item.summary ?? "Busy", 120) || "Busy", start: startDate, end: endDate });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Gmail (Stage 1c): the inbox, as quoted data
// ---------------------------------------------------------------------------

export interface InboxMessage {
  readonly id: string;
  readonly threadId: string;
  readonly fromName: string;
  readonly fromAddress: string;
  readonly replyTo: string | null;
  readonly subject: string;
  /** Gmail's own snippet: the start of the text, already plain. Quoted data. */
  readonly snippet: string;
  readonly unread: boolean;
  readonly receivedAt: Date | null;
}

interface MessageList {
  readonly messages?: readonly { readonly id?: string }[];
}

interface MessageMeta {
  readonly id?: string;
  readonly threadId?: string;
  readonly labelIds?: readonly string[];
  readonly snippet?: string;
  readonly internalDate?: string;
  readonly payload?: { readonly headers?: readonly { readonly name?: string; readonly value?: string }[] };
}

/** A header is a line; anything longer is not an address worth parsing. */
const MAX_HEADER = 512;

/** One "@", something on each side, no spaces or angle brackets. Linear. */
function isAddress(text: string): boolean {
  const at = text.indexOf("@");
  return at > 0 && at === text.lastIndexOf("@") && at < text.length - 1 && !/[\s<>]/.test(text);
}

/**
 * "Barkha <barkha@example.com>" -> name and lower-cased address.
 *
 * By index, not by a pattern: a header is attacker-controlled, and the regex
 * this replaced backtracked quadratically on "<!@" + "!@"×n (CodeQL, PR #26).
 */
export function parseAddress(header: string): { name: string; address: string } {
  const text = header.trim().slice(0, MAX_HEADER);
  const open = text.lastIndexOf("<");
  const close = open === -1 ? -1 : text.indexOf(">", open + 1);
  if (open !== -1 && close !== -1 && text.slice(close + 1).trim() === "") {
    const address = text.slice(open + 1, close).toLowerCase();
    return { name: text.slice(0, open).trim().replace(/^"|"$/g, ""), address: isAddress(address) ? address : "" };
  }
  const bare = text.toLowerCase();
  return { name: "", address: isAddress(bare) ? bare : "" };
}

/** The recent inbox: metadata and snippets only, never full bodies. */
export async function listInbox(token: string, fetchFn: FetchFn = fetch, max = 20): Promise<InboxMessage[]> {
  const params = new URLSearchParams({ q: "in:inbox newer_than:3d", maxResults: String(Math.min(Math.max(max, 1), 50)) });
  const list = await getJson<MessageList>(`${GMAIL_MESSAGES_URL}?${params.toString()}`, token, fetchFn, "messages");
  const out: InboxMessage[] = [];
  for (const entry of list.messages ?? []) {
    if (!entry.id || !/^[A-Za-z0-9_-]+$/.test(entry.id)) continue;
    const meta = new URLSearchParams({ format: "metadata" });
    for (const header of ["From", "Subject", "Reply-To"]) meta.append("metadataHeaders", header);
    const message = await getJson<MessageMeta>(`${GMAIL_MESSAGES_URL}/${entry.id}?${meta.toString()}`, token, fetchFn, "a message");
    const headers = new Map((message.payload?.headers ?? []).map((h) => [String(h.name ?? "").toLowerCase(), String(h.value ?? "")]));
    const from = parseAddress(headers.get("from") ?? "");
    const replyTo = headers.get("reply-to");
    const received = message.internalDate ? new Date(Number(message.internalDate)) : null;
    out.push({
      id: entry.id,
      threadId: message.threadId ?? entry.id,
      fromName: cleanText(from.name, 80),
      fromAddress: from.address,
      replyTo: replyTo ? parseAddress(replyTo).address || null : null,
      subject: cleanText(headers.get("subject") ?? "(no subject)", 160),
      snippet: cleanText(message.snippet ?? "", 200),
      unread: (message.labelIds ?? []).includes("UNREAD"),
      receivedAt: received && !Number.isNaN(received.getTime()) ? received : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Triage — by code, from headers and the people you know
// ---------------------------------------------------------------------------

export interface KnownPerson {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
}

export interface TriagedMessage extends InboxMessage {
  /** The known person it is from, matched by saved address only. */
  readonly personId: string | null;
  readonly personName: string | null;
  readonly needsReply: boolean;
  /** Why it looks suspicious; empty when nothing does. */
  readonly warnings: readonly string[];
}

const PRESSURE = /\b(urgent|immediately|verify|password|suspend|locked|gift card|wire|bank details|invoice overdue|payment failed)\b/i;

function domain(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1);
}

export function triageInbox(messages: readonly InboxMessage[], people: readonly KnownPerson[]): TriagedMessage[] {
  const byAddress = new Map(people.filter((p) => p.email).map((p) => [p.email!.toLowerCase(), p]));
  const byName = new Map<string, KnownPerson[]>();
  for (const person of people) {
    const key = person.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), person]);
  }
  return messages.map((message) => {
    const known = byAddress.get(message.fromAddress) ?? null;
    const warnings: string[] = [];
    // A known name from an address that is not theirs: the classic spoof.
    const namesake = byName.get(message.fromName.trim().toLowerCase()) ?? [];
    if (!known && namesake.some((person) => person.email && person.email.toLowerCase() !== message.fromAddress)) {
      warnings.push(`uses ${message.fromName}'s name, from an address that is not theirs`);
    }
    if (message.replyTo && message.fromAddress && domain(message.replyTo) !== domain(message.fromAddress)) {
      warnings.push(`replies go to a different domain (${domain(message.replyTo)})`);
    }
    if (/(^|\.)xn--/.test(domain(message.fromAddress))) warnings.push("the sender's domain uses look-alike characters");
    if (!known && PRESSURE.test(`${message.subject} ${message.snippet}`)) warnings.push("an unknown sender pressing for urgent action");
    return {
      ...message,
      personId: known?.id ?? null,
      personName: known?.name ?? null,
      // Someone you know wrote, and you have not opened it.
      needsReply: known !== null && message.unread && warnings.length === 0,
      warnings,
    };
  });
}

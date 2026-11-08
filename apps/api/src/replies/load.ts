/** The owner's email style for one recipient, from what is stored (ROADMAP Stage 4). */
import { sentEmails } from "@ourglass/db";
import type { DatabaseTransaction } from "@ourglass/shared";
import { styleFor, type EmailStyle } from "./style.js";

export async function recipientStyle(tx: DatabaseTransaction, personId: string | null, recipientName: string): Promise<EmailStyle> {
  const { rows } = await tx.query<{ id: string; display_name: string }>(`SELECT id, display_name FROM people_current`);
  const names = new Map(rows.map((row) => [row.id, row.display_name]));
  const toThem = personId ? (await sentEmails.listForPerson(tx, personId, 10)).map((email) => ({ body: email.body, recipientName })) : [];
  const toEveryone = (await sentEmails.listRecent(tx, 20)).map((email) => ({
    body: email.body,
    recipientName: (email.person_id ? names.get(email.person_id) : undefined) ?? "",
  }));
  return styleFor(toThem, toEveryone);
}

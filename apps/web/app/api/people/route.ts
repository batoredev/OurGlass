/** GET /api/people — §29. Read-only. */
import { NextResponse } from "next/server";
import { people, users } from "@ourglass/db";
import { authorize } from "../_auth";
import { read } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;

  // `selfPersonId` is what lets a surface say "Barkha owes YOU" rather than
  // printing two UUIDs. Ownership direction is the product's differentiator
  // (§7), so the UI must be able to tell which side is the account holder.
  const [list, account] = await read(async (tx) => [
    await people.list(tx),
    await users.currentAccount(tx),
  ]);

  return NextResponse.json({ people: list, selfPersonId: account?.self?.id ?? null });
}

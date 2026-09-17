/**
 * The §35 control plane, from the browser — PHASE-7-PERMISSIONS-DESIGN §6.
 *
 * ┌─ THE ONLY UI-INITIATED ACTIONS, AND WHY THEY EXIST ────────────────────┐
 * │ `lib/api.ts` is read-only and must stay so: state changes by talking   │
 * │ to the assistant. These four are the deliberate exception, because    │
 * │ they are exactly what the model must NEVER issue — a grant a model     │
 * │ could propose is a grant a prompt-injected document could propose.     │
 * │                                                                        │
 * │ They are not a second write path: each route runs a tool through the  │
 * │ validated executor, so every change is logged and undoable.            │
 * └────────────────────────────────────────────────────────────────────────┘
 */

export interface ControlResult {
  readonly ok: boolean;
  /** A message a person can act on, when it did not work. */
  readonly message: string | null;
}

async function send(path: string, init: RequestInit): Promise<ControlResult> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      // JSON always: the routes refuse anything else, which is what stops an
      // HTML form on another site from reaching them.
      headers: { "content-type": "application/json" },
    });
  } catch (error: unknown) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  if (response.ok) return { ok: true, message: null };

  const body = (await response.json().catch(() => null)) as {
    error?: string;
    errors?: { message: string }[];
  } | null;
  const message =
    body?.errors?.map((error) => error.message).join(" ") ??
    body?.error ??
    `Request failed (${response.status}).`;
  return { ok: false, message };
}

export function setPermission(
  actionType: string,
  decision: "allow" | "confirm",
): Promise<ControlResult> {
  return send("/api/permissions", {
    method: "POST",
    body: JSON.stringify({ action_type: actionType, decision }),
  });
}

export function revokePermission(actionType: string): Promise<ControlResult> {
  return send(`/api/permissions?action_type=${encodeURIComponent(actionType)}`, {
    method: "DELETE",
  });
}

export function confirmPendingAction(id: string): Promise<ControlResult> {
  return send(`/api/pending-actions/${encodeURIComponent(id)}/confirm`, {
    method: "POST",
    body: "{}",
  });
}

export function declinePendingAction(id: string): Promise<ControlResult> {
  return send(`/api/pending-actions/${encodeURIComponent(id)}/decline`, {
    method: "POST",
    body: "{}",
  });
}

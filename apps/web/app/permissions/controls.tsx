"use client";

/**
 * The buttons on the Permissions page. Client components only because a click
 * needs a handler; the data they act on is rendered by the server page.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  confirmPendingAction,
  declinePendingAction,
  revokePermission,
  setPermission,
  type ControlResult,
} from "../../lib/control";
import type { ActionType } from "../../lib/api";

function useControl() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const run = (action: () => Promise<ControlResult>) => {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        // Re-render the server page so the lists show what actually happened.
        router.refresh();
      } else {
        setMessage(result.message);
      }
    });
  };
  return { pending, message, run };
}

function ErrorLine({ message }: { message: string | null }) {
  return message ? <span style={{ color: "#b00", marginLeft: "0.5rem" }}>{message}</span> : null;
}

export function PendingActionButtons({ id }: { id: string }) {
  const { pending, message, run } = useControl();
  return (
    <span>
      <button type="button" disabled={pending} onClick={() => run(() => confirmPendingAction(id))}>
        Approve
      </button>{" "}
      <button type="button" disabled={pending} onClick={() => run(() => declinePendingAction(id))}>
        Decline
      </button>
      <ErrorLine message={message} />
    </span>
  );
}

export function RevokeButton({ actionType }: { actionType: string }) {
  const { pending, message, run } = useControl();
  return (
    <span>
      <button type="button" disabled={pending} onClick={() => run(() => revokePermission(actionType))}>
        Revoke
      </button>
      <ErrorLine message={message} />
    </span>
  );
}

export function SetPermissionForm({ actionTypes }: { actionTypes: readonly ActionType[] }) {
  const { pending, message, run } = useControl();
  const [actionType, setActionType] = useState(actionTypes[0]?.name ?? "");
  const [decision, setDecision] = useState<"allow" | "confirm">("confirm");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run(() => setPermission(actionType, decision));
      }}
      style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}
    >
      <label>
        Action{" "}
        <select value={actionType} onChange={(event) => setActionType(event.target.value)}>
          {actionTypes.map((type) => (
            <option key={type.name} value={type.name}>
              {type.name} ({type.risk})
            </option>
          ))}
        </select>
      </label>
      <label>
        Rule{" "}
        <select
          value={decision}
          onChange={(event) => setDecision(event.target.value as "allow" | "confirm")}
        >
          <option value="confirm">Always ask me first</option>
          <option value="allow">Always allow</option>
        </select>
      </label>
      <button type="submit" disabled={pending || actionType === ""}>
        Save
      </button>
      <ErrorLine message={message} />
    </form>
  );
}

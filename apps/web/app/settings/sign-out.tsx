"use client";

/** Clears the session cookie and returns to the sign-in page. */
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      className="secondary-button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void fetch("/api/session", { method: "DELETE" }).then(() => {
          router.push("/login");
          router.refresh();
        });
      }}
    >
      Sign out
    </button>
  );
}

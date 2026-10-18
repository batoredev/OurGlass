"use client";

/** Forgets the access token on this browser and returns to the sign-in page. */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { clearToken } from "../../lib/session";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      className="secondary-button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        clearToken();
        router.push("/login");
      }}
    >
      Sign out
    </button>
  );
}

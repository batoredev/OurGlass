/**
 * apiFetch's sign-in rule: a 401 from a data call sends the browser to /login
 * and drops the token that no longer works; sign-in's own 401 does not, so the
 * form can say the token was wrong.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./session";

const replace = vi.fn<(url: string) => void>();
const store = new Map<string, string>();

beforeEach(() => {
  replace.mockReset();
  store.clear();
  store.set("og_access_token", "old-token");
  vi.stubGlobal("window", {
    location: { pathname: "/today", replace },
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

function respondWith(status: number) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status })));
}

describe("apiFetch", () => {
  it("sends a signed-out browser to /login and drops the dead token", async () => {
    respondWith(401);
    const response = await apiFetch("/api/today");
    expect(response.status).toBe(401);
    expect(replace).toHaveBeenCalledWith("/login");
    expect(store.has("og_access_token")).toBe(false);
  });

  it("leaves sign-in's own 401 to the form", async () => {
    respondWith(401);
    await apiFetch("/api/session", { method: "POST" });
    expect(replace).not.toHaveBeenCalled();
    expect(store.get("og_access_token")).toBe("old-token");
  });

  it("does not redirect from the sign-in page itself", async () => {
    respondWith(401);
    (window.location as { pathname: string }).pathname = "/login";
    await apiFetch("/api/today");
    expect(replace).not.toHaveBeenCalled();
  });

  it("passes every other answer through untouched", async () => {
    respondWith(200);
    const response = await apiFetch("/api/today");
    expect(response.status).toBe(200);
    expect(replace).not.toHaveBeenCalled();
  });
});

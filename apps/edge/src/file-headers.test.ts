/**
 * The sandbox CSP on uploaded files — pinned (Phase 6 security review, test
 * gap a). An uploaded HTML or SVG file opened from /api/documents/:id/file
 * must get no origin, no scripts and no access to the API. The header is set
 * by router.ts for that path, on EVERY answer (a refusal included), so this
 * runs the real router with the API closed: no database, no token.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handle } from "./router";

const ID = "6f1fa3cb-3d16-45bf-9105-c16f89c611aa";
const SANDBOX = "sandbox; default-src 'none'; img-src 'self'";

describe("GET /api/documents/:id/file headers", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = {
      OURGLASS_ACCESS_TOKEN: process.env["OURGLASS_ACCESS_TOKEN"],
      ENABLE_DEMO_ENDPOINT: process.env["ENABLE_DEMO_ENDPOINT"],
    };
    delete process.env["OURGLASS_ACCESS_TOKEN"];
    delete process.env["ENABLE_DEMO_ENDPOINT"];
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it.each([`/api/documents/${ID}/file`, `/functions/v1/api/documents/${ID}/file`])(
    "%s is sandboxed and nosniff",
    async (path) => {
      const response = await handle(new Request(`https://example.supabase.co${path}`));
      expect(response.status).toBe(404); // closed: no token configured
      expect(response.headers.get("content-security-policy")).toBe(SANDBOX);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    },
  );

  it("does not put the file CSP on other routes", async () => {
    const response = await handle(new Request("https://example.supabase.co/api/documents"));
    expect(response.headers.get("content-security-policy")).toBeNull();
  });
});

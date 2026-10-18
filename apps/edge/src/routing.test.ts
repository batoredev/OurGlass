import { describe, expect, it } from "vitest";
import { allowedOrigins, isAllowedOrigin, rejectCrossSite } from "../app/api/_http";
import { routePath } from "./route-path";

describe("routePath", () => {
  it("accepts the path as the function sees it and as the gateway exposes it", () => {
    expect(routePath("/api/turn")).toBe("/turn");
    expect(routePath("/functions/v1/api/turn")).toBe("/turn");
    expect(routePath("/api/documents/abc/file")).toBe("/documents/abc/file");
  });

  it("maps the bare function root to /", () => {
    expect(routePath("/api")).toBe("/");
  });

  it("refuses anything outside the api function", () => {
    expect(routePath("/reminders")).toBeNull();
    expect(routePath("/apifoo/turn")).toBeNull();
  });
});

describe("origin allowlist", () => {
  const request = new Request("https://ref.supabase.co/functions/v1/api/turn", { method: "POST" });
  const env = { ALLOWED_ORIGINS: "https://ourglass.pages.dev, http://localhost:3000/" };

  it("parses a comma list, trimming spaces and trailing slashes", () => {
    expect(allowedOrigins(env)).toEqual(["https://ourglass.pages.dev", "http://localhost:3000"]);
  });

  it("allows the API's own origin and each named origin", () => {
    expect(isAllowedOrigin("https://ref.supabase.co", request, env)).toBe(true);
    expect(isAllowedOrigin("https://ourglass.pages.dev", request, env)).toBe(true);
  });

  it("refuses everything else, including look-alikes", () => {
    expect(isAllowedOrigin("https://evil.example", request, env)).toBe(false);
    expect(isAllowedOrigin("https://ourglass.pages.dev.evil.example", request, env)).toBe(false);
    expect(isAllowedOrigin("https://ourglass.pages.dev", request, {})).toBe(false);
  });

  it("rejectCrossSite lets the Pages origin through and stops a foreign one", () => {
    const from = (origin: string) =>
      new Request("https://ref.supabase.co/functions/v1/api/turn", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
      });
    expect(rejectCrossSite(from("https://ourglass.pages.dev"), { requireJson: true }, env)).toBeNull();
    expect(rejectCrossSite(from("https://evil.example"), { requireJson: true }, env)?.status).toBe(403);
  });
});

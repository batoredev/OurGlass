import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./security-headers.js";

const header = (dev: boolean, key: string) => securityHeaders(dev).find((h) => h.key === key)?.value;

describe("security headers", () => {
  it("sends the headers a public Worker URL needs", () => {
    for (const key of [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]) {
      expect(header(false, key), key).toBeTruthy();
    }
    expect(header(false, "X-Content-Type-Options")).toBe("nosniff");
  });

  it("cannot be framed and loads nothing from another origin", () => {
    const csp = contentSecurityPolicy(false);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    // No wildcard source anywhere: every directive is same-origin.
    expect(csp).not.toMatch(/\s\*(\s|;|$)/);
    expect(csp).not.toMatch(/https?:/);
  });

  it("allows eval and websockets ONLY in development", () => {
    // React Refresh and HMR need them in dev; production must not.
    expect(contentSecurityPolicy(false)).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy(false)).not.toContain("ws:");
    expect(contentSecurityPolicy(true)).toContain("unsafe-eval");
  });

  it("allows the microphone for this origin only — voice input needs it", () => {
    expect(header(false, "Permissions-Policy")).toContain("microphone=(self)");
    expect(header(false, "Permissions-Policy")).toContain("camera=()");
  });
});

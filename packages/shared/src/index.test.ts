import { describe, expect, it } from "vitest";
import { OURGLASS_SCHEMA_VERSION, type HealthCheck } from "./index.js";

describe("@ourglass/shared", () => {
  it("exposes a schema version", () => {
    expect(OURGLASS_SCHEMA_VERSION).toBe(0);
  });

  it("HealthCheck shape is usable", () => {
    const check: HealthCheck = { ok: true, service: "shared" };
    expect(check.ok).toBe(true);
  });
});

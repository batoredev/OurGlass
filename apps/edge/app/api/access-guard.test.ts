/**
 * EVERY exported handler of EVERY route calls `authorize` first.
 *
 * A route that forgets the guard serves personal data to the internet, and
 * nothing else in the suite would notice: its own tests would pass, because
 * they test what it returns, not who it returns it to. So this reads the
 * source. Two routes are exempt, with reasons.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API = dirname(fileURLToPath(import.meta.url));

const EXEMPT: Readonly<Record<string, string>> = {
  "health/route.ts": "serves no data; a monitor must reach it without a secret",
  "session/route.ts": "the door itself — it is how a browser gets past the guard",
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return entry === "route.ts" ? [full] : [];
  });
}

const routes = routeFiles(API).map((file) => ({
  path: relative(API, file).split("\\").join("/"),
  source: readFileSync(file, "utf8"),
}));

describe("the access guard", () => {
  it("finds the routes it is meant to check", () => {
    // A scan that silently finds nothing would pass every assertion below.
    expect(routes.length).toBeGreaterThanOrEqual(15);
  });

  it("keeps the exemption list honest — every exemption exists", () => {
    const paths = new Set(routes.map((route) => route.path));
    for (const exempt of Object.keys(EXEMPT)) expect(paths.has(exempt), exempt).toBe(true);
  });

  for (const route of routes.filter((candidate) => EXEMPT[candidate.path] === undefined)) {
    it(`${route.path}: every handler authorizes before doing anything`, () => {
      const handlers = [
        ...route.source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(([^)]*)\)/g),
      ];
      expect(handlers.length, "no handlers found").toBeGreaterThan(0);

      for (const handler of handlers) {
        const bodyStart = route.source.indexOf("{", handler.index! + handler[0].length);
        // The first statement of the handler body, leading line comments stripped.
        const body = route.source
          .slice(bodyStart + 1)
          .replace(/^\s*(\/\/[^\n]*\n\s*)*/, "")
          .trimStart();
        expect(body.startsWith("const denied = await authorize(request);"), handler[1]).toBe(true);
      }
    });
  }
});

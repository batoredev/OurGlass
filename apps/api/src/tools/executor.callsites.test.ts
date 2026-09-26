/**
 * Every production call site of `executeTurn` — PHASE-7-PERMISSIONS-DESIGN §4.
 *
 * ================================ WHY THIS EXISTS ==========================
 * The §35 gate lives in `runTurn`, not inside `executeTurn` (stage 7 showed a
 * check that can only throw enforces nothing). That is sound ONLY while every
 * other caller is one that must not be gated. This test makes that a checked
 * fact: a new call site fails here until someone writes down why it is safe —
 * which is the moment a future "send email from a scheduled rule" gets caught.
 * ===========================================================================
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APPS = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const ALLOWED: Readonly<Record<string, string>> = {
  "api/src/assistant/orchestrator.ts": "runTurn — model-driven, gated by the §35 permission gate",
  "api/src/reminders/poller.ts": "scheduled INTERNAL tools only — see the name check below",
  "api/src/permissions/release.ts": "releasing or declining a held action IS the user's approval",
  "web/app/api/permissions/route.ts": "setting or revoking a grant — control-plane tools only",
  // Phase 6. Two REVERSIBLE_WRITE tools the gate would pass immediately
  // anyway, with arguments built by code — never chosen by a model (see the
  // name check below and PHASE-6-DESIGN §1).
  "api/src/ingest/ingest.ts": "the upload pipeline — save_document and link_document only",
};

const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".open-next", ".wrangler"]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Code only. A doc comment that EXPLAINS a call (fire-reminder.ts describes the
 * poller's) is not a call site, and counting it would make this test demand a
 * justification for prose.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const callSites = [join(APPS, "api", "src"), join(APPS, "web")]
  .flatMap(sourceFiles)
  .filter((file) => !file.endsWith(join("tools", "executor.ts")))
  .filter((file) => /\bexecuteTurn\(/.test(withoutComments(readFileSync(file, "utf8"))))
  .map((file) => relative(APPS, file).split("\\").join("/"))
  .sort();

/** Tool-name string literals passed as `name:` in a file. */
function toolNamesIn(file: string): string[] {
  const source = readFileSync(join(APPS, file), "utf8");
  return [...source.matchAll(/\bname:\s*"([a-z_]+)"/g)].map((match) => match[1]!);
}

describe("executeTurn call sites", () => {
  it("are exactly the ones whose safety is written down", () => {
    expect(callSites).toEqual(Object.keys(ALLOWED).sort());
  });

  it("the poller executes only its two scheduled internal tools", () => {
    // If a scheduled rule ever SENDS something, it must be held like any
    // external action — this is where that would first appear.
    expect(new Set(toolNamesIn("api/src/reminders/poller.ts"))).toEqual(
      new Set(["fire_reminder", "evaluate_workflow"]),
    );
  });

  it("the upload pipeline executes only the two document tools", () => {
    // A file that could cause any other write is the injection path Phase 6
    // exists to close — this is where it would first appear.
    expect(new Set(toolNamesIn("api/src/ingest/ingest.ts"))).toEqual(
      new Set(["save_document", "link_document"]),
    );
  });

  it("the permissions route executes only control-plane tools", () => {
    expect(new Set(toolNamesIn("web/app/api/permissions/route.ts"))).toEqual(
      new Set(["set_permission", "revoke_permission"]),
    );
  });
});

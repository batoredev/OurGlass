/**
 * Do the model ids this product ships with actually exist?
 *
 * ================================ WHY THIS EXISTS ==========================
 * RESPOND_MODEL was `claude-haiku-5` from Phase 3 until 2026-09-17. No such
 * model has ever existed. Nothing caught it, because nothing could: every unit
 * test injects a fake client, and the Respond stage NEVER throws — a 404
 * degrades to the deterministic template, which is a correct, concise reply.
 * So every live turn quietly answered from the template, and it looked like
 * the product working.
 *
 * A model id is a claim about a remote service. Asserting it equals a string
 * (extract.test.ts does) pins it; only asking the service verifies it.
 *
 * FREE: `GET /v1/models` consumes no tokens. It needs a key, which is why it
 * lives in the live lane — but it has its own script, `pnpm check:models`, so
 * checking it never drags the paid extraction suite along.
 * ===========================================================================
 */
import { describe, expect, it } from "vitest";
import { EXTRACTION_MODEL, RESPOND_MODEL } from "@ourglass/shared";
import {
  GEMINI_DEFAULT_INTERPRET_MODEL,
  GEMINI_DEFAULT_RESPOND_MODEL,
} from "@ourglass/api/ai";

const apiKey = process.env["ANTHROPIC_API_KEY"];

if (!apiKey) {
  // Loud for the same reason extraction.live.test.ts is: a skipped check and a
  // passing check read identically in a summary line.
  throw new Error(
    "ANTHROPIC_API_KEY is unset, so the model-id check would report green having " +
      "asked nothing. Set it in .env (gitignored).",
  );
}

async function listModelIds(key: string): Promise<readonly string[]> {
  const ids: string[] = [];
  let afterId: string | undefined;
  // Paginated; bounded so a misbehaving cursor cannot loop forever.
  for (let page = 0; page < 20; page += 1) {
    const url = new URL("https://api.anthropic.com/v1/models");
    url.searchParams.set("limit", "1000");
    if (afterId !== undefined) url.searchParams.set("after_id", afterId);
    const response = await fetch(url, {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    });
    if (!response.ok) {
      throw new Error(`GET /v1/models returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as {
      data: { id: string }[];
      has_more: boolean;
      last_id: string | null;
    };
    ids.push(...body.data.map((model) => model.id));
    if (!body.has_more || body.last_id === null) break;
    afterId = body.last_id;
  }
  return ids;
}

describe("shipped Claude model ids (free, live)", () => {
  it(
    "names models the API actually serves",
    async () => {
      const available = await listModelIds(apiKey);
      expect(available, "Interpret model").toContain(EXTRACTION_MODEL);
      expect(available, "Respond model").toContain(RESPOND_MODEL);
    },
    30_000,
  );

  it("stays within the Sonnet/Haiku owner constraint", () => {
    expect(EXTRACTION_MODEL).toMatch(/sonnet/);
    expect(RESPOND_MODEL).toMatch(/haiku/);
  });
});

/**
 * The same check for Gemini, when a key exists.
 *
 * Its default model names shipped UNVERIFIED — nobody had a key. A wrong name
 * there fails exactly like the `claude-haiku-5` bug did: the provider answers
 * 404, the router moves on, and the product quietly runs on its fallback.
 * `models.list` is free.
 */
const geminiKey = process.env["GEMINI_API_KEY"];
const geminiSuite = geminiKey ? describe : describe.skip;

geminiSuite("shipped Gemini model ids (free, live)", () => {
  it(
    "names models the API actually serves",
    async () => {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}&pageSize=200`,
      );
      if (!response.ok) {
        throw new Error(`GET /v1beta/models returned HTTP ${response.status}`);
      }
      const body = (await response.json()) as { models?: { name?: string }[] };
      // Served as "models/gemini-2.5-flash"; we configure the bare id.
      const available = (body.models ?? []).map((model) => (model.name ?? "").replace(/^models\//, ""));

      expect(available.length, "no models listed").toBeGreaterThan(0);
      expect(available, "Gemini interpret model").toContain(GEMINI_DEFAULT_INTERPRET_MODEL);
      expect(available, "Gemini respond model").toContain(GEMINI_DEFAULT_RESPOND_MODEL);
    },
    30_000,
  );
});

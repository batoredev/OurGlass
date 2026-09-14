/**
 * The three findings from the security review of the Cloudflare port, pinned
 * as tests.
 *
 * ================================ READ THIS ================================
 * Every one of these was already "fixed" by a comment explaining the mistake.
 * A comment is a citation, not a verification — this repo has a recorded
 * defect class for exactly that. These tests are what actually holds.
 *
 * The root cause, once, so the tests below make sense:
 *
 *   The Fastify server bound 127.0.0.1 whenever ENABLE_DEMO_ENDPOINT was on.
 *   That LOOPBACK BINDING — not the flag — was the protection. A Cloudflare
 *   Worker has no loopback: it is a public URL the moment it deploys. The
 *   flag came across to wrangler.toml; the binding could not.
 * ===========================================================================
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

const { queryMock, demoMock, undoTurnMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  demoMock: vi.fn(),
  undoTurnMock: vi.fn(),
}));

// Resolves to the SAME module the routes import as "../_lib", so mocking it
// here keeps `pg` out of the test process entirely.
vi.mock("./_lib", () => ({
  getPool: () => ({ query: queryMock }),
  db: { withTransaction: vi.fn() },
  read: vi.fn(),
  demoEnabled: demoMock,
}));

vi.mock("@ourglass/api/tools", () => ({
  undoTurn: undoTurnMock,
  buildToolRegistry: () => ({}),
  TurnNotFoundError: class TurnNotFoundError extends Error {},
  TurnAlreadyUndoneError: class TurnAlreadyUndoneError extends Error {},
}));

beforeEach(() => {
  vi.clearAllMocks();
  demoMock.mockReturnValue(true);
});

describe("wrangler.toml does not enable the demo endpoints", () => {
  const toml = readFileSync(resolve(HERE, "../../wrangler.toml"), "utf8");

  // The file talks about ENABLE_DEMO_ENDPOINT at length; only an ACTIVE
  // setting is a finding, so comment lines are stripped before looking.
  const active = toml
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  it("sets no ENABLE_DEMO_ENDPOINT var", () => {
    expect(active.filter((line) => line.includes("ENABLE_DEMO_ENDPOINT"))).toEqual([]);
  });

  it("still declares the [vars] table, so a future non-secret var has a home", () => {
    expect(active).toContain("[vars]");
  });

  it("carries no secret-looking assignment", () => {
    // wrangler.toml is COMMITTED and this repo is PUBLIC. Secrets belong in
    // `wrangler secret put`, which never touches the file.
    const secretish = /^(DATABASE_URL|ANTHROPIC_API_KEY|VOYAGE_API_KEY)\s*=/;
    expect(active.filter((line) => secretish.test(line))).toEqual([]);
  });
});

describe("GET /api/health leaks nothing when the database is down", () => {
  // A real `pg` connection failure, near enough verbatim. Every token in it is
  // something an unauthenticated caller should not learn.
  const REAL_LOOKING_PG_ERROR =
    'password authentication failed for user "postgres.abcdefghijklmnop" ' +
    "(host db.abcdefghijklmnop.supabase.co:5432)";

  it("answers 503 without the underlying message", async () => {
    queryMock.mockRejectedValueOnce(new Error(REAL_LOOKING_PG_ERROR));
    const { GET } = await import("./health/route");

    const response = await GET();
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    // Whole-string containment, plus each individually interesting token, so
    // a partial reintroduction (just the host, say) still fails.
    expect(body).not.toContain(REAL_LOOKING_PG_ERROR);
    expect(body).not.toContain("supabase.co");
    expect(body).not.toContain("abcdefghijklmnop");
    expect(body).not.toContain("password authentication");
  });

  it("still says it is unhealthy", async () => {
    queryMock.mockRejectedValueOnce(new Error(REAL_LOOKING_PG_ERROR));
    const { GET } = await import("./health/route");

    // Uninformative to a stranger must not mean uninformative to a monitor:
    // the status code and the ok flag are the operator's actual signal.
    expect(await (await GET()).json()).toMatchObject({ ok: false, db: false });
  });

  it("answers 200 when the round-trip succeeds", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ ok: 1 }] });
    const { GET } = await import("./health/route");

    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, db: true });
  });
});

describe("POST /api/undo is gated, because the gate is the only access control", () => {
  const body = (turnId: unknown) =>
    new Request("http://localhost/api/undo", {
      method: "POST",
      body: JSON.stringify({ turnId }),
    });

  it("404s and does not reach undoTurn when the flag is off", async () => {
    demoMock.mockReturnValue(false);
    const { POST } = await import("./undo/route");

    const response = await POST(body("some-turn-id"));

    expect(response.status).toBe(404);
    // The status code alone would pass even if the undo had already run and
    // the route 404'd afterwards. This is the assertion that matters.
    expect(undoTurnMock).not.toHaveBeenCalled();
  });

  it("reaches undoTurn when the flag is on", async () => {
    undoTurnMock.mockResolvedValueOnce({ undone: true });
    const { POST } = await import("./undo/route");

    const response = await POST(body("some-turn-id"));

    expect(response.status).toBe(200);
    expect(undoTurnMock).toHaveBeenCalledWith("some-turn-id", expect.anything());
  });

  it("rejects a non-string turnId before touching the database", async () => {
    const { POST } = await import("./undo/route");

    expect((await POST(body(42))).status).toBe(400);
    expect(undoTurnMock).not.toHaveBeenCalled();
  });
});

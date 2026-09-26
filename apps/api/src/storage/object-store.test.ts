import { describe, expect, it } from "vitest";
import {
  MemoryObjectStore,
  StorageError,
  SupabaseObjectStore,
  objectStoreFromEnv,
  storageAuthHeaders,
} from "./object-store.js";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fake Storage API that answers from a script, one response per request. */
function fakeFetch(responses: Response[]) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body,
    });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request ${init.method} ${url}`);
    return next;
  };
  return { calls, fetchImpl };
}

// FAKE keys, assembled at runtime so no key-SHAPED literal sits in a public
// repository for a secret scanner to flag (or for a reader to wonder about).
const b64url = (text: string) => Buffer.from(text).toString("base64url");
const LEGACY_JWT = [b64url('{"alg":"none"}'), b64url('{"role":"test"}'), b64url("fake")].join(".");
const NEW_SECRET = ["sb", "secret", "fake0000test"].join("_");

describe("storageAuthHeaders", () => {
  it("sends a new sb_secret key on apikey ONLY — as Bearer it would be rejected", () => {
    expect(storageAuthHeaders(NEW_SECRET)).toEqual({ apikey: NEW_SECRET });
  });

  it("sends a legacy service_role JWT on both headers", () => {
    expect(storageAuthHeaders(LEGACY_JWT)).toEqual({
      apikey: LEGACY_JWT,
      authorization: `Bearer ${LEGACY_JWT}`,
    });
  });
});

describe("SupabaseObjectStore", () => {
  it("uploads to the private bucket without upsert, key segments encoded", async () => {
    const { calls, fetchImpl } = fakeFetch([new Response("{}", { status: 200 })]);
    const store = new SupabaseObjectStore({ url: "https://proj.supabase.co/", secretKey: NEW_SECRET, fetchImpl });
    await store.put("2026/09/abc.pdf", new Uint8Array([1, 2, 3]), "application/pdf");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://proj.supabase.co/storage/v1/object/documents/2026/09/abc.pdf",
      method: "POST",
      headers: { apikey: NEW_SECRET, "content-type": "application/pdf", "x-upsert": "false" },
    });
  });

  it("creates the bucket, private, on the first upload that finds it missing — then retries once", async () => {
    const missing = () =>
      new Response(JSON.stringify({ statusCode: "404", error: "Bucket not found" }), { status: 400 });
    const { calls, fetchImpl } = fakeFetch([
      missing(),
      new Response("{}", { status: 200 }),
      new Response("{}", { status: 200 }),
    ]);
    const store = new SupabaseObjectStore({ url: "https://proj.supabase.co", secretKey: NEW_SECRET, fetchImpl });
    await store.put("k.png", new Uint8Array([1]), "image/png");

    expect(calls.map((call) => `${call.method} ${call.url.replace("https://proj.supabase.co/storage/v1/", "")}`)).toEqual([
      "POST object/documents/k.png",
      "POST bucket",
      "POST object/documents/k.png",
    ]);
    expect(JSON.parse(calls[1]!.body as string)).toMatchObject({ id: "documents", public: false });
  });

  it("treats a bucket someone else just created as success", async () => {
    const { fetchImpl } = fakeFetch([
      new Response("Bucket not found", { status: 404 }),
      new Response(JSON.stringify({ error: "The resource already exists" }), { status: 400 }),
      new Response("{}", { status: 200 }),
    ]);
    const store = new SupabaseObjectStore({ url: "https://proj.supabase.co", secretKey: NEW_SECRET, fetchImpl });
    await expect(store.put("k.png", new Uint8Array([1]), "image/png")).resolves.toBeUndefined();
  });

  it("names a rejected key without ever including it", async () => {
    const { fetchImpl } = fakeFetch([new Response("Invalid API key", { status: 401 })]);
    const store = new SupabaseObjectStore({ url: "https://proj.supabase.co", secretKey: NEW_SECRET, fetchImpl });
    const failure = await store.put("k", new Uint8Array([1]), "text/plain").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StorageError);
    expect((failure as StorageError).message).toContain("SUPABASE_SECRET_KEY");
    expect((failure as StorageError).message).not.toContain(NEW_SECRET);
  });

  it("maps a network failure to a StorageError, not a raw fetch error", async () => {
    const store = new SupabaseObjectStore({
      url: "https://proj.supabase.co",
      secretKey: NEW_SECRET,
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(store.get("k")).rejects.toMatchObject({ name: "StorageError", message: "File storage is unreachable" });
  });

  it("downloads bytes and type; a missing object is null", async () => {
    const { fetchImpl } = fakeFetch([
      new Response(new Uint8Array([9, 8, 7]), { status: 200, headers: { "content-type": "image/png" } }),
      new Response(JSON.stringify({ error: "not_found", message: "Object not found" }), { status: 400 }),
    ]);
    const store = new SupabaseObjectStore({ url: "https://proj.supabase.co", secretKey: NEW_SECRET, fetchImpl });
    const found = await store.get("a.png");
    expect(found?.contentType).toBe("image/png");
    expect([...found!.bytes]).toEqual([9, 8, 7]);
    expect(await store.get("gone.png")).toBeNull();
  });
});

describe("objectStoreFromEnv", () => {
  it("is null — a state, not an error — until both variables are set", () => {
    expect(objectStoreFromEnv({})).toBeNull();
    expect(objectStoreFromEnv({ SUPABASE_URL: "https://proj.supabase.co" })).toBeNull();
    expect(objectStoreFromEnv({ SUPABASE_SECRET_KEY: NEW_SECRET })).toBeNull();
  });

  it("refuses to send the master key over plain http except to loopback", () => {
    expect(objectStoreFromEnv({ SUPABASE_URL: "http://proj.supabase.co", SUPABASE_SECRET_KEY: NEW_SECRET })).toBeNull();
    expect(objectStoreFromEnv({ SUPABASE_URL: "not a url", SUPABASE_SECRET_KEY: NEW_SECRET })).toBeNull();
    expect(objectStoreFromEnv({ SUPABASE_URL: "http://localhost:54321", SUPABASE_SECRET_KEY: NEW_SECRET })).not.toBeNull();
    expect(objectStoreFromEnv({ SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SECRET_KEY: NEW_SECRET })).toBeInstanceOf(
      SupabaseObjectStore,
    );
  });
});

describe("MemoryObjectStore", () => {
  it("never overwrites", async () => {
    const store = new MemoryObjectStore();
    await store.put("k", new Uint8Array([1]), "text/plain");
    await expect(store.put("k", new Uint8Array([2]), "text/plain")).rejects.toBeInstanceOf(StorageError);
  });
});

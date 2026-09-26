/**
 * Where an uploaded file's bytes live (docs/PHASE-6-DESIGN.md §3).
 *
 * Supabase Storage (owner decision, 2026-09-24), over its REST API with plain
 * `fetch` — no SDK, for the reason the Qwen provider gives: `fetch` exists on
 * Cloudflare Workers, Node's http stack does not. Requests verified against
 * supabase/storage-js (2026-09-25).
 *
 * ┌─ THE KEY IS A MASTER KEY ──────────────────────────────────────────────┐
 * │ A Supabase secret key (or the legacy service_role key) bypasses every   │
 * │ Row Level Security policy. It lives in the server's environment only,   │
 * │ is never logged, never put in an error message, and never reaches a     │
 * │ browser: files are served back through our own authorised route.        │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { IMAGE_MEDIA_TYPES, MAX_UPLOAD_BYTES } from "@ourglass/shared";

export interface StoredObject {
  /** ArrayBuffer-backed (never a SharedArrayBuffer view), so it is a valid Response body. */
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly contentType: string;
}

export interface ObjectStore {
  /** THROWS `StorageError`. Never overwrites: keys are fresh UUIDs. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Null when there is no such object. THROWS `StorageError` otherwise. */
  get(key: string): Promise<StoredObject | null>;
}

/** Carries an HTTP status and never the key, the URL's secrets, or the response body. */
export class StorageError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "StorageError";
    this.status = status;
  }
}

/** The one bucket. Private: nothing in it is reachable without the secret key. */
export const DOCUMENTS_BUCKET = "documents";

const REQUEST_TIMEOUT_MS = 15_000;

/** What the bucket accepts — the same list sniff.ts can produce, so the two cannot disagree silently. */
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/plain; charset=utf-8",
  ...IMAGE_MEDIA_TYPES,
];

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface SupabaseObjectStoreOptions {
  readonly url: string;
  readonly secretKey: string;
  readonly bucket?: string | undefined;
  readonly fetchImpl?: FetchLike | undefined;
}

/**
 * The headers a key needs, by its SHAPE.
 *
 * New `sb_secret_…` keys are not JWTs and go on `apikey` ONLY — Supabase's
 * docs are explicit that sending one as `Authorization: Bearer` fails. The
 * legacy `service_role` key IS a JWT (three base64url parts) and needs both.
 */
export function storageAuthHeaders(secretKey: string): Record<string, string> {
  const isJwt = /^[\w-]+\.[\w-]+\.[\w-]+$/.test(secretKey);
  return isJwt ? { apikey: secretKey, authorization: `Bearer ${secretKey}` } : { apikey: secretKey };
}

function objectPath(bucket: string, key: string): string {
  return `${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export class SupabaseObjectStore implements ObjectStore {
  private readonly base: string;
  private readonly bucket: string;
  private readonly auth: Record<string, string>;
  private readonly fetchImpl: FetchLike;
  private bucketEnsured = false;

  constructor(options: SupabaseObjectStoreOptions) {
    this.base = `${options.url.replace(/\/+$/, "")}/storage/v1`;
    this.bucket = options.bucket ?? DOCUMENTS_BUCKET;
    this.auth = storageAuthHeaders(options.secretKey);
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.base}/${path}`, {
        ...init,
        headers: { ...this.auth, ...(init.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new StorageError(timedOut ? "File storage timed out" : "File storage is unreachable");
    }
  }

  /**
   * Supabase has answered a missing bucket both as 404 and as a 400 whose
   * body says "Bucket not found", depending on version. Both mean the same.
   */
  private static async isMissingBucket(response: Response): Promise<boolean> {
    if (response.status !== 400 && response.status !== 404) return false;
    const body = await response.text().catch(() => "");
    return /bucket not found/i.test(body);
  }

  /** Idempotent: a bucket someone else just created is success, not failure. */
  private async createBucket(): Promise<void> {
    const response = await this.request("bucket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: this.bucket,
        name: this.bucket,
        public: false,
        file_size_limit: MAX_UPLOAD_BYTES,
        allowed_mime_types: ALLOWED_MIME_TYPES,
      }),
    });
    if (response.ok || response.status === 409) return;
    const body = await response.text().catch(() => "");
    if (/already exists/i.test(body)) return;
    throw new StorageError(`Could not create the "${this.bucket}" storage bucket`, response.status);
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const send = () =>
      this.request(`object/${objectPath(this.bucket, key)}`, {
        method: "POST",
        headers: { "content-type": contentType, "x-upsert": "false", "cache-control": "no-store" },
        body: bytes,
      });

    let response = await send();
    // The bucket creates itself on the first upload that finds it missing —
    // one setup step fewer, and safe to race.
    if (!response.ok && !this.bucketEnsured && (await SupabaseObjectStore.isMissingBucket(response))) {
      await this.createBucket();
      this.bucketEnsured = true;
      response = await send();
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new StorageError("File storage rejected the key — check SUPABASE_SECRET_KEY", response.status);
      }
      throw new StorageError("File storage refused the upload", response.status);
    }
    this.bucketEnsured = true;
  }

  async get(key: string): Promise<StoredObject | null> {
    const response = await this.request(`object/${objectPath(this.bucket, key)}`, { method: "GET" });
    if (response.status === 404 || (response.status === 400 && !response.ok)) {
      const body = await response.text().catch(() => "");
      if (response.status === 404 || /not found/i.test(body)) return null;
      throw new StorageError("File storage refused the download", response.status);
    }
    if (!response.ok) throw new StorageError("File storage refused the download", response.status);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
    };
  }
}

/** Tests and local runs without storage. Holds everything in memory. */
export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, StoredObject>();

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    if (this.objects.has(key)) throw new StorageError("Object already exists", 409);
    this.objects.set(key, { bytes: bytes.slice(), contentType });
  }

  async get(key: string): Promise<StoredObject | null> {
    return this.objects.get(key) ?? null;
  }
}

/**
 * The store the environment configures, or null when uploads are not set up.
 *
 * NULL IS A STATE, not an error: the upload route answers it with a plain
 * "file uploads aren't set up" rather than a 500, and nothing else in the app
 * depends on storage.
 */
export function objectStoreFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl?: FetchLike,
): ObjectStore | null {
  const url = env["SUPABASE_URL"]?.trim();
  const secretKey = env["SUPABASE_SECRET_KEY"]?.trim();
  if (!url || !secretKey) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // https, or a local Supabase on loopback. Anything else is a misconfiguration
  // that would send a master key somewhere it should not go.
  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) return null;
  return new SupabaseObjectStore({ url: parsed.origin, secretKey, fetchImpl });
}

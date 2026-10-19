import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, transcribeMock } = vi.hoisted(() => ({ authMock: vi.fn(), transcribeMock: vi.fn() }));

vi.mock("./_auth", () => ({ authorize: authMock }));
vi.mock("@ourglass/api/ai", () => ({
  buildTranscriber: () => ({ transcribe: transcribeMock }),
}));

/** A minimal valid WAV: RIFF/WAVE header plus data — audible unless `silent`. */
function wav(extra = 8, silent = false): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + extra);
  bytes.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
  bytes.set([..."WAVE"].map((c) => c.charCodeAt(0)), 8);
  if (!silent) new DataView(bytes.buffer).setInt16(44, 8000, true); // one audible sample
  return bytes;
}

const post = (body: Uint8Array<ArrayBuffer>, type = "audio/wav") =>
  new Request("http://localhost/api/transcribe", { method: "POST", headers: { "content-type": type }, body });

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(null);
});

describe("POST /api/transcribe", () => {
  it("refuses an unauthenticated caller before reading or transcribing anything", async () => {
    authMock.mockResolvedValueOnce(Response.json({ error: "Not signed in." }, { status: 401 }));
    const { POST } = await import("./transcribe/route");
    expect((await POST(post(wav()))).status).toBe(401);
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it("accepts only WAV — by its bytes, not just its declared type", async () => {
    const { POST } = await import("./transcribe/route");
    expect((await POST(post(wav(), "audio/webm"))).status).toBe(415);
    expect((await POST(post(new Uint8Array(100)))).status).toBe(400); // claims WAV, isn't
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it("refuses a clip over the size cap", async () => {
    const { POST, MAX_DICTATION_BYTES } = await import("./transcribe/route");
    expect((await POST(post(wav(MAX_DICTATION_BYTES)))).status).toBe(413);
  });

  it("answers silence itself and never sends it to the model", async () => {
    // The model invents sentences from silence ("Remind me to buy eggs.").
    const { POST } = await import("./transcribe/route");
    const response = await POST(post(wav(16_000, true)));
    expect(await response.json()).toEqual({ text: "" });
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it("returns the words, and names an exhausted free quota plainly", async () => {
    const { POST } = await import("./transcribe/route");
    transcribeMock.mockResolvedValueOnce("Remind me at nine to call the printer.");
    const ok = await POST(post(wav()));
    expect(await ok.json()).toEqual({ text: "Remind me at nine to call the printer." });
    expect(transcribeMock).toHaveBeenCalledWith(expect.objectContaining({ mediaType: "audio/wav" }));

    transcribeMock.mockRejectedValueOnce(Object.assign(new Error("429"), { category: "rate_limit" }));
    const limited = await POST(post(wav()));
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toMatch(/free limit/i);
  });
});

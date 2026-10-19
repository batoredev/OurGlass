/**
 * POST /api/transcribe — a recorded voice note in, its words out.
 *
 * Dictation for browsers whose own speech recognition is missing or broken
 * (Brave reports `network`: it ships the API without Google's speech service;
 * Firefox has no API at all). The page records 16 kHz mono WAV and posts the
 * raw bytes here.
 *
 * NOTHING IS SAVED AND NOTHING IS INTERPRETED. The text goes back to the
 * composer; the user reads it and only Send makes it a turn. That keeps the
 * one-model-call-per-stage boundaries intact: transcription is not Interpret.
 */
import { NextResponse } from "next/server";
import { buildTranscriber } from "@ourglass/api/ai";
import { authorize } from "../_auth";
import { rejectCrossSite } from "../_http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ~60 s of 16 kHz mono 16-bit PCM, plus header. The page stops at 45 s. */
export const MAX_DICTATION_BYTES = 2 * 1024 * 1024;

/** 0.02 of full scale — the page's SILENCE_PEAK, in 16-bit sample units. */
const SILENCE_PEAK_PCM16 = Math.round(0.02 * 32768);

/** Loudest absolute sample of the PCM16 data after the 44-byte header. */
function peakOfPcm16(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let peak = 0;
  for (let offset = 44; offset + 1 < bytes.byteLength; offset += 2) {
    const sample = Math.abs(view.getInt16(offset, true));
    if (sample > peak) peak = sample;
  }
  return peak;
}

export async function POST(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const crossSite = rejectCrossSite(request, { requireJson: false });
  if (crossSite) return crossSite;

  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("audio/wav")) {
    return NextResponse.json({ error: "Body must be audio/wav." }, { status: 415 });
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_DICTATION_BYTES) {
    return NextResponse.json({ error: "That recording is too long — keep dictation under a minute." }, { status: 413 });
  }
  // The bytes, not the header, decide what this is: RIFF....WAVE.
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.byteLength < 44 || ascii(0, 4) !== "RIFF" || ascii(8, 12) !== "WAVE") {
    return NextResponse.json({ error: "That is not a WAV recording." }, { status: 400 });
  }

  // SILENCE IS ANSWERED HERE, never sent. Given a silent clip the model
  // invents a plausible sentence rather than reporting no speech — in testing
  // it returned "Remind me to buy eggs." for 6.7 s of zeros. The page checks
  // too; this holds even if the page does not.
  if (peakOfPcm16(bytes) < SILENCE_PEAK_PCM16) {
    return NextResponse.json({ text: "" });
  }

  const transcriber = buildTranscriber(process.env);
  if (!transcriber) {
    return NextResponse.json({ error: "Voice input needs GEMINI_API_KEY on the server." }, { status: 503 });
  }
  try {
    const text = await transcriber.transcribe({ base64: Buffer.from(bytes).toString("base64"), mediaType: "audio/wav" });
    return NextResponse.json({ text });
  } catch (error: unknown) {
    const category = (error as { category?: string }).category;
    console.error("[transcribe] failed:", category ?? error);
    const message =
      category === "rate_limit"
        ? "Voice input has reached today's free limit. You can type instead."
        : "Couldn't transcribe that. Try again, or type instead.";
    return NextResponse.json({ error: message }, { status: category === "rate_limit" ? 429 : 502 });
  }
}

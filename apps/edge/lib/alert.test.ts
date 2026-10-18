import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALERT_COOLDOWN_MS,
  alertPayload,
  allModelsFailedMessage,
  cronFailedMessage,
  redact,
  resetAlertCooldownsForTests,
  sendAlert,
} from "./alert";

beforeEach(() => resetAlertCooldownsForTests());

const okFetch = () => vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;

describe("alertPayload", () => {
  it("speaks each chat service's format", () => {
    expect(alertPayload("https://hooks.slack.com/services/T/B/X", "hi")).toEqual({ text: "hi" });
    expect(alertPayload("https://discord.com/api/webhooks/1/abc", "hi")).toEqual({ content: "hi" });
    expect(alertPayload("https://example.org/hook", "hi")).toEqual({ text: "hi", content: "hi" });
  });
});

describe("sendAlert", () => {
  it("does nothing without a webhook — alerting is opt-in", async () => {
    const fetchImpl = okFetch();
    expect(await sendAlert("cron_failed", "x", { webhookUrl: undefined, fetchImpl })).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends once per kind per cooldown, so an outage is a message, not a flood", async () => {
    const fetchImpl = okFetch();
    let now = 1_000_000;
    const deps = { webhookUrl: "https://hooks.slack.com/services/T/B/X", fetchImpl, now: () => now };

    expect(await sendAlert("cron_failed", "a", deps)).toBe("sent");
    expect(await sendAlert("cron_failed", "b", deps)).toBe("skipped");
    // A different kind is not held back by the first.
    expect(await sendAlert("ai_all_failed", "c", deps)).toBe("sent");
    now += ALERT_COOLDOWN_MS;
    expect(await sendAlert("cron_failed", "d", deps)).toBe("sent");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("NEVER throws — a broken webhook must not break what it reports on", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      sendAlert("cron_failed", "x", { webhookUrl: "https://hooks.slack.com/services/T/B/X", fetchImpl: failing }),
    ).resolves.toBe("sent");
    // The webhook URL is a credential; it never reaches the log.
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("hooks.slack.com");
    errorLog.mockRestore();
  });
});

describe("what an alert may say", () => {
  it("redacts connection strings and keys from error text", () => {
    const text = redact("connect failed: postgresql://postgres:hunter2@db.x.supabase.co:5432/postgres token=abc123");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("abc123");
    expect(text).toContain("[url]");
  });

  it("reports a failed cron with the redacted error, and where to look", () => {
    const message = cronFailedMessage(new Error("password=hunter2 rejected"), new Date("2026-09-25T10:00:00Z"));
    expect(message).toContain("reminder timer failed");
    expect(message).not.toContain("hunter2");
    expect(message).toContain("RUNBOOK");
  });

  it("says every model failed ONLY when no interpret attempt succeeded, and never quotes the user", () => {
    const at = new Date("2026-09-25T10:00:00Z");
    const failed = [
      { stage: "interpret", ok: false, provider: "claude", errorCategory: "rate_limit" },
      { stage: "interpret", ok: false, provider: "gemini", errorCategory: "server_error" },
    ];
    const message = allModelsFailedMessage(failed, at);
    expect(message).toContain("claude: rate_limit, gemini: server_error");

    expect(allModelsFailedMessage([...failed, { stage: "interpret", ok: true, provider: "qwen" }], at)).toBeNull();
    // A degraded REPLY is not an outage — the message was understood and saved.
    expect(allModelsFailedMessage([{ stage: "respond", ok: false, provider: "claude" }], at)).toBeNull();
    expect(allModelsFailedMessage([], at)).toBeNull();
  });
});

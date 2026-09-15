/**
 * Claude — the primary provider.
 *
 * A WRAPPER, not a reimplementation. `AnthropicExtractor` and `HaikuResponder`
 * already hold every hard-won detail: the forced tool call, the stop_reason
 * checks that run BEFORE payload validation, the 3-second respond timeout, the
 * never-throws template fallback. Rewriting any of that to fit a new interface
 * would be discarding tested behaviour for symmetry.
 *
 * ⚠ SONNET AND HAIKU ONLY, NEVER OPUS. Owner decision (docs/DECISIONS.md).
 * The models come from `@ourglass/shared` so they cannot drift, and the
 * provider layer must not become a way around the constraint.
 */
import type {
  AIProviderName,
  ExtractionResult,
  ProviderHealth,
  ProviderFailureCategory,
  RespondInput,
} from "@ourglass/shared";
import { EXTRACTION_MODEL, RESPOND_MODEL } from "@ourglass/shared";
import { AnthropicExtractor } from "../assistant/extract.js";
import { HaikuResponder, type RespondResult } from "../assistant/respond.js";
import { classifyProviderError } from "./errors.js";
import type { AIProvider, InterpretInput } from "./provider.js";

export interface ClaudeProviderOptions {
  readonly apiKey: string;
  readonly interpretModel?: string | undefined;
  readonly respondModel?: string | undefined;
  /** Injected in tests so no network call is made. */
  readonly extractor?: Pick<AnthropicExtractor, "extract">;
  readonly responder?: Pick<HaikuResponder, "respondWithTrace">;
}

export class ClaudeProvider implements AIProvider {
  readonly name: AIProviderName = "claude";

  private readonly extractor: Pick<AnthropicExtractor, "extract">;
  private readonly responder: Pick<HaikuResponder, "respondWithTrace">;
  private readonly interpretModel: string;
  private readonly respondModel: string;
  private readonly configured: boolean;

  private lastFailureAt: string | null = null;
  private lastFailureCategory: ProviderFailureCategory | null = null;

  constructor(options: ClaudeProviderOptions) {
    this.configured = Boolean(options.apiKey);
    this.interpretModel = options.interpretModel ?? EXTRACTION_MODEL;
    this.respondModel = options.respondModel ?? RESPOND_MODEL;

    // Built eagerly so a missing key fails HERE rather than mid-turn. The
    // injected forms skip construction entirely, which is what keeps the unit
    // tests free of both a key and a network.
    this.extractor =
      options.extractor ??
      new AnthropicExtractor({ apiKey: options.apiKey, model: this.interpretModel as never });
    this.responder =
      options.responder ??
      new HaikuResponder({ apiKey: options.apiKey, model: this.respondModel as never });
  }

  modelFor(stage: "interpret" | "respond"): string {
    return stage === "interpret" ? this.interpretModel : this.respondModel;
  }

  async interpret(input: InterpretInput): Promise<ExtractionResult> {
    try {
      return await this.extractor.extract(input.utterance);
    } catch (error: unknown) {
      const classified = classifyProviderError(this.name, error);
      this.lastFailureAt = new Date().toISOString();
      this.lastFailureCategory = classified.category;
      throw classified;
    }
  }

  async respond(input: RespondInput): Promise<RespondResult> {
    // No try/catch, deliberately: respondWithTrace never throws. Adding one
    // would imply a failure mode that does not exist and would hide a real
    // regression if that guarantee were ever broken.
    return this.responder.respondWithTrace(input);
  }

  health(): ProviderHealth {
    return {
      provider: this.name,
      configured: this.configured,
      lastFailureAt: this.lastFailureAt,
      lastFailureCategory: this.lastFailureCategory,
    };
  }
}

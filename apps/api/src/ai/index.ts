/**
 * The AI provider layer.
 *
 * Everything outside this directory depends on `AIProvider` and the router —
 * never on `@anthropic-ai/sdk`, `@google/genai`, or Ollama's HTTP shape.
 */
export * from "./errors.js";
export * from "./provider.js";
export * from "./claude.js";

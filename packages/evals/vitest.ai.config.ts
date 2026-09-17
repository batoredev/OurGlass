import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.ai-eval.ts"],
    environment: "node",
    testTimeout: 330_000,
  },
});

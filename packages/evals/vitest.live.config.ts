import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.live.test.ts"],
    environment: "node",
    testTimeout: 330_000,
  },
});

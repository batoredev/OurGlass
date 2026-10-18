import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The route files import `next/server`; outside Next.js that resolves to the
// same shim the Edge Function bundle uses, so tests exercise what ships.
export default defineConfig({
  resolve: {
    alias: {
      "next/server": fileURLToPath(new URL("./src/next-server-shim.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
  },
});

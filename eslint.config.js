// Flat config (ESLint 10). Kept minimal for Phase 0 — package-level rules
// (e.g. eslint-config-next in apps/web) layer on top per package as they're
// scaffolded in later phases.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "graphify-out/**",
    ],
  },
);

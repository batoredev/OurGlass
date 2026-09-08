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
  {
    // Plain Node scripts (migration runners, build scripts) run directly under
    // `node`, not through a bundler — they need process/console/etc declared,
    // which the TS-source files elsewhere don't need (they get Node types from
    // @types/node instead). Found running `pnpm lint` against
    // packages/db/scripts/migrate.mjs.
    files: ["**/scripts/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
  },
);

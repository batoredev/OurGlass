// apps/web overrides the root flat config with Next.js's React/JSX/a11y/TS
// rules. `next lint` was removed in Next.js 16 (verified: `next --help` no
// longer lists it as a command) — eslint-config-next's default export is
// already a native flat-config array (including TS handling), so it's
// spread directly. Do NOT wrap this in @eslint/eslintrc's FlatCompat: that
// throws "Converting circular structure to JSON" against this package's
// react-plugin config (verified while wiring this up) because FlatCompat
// expects a legacy eslintrc shape, not an already-flat array.
import nextConfig from "eslint-config-next";

const config = [
  ...nextConfig,
  {
    ignores: [".next/**", "dist/**", "node_modules/**"],
  },
];

export default config;

/**
 * Phase 0 placeholder home page. Deliberately unstyled — per
 * docs/EXECUTION-PLAN.md the UI is last-priority, and the real primary
 * surface (a conversational space, spec §29) lands in Phase 5.
 */
import { OURGLASS_SCHEMA_VERSION } from "@ourglass/shared";

export default function HomePage() {
  return (
    <main>
      <h1>OurGlass</h1>
      <p>Batore Personal Assistant — Phase 0 scaffold.</p>
      <p>Shared schema version: {OURGLASS_SCHEMA_VERSION}</p>
    </main>
  );
}

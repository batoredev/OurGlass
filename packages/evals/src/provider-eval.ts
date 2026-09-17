/**
 * Provider comparison — pure scoring, no network.
 *
 * ================================ READ THIS ================================
 * WHAT "WRONG MUTATION" MEANS HERE, stated before anyone reads a number.
 *
 * This lane calls a model's Interpret stage and nothing else. It never runs
 * Resolve or Mutate and never touches a database, so it CANNOT observe a real
 * database write. What it measures is WRONG-MUTATION RISK at the extraction
 * level: an extraction that would drive a write AND does not match the
 * hand-labelled fixture, or that invents a field the fixture forbids. That is
 * the upstream cause of a wrong write, and the metric is named for what it is.
 *
 * It is still the headline number, because it is the failure that looks like
 * the feature working: a spurious memory reads as a good memory.
 * ===========================================================================
 */
import type { ExtractedIntent, Extraction } from "@ourglass/shared";
import type { ExtractionFixture } from "./fixtures.js";
import { forbiddenFieldsPresent, matchesExpected } from "./match.js";

/** Kinds whose extraction can drive a write. `context` counts only with a write field. */
function drivesWrite(intent: ExtractedIntent): boolean {
  if (
    intent.kind === "information" ||
    intent.kind === "action" ||
    intent.kind === "completion_update"
  ) {
    return true;
  }
  return (
    intent.kind === "context" &&
    (intent.memoryBody !== undefined || intent.correctionTarget !== undefined)
  );
}

function kindsOf(extraction: Extraction): string {
  return extraction.intents
    .map((intent) => intent.kind)
    .sort()
    .join(",");
}

function hasUncertain(extraction: Extraction): boolean {
  return extraction.intents.some((intent) => intent.inferenceLevel === "UNCERTAIN");
}

export interface FixtureScore {
  readonly id: string;
  /** Null when the provider failed to produce an extraction at all. */
  readonly matched: boolean | null;
  readonly kindMatched: boolean | null;
  readonly invented: readonly string[];
  readonly wrongMutationRisk: boolean;
  /** Asked when the label says the utterance was clear. */
  readonly unnecessaryClarification: boolean;
  /** Did not ask when the label says it should have. */
  readonly missedClarification: boolean;
  readonly errorCategory: string | null;
  readonly latencyMs: number;
}

export function scoreFixture(
  fixture: ExtractionFixture,
  actual: Extraction | null,
  latencyMs: number,
  errorCategory: string | null = null,
): FixtureScore {
  if (actual === null) {
    return {
      id: fixture.id,
      matched: null,
      kindMatched: null,
      invented: [],
      // A failed call writes nothing. Counting it as a wrong mutation would
      // reward a provider for answering wrongly over one that fails loudly.
      wrongMutationRisk: false,
      unnecessaryClarification: false,
      missedClarification: false,
      errorCategory: errorCategory ?? "unknown",
      latencyMs,
    };
  }

  const matched = matchesExpected(actual, fixture.expected);
  const invented = forbiddenFieldsPresent(actual, fixture.forbids);
  const expectedUncertain = hasUncertain(fixture.expected);
  const actualUncertain = hasUncertain(actual);

  return {
    id: fixture.id,
    matched,
    kindMatched: kindsOf(actual) === kindsOf(fixture.expected),
    invented,
    wrongMutationRisk: invented.length > 0 || (!matched && actual.intents.some(drivesWrite)),
    unnecessaryClarification: !expectedUncertain && actualUncertain,
    missedClarification: expectedUncertain && !actualUncertain,
    errorCategory: null,
    latencyMs,
  };
}

export interface ProviderReport {
  readonly provider: string;
  readonly model: string;
  readonly fixtures: number;
  readonly answered: number;
  readonly fullMatchRate: number;
  readonly intentKindAccuracy: number;
  readonly wrongMutationRisk: number;
  readonly inventedFields: number;
  readonly unnecessaryClarifications: number;
  readonly missedClarifications: number;
  readonly failures: number;
  readonly avgLatencyMs: number;
}

const ratio = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);

export function aggregate(
  provider: string,
  model: string,
  scores: readonly FixtureScore[],
): ProviderReport {
  const answered = scores.filter((score) => score.matched !== null);
  return {
    provider,
    model,
    fixtures: scores.length,
    answered: answered.length,
    // Rates are over ALL fixtures, not just answered ones: a provider that
    // fails half the set must not score as accurate on the half it answered.
    fullMatchRate: ratio(answered.filter((s) => s.matched).length, scores.length),
    intentKindAccuracy: ratio(answered.filter((s) => s.kindMatched).length, scores.length),
    wrongMutationRisk: scores.filter((s) => s.wrongMutationRisk).length,
    inventedFields: scores.reduce((sum, s) => sum + s.invented.length, 0),
    unnecessaryClarifications: scores.filter((s) => s.unnecessaryClarification).length,
    missedClarifications: scores.filter((s) => s.missedClarification).length,
    failures: scores.length - answered.length,
    avgLatencyMs: ratio(
      scores.reduce((sum, s) => sum + s.latencyMs, 0),
      scores.length,
    ),
  };
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

/** A plain-text comparison table. Numbers come only from real reports. */
export function formatTable(reports: readonly ProviderReport[]): string {
  const header = [
    "Provider",
    "Model",
    "Match",
    "Intent",
    "WrongMut",
    "Invented",
    "Unneeded?",
    "Missed?",
    "Failed",
    "Latency",
  ];
  const rows = reports.map((r) => [
    r.provider,
    r.model,
    pct(r.fullMatchRate),
    pct(r.intentKindAccuracy),
    String(r.wrongMutationRisk),
    String(r.inventedFields),
    String(r.unnecessaryClarifications),
    String(r.missedClarifications),
    `${r.failures}/${r.fixtures}`,
    `${(r.avgLatencyMs / 1000).toFixed(2)}s`,
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]!.length)));
  const line = (cells: readonly string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  return [line(header), ...rows.map(line)].join("\n");
}

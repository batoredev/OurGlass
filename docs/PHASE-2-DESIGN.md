# Phase 2 design — Interpret + Resolve

Phase 2 interprets natural-language utterances without mutating state.

## Trust boundary

`apps/api/src/assistant/extract.ts` forces Claude to call one strict `extract_intents` tool.
The shared contract in `packages/shared/src/extraction-schema.ts` prevents the API and live
eval lane from drifting. It contains the six spec §5 kinds: `information`, `action`,
`completion_update`, `context`, `question`, and `execution`; every intent carries one spec §12
level: `CONFIRMED`, `INFERRED`, or `UNCERTAIN`.

The model returns entity mentions and verbatim time phrases only. It receives no database
handle, UUID, mutation tool, or permission to act. `isExtraction` validates it at runtime.
Phase 1 remains authoritative: Resolve obtains IDs, the tool layer validates, then a
transaction commits and logs.

## Time and resolution policy

`chrono-node` 2.10.1 alone resolves deterministic phrases from the verbatim phrase, reference
instant, and IANA timezone. The model never does date arithmetic. `tomorrow at 5pm` becomes a
candidate `timestamptz`; `before the meeting` stays relational; `after Arun replies` stays an
event trigger. Unparseable phrases stay `unresolved`, never silently become a date.

Name resolution is three-band: >=0.92 and one candidate auto-resolves; 0.65–0.92 (or a tie)
asks; below 0.65 rejects. There is no transitive similarity or merge. Duplicate detection uses
the same conservative lexical interim until Phase 4 embeddings. Owner/recipient direction and
completed-vs-non-completed state are hard vetoes before similarity.

## Evals, trace and cost

`packages/evals/src/fixtures.ts` has 50 hand-labelled fictional spec cases; fixture evaluation
is deterministic and runs on every PR. `test:live` uses the exact shared prompt/schema but only
on a manual dispatch with `ANTHROPIC_API_KEY`. It makes 50 paid model calls and is never a
routine local or PR command.

The extractor returns model ID, request ID when available, input/output token counts, and
latency. Phase 3 must persist this trace with the message when it adds the transport and
orchestrator; Phase 2 deliberately creates no messages or user-state mutations.

## Phase 3 handoff

Consume `ExtractionResult`, resolve mentions via `resolvePersonMention`, translate only `auto`
resolutions into Phase 1 `ToolCall`s, ask for every `ask`/`reject`/`unresolved` result, and
persist the trace. Never write SQL from model output.

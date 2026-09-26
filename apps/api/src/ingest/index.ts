/**
 * Phase 6 ingestion (docs/PHASE-6-DESIGN.md). The web upload route's one entry point.
 */
export {
  ingestDocument,
  MAX_NOTE_CHARS,
  MAX_READ_IMAGE_BYTES,
  type DocumentReader,
  type IngestDeps,
  type IngestOutcome,
  type IngestRequest,
  type IngestResponse,
} from "./ingest.js";
export {
  DOCUMENTS_BUCKET,
  MemoryObjectStore,
  StorageError,
  SupabaseObjectStore,
  objectStoreFromEnv,
  type ObjectStore,
  type StoredObject,
} from "../storage/object-store.js";

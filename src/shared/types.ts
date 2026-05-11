/**
 * 共有型のエントリポイント。
 * Transcript 関連は Zod スキーマから導出した型を re-export することで、
 * スキーマと型を一元管理する。
 *
 * 命名規則:
 *   - `XxxSchema` … Zod スキーマ (値)
 *   - `Xxx`       … スキーマから導出した TS 型
 */

export {
  TranscriptSchema,
  SegmentSchema,
  AISuggestionSchema,
  RecordedAtSourceSchema,
  TRANSCRIPT_SCHEMA_VERSION,
  validateTranscript,
} from "./transcript-schema.js";
export type {
  Transcript,
  Segment,
  AISuggestion,
  RecordedAtSource,
  TranscriptValidateResult,
} from "./transcript-schema.js";

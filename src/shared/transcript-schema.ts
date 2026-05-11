/**
 * 中間 Transcript JSON (`<video名>.transcript.json`) の Zod スキーマ。
 * 仕様書 §6 と完全一致させる。
 *
 * 型は本ファイルの `z.infer` で導出し、`src/shared/types.ts` から re-export する。
 * (Zod スキーマと TS 型を二重管理しないため)
 *
 * 命名規則:
 *   - `XxxSchema` … Zod スキーマ (値)
 *   - `Xxx`       … スキーマから導出した TS 型
 */

import { z } from "zod";

export const TRANSCRIPT_SCHEMA_VERSION = "1.1";

/** 撮影日時の取得元 */
export const RecordedAtSourceSchema = z.enum([
  "mp4_creation_time",
  "finder_creation_date",
  "unknown",
]);
export type RecordedAtSource = z.infer<typeof RecordedAtSourceSchema>;

export const SegmentSchema = z.object({
  /** 連番。AI 修正 CLI で参照するキー。配列 index と一致するとは限らない */
  id: z.number().int().nonnegative(),
  /** 開始秒 (小数2桁推奨) */
  start: z.number().nonnegative(),
  /** 終了秒 (小数2桁推奨) */
  end: z.number().nonnegative(),
  /** ASR 生テキスト。人間・AI ともに編集禁止 */
  text: z.string(),
  /** Whisper が検出した言語コード (`ja` / `en` 等)。不明時 null */
  language: z.string().nullable(),
  /** 話者ID。pyannote が取れなかった場合は null */
  speaker: z.string().nullable(),
  /** タイムラインに含めるか (デフォルト true) */
  use: z.boolean(),
  /** テロップ表示用文字列。null なら text を使う */
  telop_text: z.string().nullable(),
  /** AI 編集を受けたか (履歴管理) */
  ai_edited: z.boolean(),
});
export type Segment = z.infer<typeof SegmentSchema>;

/** 全体提案ドラフトの個別エントリ。仕様書 §6 では中身未定義のため緩めに受ける */
export const AISuggestionSchema = z.record(z.string(), z.unknown());
export type AISuggestion = z.infer<typeof AISuggestionSchema>;

export const TranscriptSchema = z.object({
  version: z.literal(TRANSCRIPT_SCHEMA_VERSION),
  /** 動画ファイル絶対パス */
  source_video: z.string(),
  /** 動画全体の長さ (秒) */
  video_duration_sec: z.number().nonnegative(),
  /** 撮影日時 (ISO8601)。取得不能時 null */
  recorded_at: z.string().nullable(),
  recorded_at_source: RecordedAtSourceSchema,
  /** 使用 ASR エンジン名 (例: "whisper-large-v3") */
  asr_engine: z.string(),
  /** エンジンのバージョン文字列 (履歴用) */
  asr_engine_version: z.string(),
  /** 動画フレームレート */
  fps: z.number().positive(),
  /** ISO8601 タイムスタンプ (生成時刻) */
  created_at: z.string(),
  segments: z.array(SegmentSchema),
  ai_suggestions: z.array(AISuggestionSchema),
});
export type Transcript = z.infer<typeof TranscriptSchema>;

/**
 * バリデーション結果を Result 型で返す薄いラッパー。
 * CLI からエラー詳細を出力したい場合に使う。
 */
export type TranscriptValidateResult =
  | { ok: true; value: Transcript }
  | { ok: false; error: z.ZodError };

export function validateTranscript(data: unknown): TranscriptValidateResult {
  const parsed = TranscriptSchema.safeParse(data);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, error: parsed.error };
}

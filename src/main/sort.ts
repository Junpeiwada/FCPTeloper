/**
 * recorded_at のパースと並び順決定 (フェーズ 4a)
 *
 * 仕様:
 *   - 仕様書 §8.1 (撮影日時の取得)
 *   - 仕様書 §11 (creation_time の ISO8601 形式差 / 撮影日時欠落動画)
 *   - 実装計画 フェーズ4a 詳細タスク
 *
 * 並び順の優先度:
 *   1. transcript.recorded_at が ISO8601 として解釈できれば、それを使う
 *   2. 解釈できない / null なら recorded_at_source による副情報を見る
 *   3. それでも決まらない場合は source_video のファイル名 (basename) で昇順
 *
 * 本モジュールは Electron 非依存。CLI / IPC 双方から再利用する。
 */

import { basename } from "node:path";
import type { Transcript } from "../shared/transcript-schema.js";

/**
 * ISO8601 文字列を `Date` にパースする。
 * `Z` 終わり / `+09:00` 形式の混在を Date コンストラクタで吸収する
 * (V8/Node の Date は両方対応している)。
 *
 * NaN になる入力では null を返す。
 */
export function parseIso8601(s: string | null | undefined): Date | null {
  if (s === null || s === undefined) return null;
  if (typeof s !== "string" || s.trim().length === 0) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * 並び順比較に使う複合キー。
 *
 * - hasTime=true なら time の昇順で並べる
 * - hasTime=false なら fallbackName (basename) の辞書順で並べる
 * - 両者を混ぜる場合は hasTime が先頭、その後に名前順
 */
export interface SortKey {
  hasTime: boolean;
  time: number;
  fallbackName: string;
}

export function makeSortKey(t: Transcript): SortKey {
  const d = parseIso8601(t.recorded_at);
  return {
    hasTime: d !== null,
    time: d?.getTime() ?? 0,
    fallbackName: basename(t.source_video),
  };
}

export function compareSortKey(a: SortKey, b: SortKey): number {
  if (a.hasTime && b.hasTime) {
    if (a.time !== b.time) return a.time - b.time;
    return a.fallbackName.localeCompare(b.fallbackName);
  }
  if (a.hasTime && !b.hasTime) return -1;
  if (!a.hasTime && b.hasTime) return 1;
  return a.fallbackName.localeCompare(b.fallbackName);
}

/**
 * Transcript[] を recorded_at 昇順 (フォールバックはファイル名) で並べ替える。
 * 入力は破壊せず新しい配列を返す。
 */
export function sortTranscripts(items: Transcript[]): Transcript[] {
  return [...items].sort((a, b) =>
    compareSortKey(makeSortKey(a), makeSortKey(b)),
  );
}

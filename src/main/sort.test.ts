/**
 * sort.ts のユニットテスト
 *
 * 仕様: 仕様書 §8.1 / §11 / 実装計画 フェーズ4a
 */

import { describe, it, expect } from "vitest";
import { parseIso8601, sortTranscripts } from "./sort.js";
import type { Transcript } from "../shared/transcript-schema.js";

function makeTranscript(over: Partial<Transcript> = {}): Transcript {
  return {
    version: "1.1",
    source_video: "/abs/a.mp4",
    video_duration_sec: 1,
    recorded_at: null,
    recorded_at_source: "unknown",
    asr_engine: "whisper-large-v3",
    asr_engine_version: "20250101",
    fps: 30,
    created_at: "2026-05-12T00:00:00Z",
    segments: [],
    ai_suggestions: [],
    ...over,
  };
}

describe("parseIso8601", () => {
  it("`Z` 終わりをパース", () => {
    expect(parseIso8601("2025-10-01T11:07:00Z")?.toISOString()).toBe(
      "2025-10-01T11:07:00.000Z",
    );
  });

  it("`+09:00` 形式をパース", () => {
    expect(parseIso8601("2025-10-01T20:07:00+09:00")?.toISOString()).toBe(
      "2025-10-01T11:07:00.000Z",
    );
  });

  it("null / 不正は null", () => {
    expect(parseIso8601(null)).toBeNull();
    expect(parseIso8601(undefined)).toBeNull();
    expect(parseIso8601("not-a-date")).toBeNull();
    expect(parseIso8601("")).toBeNull();
  });
});

describe("sortTranscripts", () => {
  it("recorded_at 昇順", () => {
    const items = [
      makeTranscript({
        source_video: "/abs/b.mp4",
        recorded_at: "2025-10-02T00:00:00Z",
      }),
      makeTranscript({
        source_video: "/abs/a.mp4",
        recorded_at: "2025-10-01T00:00:00Z",
      }),
    ];
    const sorted = sortTranscripts(items);
    expect(sorted.map((t) => t.source_video)).toEqual([
      "/abs/a.mp4",
      "/abs/b.mp4",
    ]);
  });

  it("recorded_at なしはファイル名順、ありが先", () => {
    const items = [
      makeTranscript({
        source_video: "/abs/zzz.mp4",
        recorded_at: "2025-10-01T00:00:00Z",
      }),
      makeTranscript({ source_video: "/abs/b.mp4", recorded_at: null }),
      makeTranscript({ source_video: "/abs/a.mp4", recorded_at: null }),
    ];
    const sorted = sortTranscripts(items);
    expect(sorted.map((t) => t.source_video)).toEqual([
      "/abs/zzz.mp4",
      "/abs/a.mp4",
      "/abs/b.mp4",
    ]);
  });

  it("`Z` と `+09:00` が混在しても正しく比較できる", () => {
    const items = [
      makeTranscript({
        source_video: "/abs/late.mp4",
        recorded_at: "2025-10-01T20:07:00+09:00", // UTC=11:07
      }),
      makeTranscript({
        source_video: "/abs/early.mp4",
        recorded_at: "2025-10-01T10:00:00Z",
      }),
    ];
    const sorted = sortTranscripts(items);
    expect(sorted.map((t) => t.source_video)).toEqual([
      "/abs/early.mp4",
      "/abs/late.mp4",
    ]);
  });
});

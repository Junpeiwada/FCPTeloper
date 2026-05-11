import { describe, it, expect } from "vitest";
import { validateTranscript } from "./transcript-schema.js";

const VALID_MINIMAL = {
  version: "1.1",
  source_video: "/abs/path/to/clip1.mp4",
  video_duration_sec: 123.45,
  recorded_at: "2025-10-01T11:07:00Z",
  recorded_at_source: "mp4_creation_time",
  asr_engine: "whisper-large-v3",
  asr_engine_version: "20250101",
  fps: 30,
  created_at: "2026-05-11T10:30:00+09:00",
  segments: [
    {
      id: 0,
      start: 1.2,
      end: 4.5,
      text: "こんにちは、今日はテストです。",
      language: "ja",
      speaker: "SPEAKER_00",
      use: true,
      telop_text: null,
      ai_edited: false,
    },
  ],
  ai_suggestions: [],
};

describe("validateTranscript", () => {
  it("accepts the spec §6 example", () => {
    const r = validateTranscript(VALID_MINIMAL);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.segments).toHaveLength(1);
    }
  });

  it("accepts recorded_at=null with recorded_at_source='unknown'", () => {
    const r = validateTranscript({
      ...VALID_MINIMAL,
      recorded_at: null,
      recorded_at_source: "unknown",
    });
    expect(r.ok).toBe(true);
  });

  it("accepts language=null and speaker=null", () => {
    const r = validateTranscript({
      ...VALID_MINIMAL,
      segments: [
        { ...VALID_MINIMAL.segments[0], language: null, speaker: null },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects wrong version", () => {
    const r = validateTranscript({ ...VALID_MINIMAL, version: "1.0" });
    expect(r.ok).toBe(false);
  });

  it("rejects missing required field (segments)", () => {
    const { segments: _omit, ...rest } = VALID_MINIMAL;
    const r = validateTranscript(rest);
    expect(r.ok).toBe(false);
  });

  it("rejects invalid recorded_at_source enum", () => {
    const r = validateTranscript({
      ...VALID_MINIMAL,
      recorded_at_source: "bogus",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects negative fps", () => {
    const r = validateTranscript({ ...VALID_MINIMAL, fps: -1 });
    expect(r.ok).toBe(false);
  });

  it("rejects segment without text", () => {
    const seg = { ...VALID_MINIMAL.segments[0] } as Record<string, unknown>;
    delete seg.text;
    const r = validateTranscript({ ...VALID_MINIMAL, segments: [seg] });
    expect(r.ok).toBe(false);
  });
});

/**
 * fps.ts のユニットテスト
 *
 * 仕様: 仕様書 §8.6 / §11 (NTSC 対応)
 */

import { describe, it, expect } from "vitest";
import {
  defaultFormatName,
  fpsEquals,
  frameDurationString,
  framesToFcpTime,
  normalizeFps,
  secondsToFrames,
} from "./fps.js";

describe("normalizeFps", () => {
  it("整数 fps (30) → {30,1}", () => {
    expect(normalizeFps(30)).toEqual({ num: 30, den: 1 });
  });

  it("整数 fps (60) → {60,1}", () => {
    expect(normalizeFps(60)).toEqual({ num: 60, den: 1 });
  });

  it("微小誤差 (30.0000001) は整数として扱う", () => {
    expect(normalizeFps(30.0000001)).toEqual({ num: 30, den: 1 });
  });

  it("29.97 → {30000, 1001}", () => {
    expect(normalizeFps(29.97)).toEqual({ num: 30000, den: 1001 });
  });

  it("ffprobe 由来の 30000/1001 値 → {30000, 1001}", () => {
    expect(normalizeFps(30000 / 1001)).toEqual({ num: 30000, den: 1001 });
  });

  it("59.94 → {60000, 1001}", () => {
    expect(normalizeFps(59.94)).toEqual({ num: 60000, den: 1001 });
  });

  it("ffprobe 由来の 60000/1001 値 → {60000, 1001}", () => {
    expect(normalizeFps(60000 / 1001)).toEqual({ num: 60000, den: 1001 });
  });

  it("未サポート fps (23.976) は例外", () => {
    expect(() => normalizeFps(23.976)).toThrowError(/unsupported fps/);
  });

  it("0 や負値・NaN は例外", () => {
    expect(() => normalizeFps(0)).toThrow();
    expect(() => normalizeFps(-30)).toThrow();
    expect(() => normalizeFps(Number.NaN)).toThrow();
  });
});

describe("fpsEquals", () => {
  it("同一値は true", () => {
    expect(
      fpsEquals({ num: 60000, den: 1001 }, { num: 60000, den: 1001 }),
    ).toBe(true);
  });
  it("異なる値は false", () => {
    expect(fpsEquals({ num: 30, den: 1 }, { num: 60, den: 1 })).toBe(false);
    expect(
      fpsEquals({ num: 30, den: 1 }, { num: 30000, den: 1001 }),
    ).toBe(false);
  });
});

describe("secondsToFrames", () => {
  it("整数 fps: round(秒×fps)", () => {
    expect(secondsToFrames(1, { num: 30, den: 1 })).toBe(30);
    expect(secondsToFrames(0.05, { num: 30, den: 1 })).toBe(2); // 1.5 -> 2
    expect(secondsToFrames(0.04, { num: 30, den: 1 })).toBe(1); // 1.2 -> 1
  });

  it("NTSC 59.94: 1 秒 ≈ 60 frames", () => {
    expect(secondsToFrames(1, { num: 60000, den: 1001 })).toBe(60);
  });

  it("NTSC 59.94: 1001 秒 = 60000 frames (累積でドリフトしない)", () => {
    expect(secondsToFrames(1001, { num: 60000, den: 1001 })).toBe(60000);
  });
});

describe("framesToFcpTime", () => {
  it("0 frames は '0s'", () => {
    expect(framesToFcpTime(0, { num: 30, den: 1 })).toBe("0s");
  });

  it("整数 fps: 90/30s", () => {
    expect(framesToFcpTime(90, { num: 30, den: 1 })).toBe("90/30s");
  });

  it("NTSC 59.94: 60 frames → 60060/60000s (= 1.001s)", () => {
    expect(framesToFcpTime(60, { num: 60000, den: 1001 })).toBe(
      "60060/60000s",
    );
  });

  it("NTSC 29.97: 30 frames → 30030/30000s", () => {
    expect(framesToFcpTime(30, { num: 30000, den: 1001 })).toBe(
      "30030/30000s",
    );
  });
});

describe("frameDurationString", () => {
  it("整数 fps: 1/30s", () => {
    expect(frameDurationString({ num: 30, den: 1 })).toBe("1/30s");
  });
  it("NTSC 59.94: 1001/60000s", () => {
    expect(frameDurationString({ num: 60000, den: 1001 })).toBe("1001/60000s");
  });
});

describe("defaultFormatName", () => {
  it("整数 fps: FFVideoFormat1080p30", () => {
    expect(defaultFormatName(1080, { num: 30, den: 1 })).toBe(
      "FFVideoFormat1080p30",
    );
  });
  it("NTSC 59.94: FFVideoFormat1080p5994", () => {
    expect(defaultFormatName(1080, { num: 60000, den: 1001 })).toBe(
      "FFVideoFormat1080p5994",
    );
  });
  it("NTSC 29.97: FFVideoFormat1080p2997", () => {
    expect(defaultFormatName(1080, { num: 30000, den: 1001 })).toBe(
      "FFVideoFormat1080p2997",
    );
  });
});

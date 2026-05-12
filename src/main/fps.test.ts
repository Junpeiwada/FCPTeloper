/**
 * fps.ts のユニットテスト
 *
 * 仕様: 仕様書 §8.6 / 実装計画 フェーズ4a
 */

import { describe, it, expect } from "vitest";
import { ensureIntegerFps, secondsToFrames } from "./fps.js";

describe("ensureIntegerFps", () => {
  it("整数 fps (30) を受け入れる", () => {
    const r = ensureIntegerFps(30);
    expect(r.fps).toBe(30);
    expect(r.rawFps).toBe(30);
  });

  it("整数 fps (60) を受け入れる", () => {
    expect(ensureIntegerFps(60).fps).toBe(60);
  });

  it("微小誤差 (30.0000001) は整数として扱う", () => {
    expect(ensureIntegerFps(30.0000001).fps).toBe(30);
  });

  it("非整数 fps (29.97) は例外", () => {
    expect(() => ensureIntegerFps(29.97)).toThrowError(/non-integer fps/);
  });

  it("非整数 fps (59.94) は例外", () => {
    expect(() => ensureIntegerFps(59.94)).toThrowError(/non-integer fps/);
  });

  it("0 や負値は例外", () => {
    expect(() => ensureIntegerFps(0)).toThrow();
    expect(() => ensureIntegerFps(-30)).toThrow();
    expect(() => ensureIntegerFps(Number.NaN)).toThrow();
  });
});

describe("secondsToFrames", () => {
  it("丸めは round (0.5 は 切り上げ)", () => {
    expect(secondsToFrames(1, 30)).toBe(30);
    expect(secondsToFrames(0.05, 30)).toBe(2); // 1.5 -> 2
    expect(secondsToFrames(0.04, 30)).toBe(1); // 1.2 -> 1
  });
});

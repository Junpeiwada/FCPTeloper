/**
 * ffprobe.ts のユニットテスト (parseRational のみ。
 * probeVideo 自体は外部 ffprobe を必要とするため CLI 検証で確認する)
 */

import { describe, it, expect } from "vitest";
import { parseRational } from "./ffprobe.js";

describe("parseRational", () => {
  it("'30/1' → 30", () => {
    expect(parseRational("30/1")).toBe(30);
  });

  it("'30000/1001' → 29.97 相当", () => {
    expect(parseRational("30000/1001")).toBeCloseTo(30000 / 1001, 6);
  });

  it("'0/0' は null (音声/データストリーム)", () => {
    expect(parseRational("0/0")).toBeNull();
  });

  it("空文字・undefined は null", () => {
    expect(parseRational("")).toBeNull();
    expect(parseRational(undefined)).toBeNull();
  });

  it("不正フォーマット '30abc/1' は null (H-3: parseInt の素通しを防ぐ)", () => {
    expect(parseRational("30abc/1")).toBeNull();
  });

  it("'3e2/1' のような指数表記も null", () => {
    expect(parseRational("3e2/1")).toBeNull();
  });

  it("負数 '-30/1' は null (本質的に正の rational のみ受ける)", () => {
    expect(parseRational("-30/1")).toBeNull();
  });

  it("分母 0 は null", () => {
    expect(parseRational("30/0")).toBeNull();
  });
});

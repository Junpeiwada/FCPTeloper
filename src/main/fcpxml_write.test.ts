/**
 * fcpxml_write.ts のユニットテスト
 *
 * 仕様: 仕様書 §8.3〜§8.7 / 実装計画 フェーズ4a
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFcpxml,
  framesToFcpTime,
  pathToFileUrl,
} from "./fcpxml_write.js";
import { validateTranscript } from "../shared/transcript-schema.js";

const __dirname_local = dirname(fileURLToPath(import.meta.url));
const sampleInputPath = resolve(
  __dirname_local,
  "../../tests/samples/sample01.input.transcript.json",
);

function loadSample() {
  const raw = readFileSync(sampleInputPath, "utf-8");
  const v = validateTranscript(JSON.parse(raw));
  if (!v.ok) throw new Error("sample invalid");
  return v.value;
}

describe("framesToFcpTime", () => {
  it("0 frames は '0s'", () => {
    expect(framesToFcpTime(0, 30)).toBe("0s");
  });
  it("90 frames @ 30fps は '90/30s'", () => {
    expect(framesToFcpTime(90, 30)).toBe("90/30s");
  });
});

describe("pathToFileUrl", () => {
  it("絶対パスを file:// URL に変換", () => {
    expect(pathToFileUrl("/abs/path/to/clip.mp4")).toBe(
      "file:///abs/path/to/clip.mp4",
    );
  });
  it("スペースは %20 にエンコード", () => {
    expect(pathToFileUrl("/abs/has space/clip.mp4")).toBe(
      "file:///abs/has%20space/clip.mp4",
    );
  });
  it("ASCII 記号 ( ) ' は過剰エンコードしない", () => {
    // Node pathToFileURL は unreserved + sub-delims の一部を素通す
    const url = pathToFileUrl("/abs/(paren)/it's.mp4");
    expect(url.startsWith("file:///abs/")).toBe(true);
    expect(url).not.toContain("%28"); // (
    expect(url).not.toContain("%29"); // )
    expect(url).not.toContain("%27"); // '
  });
  it("非絶対パスは例外", () => {
    expect(() => pathToFileUrl("relative/clip.mp4")).toThrow();
  });
});

describe("buildFcpxml", () => {
  it("空配列は例外", () => {
    expect(() => buildFcpxml([])).toThrow();
  });

  it("基本ケース: <asset>, <asset-clip>, <title> が生成される", () => {
    const t = loadSample();
    const xml = buildFcpxml([t]);
    expect(xml).toContain('<fcpxml version="1.11">');
    expect(xml).toContain("file:///abs/path/to/sample01.mp4");
    // use:true セグメント (id=0,2,3) のみ → asset-clip 3 個
    const clipCount = (xml.match(/<asset-clip /g) ?? []).length;
    expect(clipCount).toBe(3);
    const titleCount = (xml.match(/<title /g) ?? []).length;
    expect(titleCount).toBe(3);
    // telop_text=null のセグメントは ASR text を使う
    expect(xml).toContain("Nice to meet you.");
    // telop_text 有りはそちらを使う
    expect(xml).toContain("こんにちは");
    // & は XML エスケープされる
    expect(xml).toContain("よろしく &amp; お願いします");
  });

  it("<asset> および <asset-clip> は format 属性を持たない (M-1)", () => {
    const xml = buildFcpxml([loadSample()]);
    expect(xml).not.toMatch(/<asset [^>]*\bformat="/);
    expect(xml).not.toMatch(/<asset-clip [^>]*\bformat="/);
  });

  it("<text-style-def> は <resources> 配下に 1 回だけ (L-3)", () => {
    const xml = buildFcpxml([loadSample()]);
    expect((xml.match(/<text-style-def /g) ?? []).length).toBe(1);
  });

  it("use:false のセグメントは出力されない", () => {
    const t = loadSample();
    const xml = buildFcpxml([t]);
    expect(xml).not.toContain("えーと、その、");
  });

  it("全 use:false なら asset-clip が 0 個", () => {
    const t = loadSample();
    t.segments = t.segments.map((s) => ({ ...s, use: false }));
    const xml = buildFcpxml([t]);
    expect((xml.match(/<asset-clip /g) ?? []).length).toBe(0);
  });

  it("非整数 fps は例外", () => {
    const t = loadSample();
    t.fps = 29.97;
    expect(() => buildFcpxml([t])).toThrowError(/non-integer fps/);
  });

  it("動画間で fps が異なるとエラー", () => {
    const t1 = loadSample();
    const t2 = { ...loadSample(), source_video: "/abs/other.mp4", fps: 60 };
    expect(() => buildFcpxml([t1, t2])).toThrowError(/mixed fps/);
  });

  it("同一 source_video が重複するとエラー (M-3)", () => {
    const t1 = loadSample();
    const t2 = loadSample();
    expect(() => buildFcpxml([t1, t2])).toThrowError(/duplicate source_video/);
  });

  it("source_video が相対パスならエラー", () => {
    const t = loadSample();
    t.source_video = "relative/clip.mp4";
    expect(() => buildFcpxml([t])).toThrow(/absolute path/);
  });

  it("projectName に {RESOURCES} 等のプレースホルダ文字列が混入しても暴発しない (M-2)", () => {
    const t = loadSample();
    const xml = buildFcpxml([t], { projectName: "Evil {RESOURCES} Name" });
    // プレースホルダは XML エスケープを通った上でそのまま残る
    expect(xml).toContain("Evil {RESOURCES} Name");
    // 本来の <asset> も 1 回だけ
    expect((xml.match(/<asset /g) ?? []).length).toBe(1);
  });

  it("telop に改行が含まれていてもスペースに正規化される (M-7)", () => {
    const t = loadSample();
    t.segments = [
      {
        ...t.segments[0],
        use: true,
        telop_text: "line1\nline2\r\nline3",
        ai_edited: true,
      },
    ];
    const xml = buildFcpxml([t]);
    expect(xml).toContain("line1 line2 line3");
    expect(xml).not.toMatch(/line1\n/);
  });
});

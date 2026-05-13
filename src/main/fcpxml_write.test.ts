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
  buildFcpxmlFromTranscripts,
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
    const xml = buildFcpxmlFromTranscripts([t]);
    expect(xml).toContain('<fcpxml version="1.11">');
    // FCPXML DTD: <asset> は src を持たず、<media-rep> 子要素で src を表現する
    expect(xml).toContain(
      '<media-rep kind="original-media" src="file:///abs/path/to/sample01.mp4"/>',
    );
    expect(xml).not.toMatch(/<asset [^>]*\bsrc="/);
    // 新仕様: 1動画 = 1 <asset-clip> (全長配置)
    const clipCount = (xml.match(/<asset-clip /g) ?? []).length;
    expect(clipCount).toBe(1);
    // use:true セグメント (id=0,2,3) → <title> 3 個 (lane=1 として asset-clip 配下に重なる)
    const titleCount = (xml.match(/<title /g) ?? []).length;
    expect(titleCount).toBe(3);
    // telop_text=null のセグメントは ASR text を使う
    expect(xml).toContain("Nice to meet you.");
    // telop_text 有りはそちらを使う
    expect(xml).toContain("こんにちは");
    // & は XML エスケープされる
    expect(xml).toContain("よろしく &amp; お願いします");
  });

  it("<asset> と <asset-clip> はともに format=\"r0\" を持つ (FCP の素材解決のため)", () => {
    const xml = buildFcpxmlFromTranscripts([loadSample()]);
    expect(xml).toMatch(/<asset [^>]*\bformat="r0"/);
    // FCP は asset-clip にも format と tcFormat を必要とする (実機エクスポートに準拠)
    expect(xml).toMatch(/<asset-clip [^>]*\bformat="r0"/);
    expect(xml).toMatch(/<asset-clip [^>]*\btcFormat="NDF"/);
  });

  it("<text-style-def> は最初の <title> 内に 1 度だけ定義される (DTD 適合)", () => {
    const xml = buildFcpxmlFromTranscripts([loadSample()]);
    expect((xml.match(/<text-style-def /g) ?? []).length).toBe(1);
    // <resources> 配下には存在しない (DTD は asset|effect|format|media|locator のみ許容)
    const resourcesBlock = xml.slice(
      xml.indexOf("<resources>"),
      xml.indexOf("</resources>") + "</resources>".length,
    );
    expect(resourcesBlock).not.toContain("<text-style-def");
  });

  it("<asset> は <media-rep> 子要素で src を持つ (DTD 適合)", () => {
    const xml = buildFcpxmlFromTranscripts([loadSample()]);
    expect((xml.match(/<media-rep /g) ?? []).length).toBe(1);
    expect(xml).not.toMatch(/<asset [^>]*\bsrc="/);
  });

  it("use:false のセグメントは <title> として出力されない (動画クリップは残る)", () => {
    const t = loadSample();
    const xml = buildFcpxmlFromTranscripts([t]);
    expect(xml).not.toContain("えーと、その、");
    // 動画自体は残る
    expect((xml.match(/<asset-clip /g) ?? []).length).toBe(1);
  });

  it("全 use:false でも動画クリップは残り、<title> は 0 個になる", () => {
    const t = loadSample();
    t.segments = t.segments.map((s) => ({ ...s, use: false }));
    const xml = buildFcpxmlFromTranscripts([t]);
    expect((xml.match(/<asset-clip /g) ?? []).length).toBe(1);
    expect((xml.match(/<title /g) ?? []).length).toBe(0);
  });

  it("transcript の無い動画も buildFcpxml に並べられる (新仕様)", () => {
    const xml = buildFcpxml([
      {
        videoPath: "/abs/foo/no-transcript.mp4",
        videoDurationSec: 12.5,
        fps: 30,
        recordedAt: null,
        transcript: null,
      },
    ]);
    expect((xml.match(/<asset-clip /g) ?? []).length).toBe(1);
    expect((xml.match(/<title /g) ?? []).length).toBe(0);
    expect(xml).toContain("no-transcript.mp4");
  });

  it("未サポート fps (23.976) は例外", () => {
    const t = loadSample();
    t.fps = 23.976;
    expect(() => buildFcpxmlFromTranscripts([t])).toThrowError(
      /unsupported fps/,
    );
  });

  it("NTSC fps (59.94) は frameDuration が有理数表記になる", () => {
    const t = loadSample();
    t.fps = 60000 / 1001;
    const xml = buildFcpxmlFromTranscripts([t]);
    expect(xml).toContain('frameDuration="1001/60000s"');
    expect(xml).toContain('name="FFVideoFormat1920x1080p5994"');
    expect(xml).toMatch(/duration="\d+\/60000s"/);
    expect(xml).not.toMatch(/\b\d+\/60s"/);
  });

  it("NTSC fps (29.97) も frameDuration が有理数表記になる", () => {
    const t = loadSample();
    t.fps = 30000 / 1001;
    const xml = buildFcpxmlFromTranscripts([t]);
    expect(xml).toContain('frameDuration="1001/30000s"');
    expect(xml).toContain('name="FFVideoFormat1920x1080p2997"');
  });

  it("動画間で fps が異なるとエラー", () => {
    const t1 = loadSample();
    const t2 = { ...loadSample(), source_video: "/abs/other.mp4", fps: 60 };
    expect(() => buildFcpxmlFromTranscripts([t1, t2])).toThrowError(
      /mixed fps/,
    );
  });

  it("同一 videoPath が重複するとエラー (M-3)", () => {
    const t1 = loadSample();
    const t2 = loadSample();
    expect(() => buildFcpxmlFromTranscripts([t1, t2])).toThrowError(
      /duplicate videoPath/,
    );
  });

  it("videoPath が相対パスならエラー", () => {
    const t = loadSample();
    t.source_video = "relative/clip.mp4";
    expect(() => buildFcpxmlFromTranscripts([t])).toThrow(/absolute path/);
  });

  it("projectName に {RESOURCES} 等のプレースホルダ文字列が混入しても暴発しない (M-2)", () => {
    const t = loadSample();
    const xml = buildFcpxmlFromTranscripts([t], {
      projectName: "Evil {RESOURCES} Name",
    });
    expect(xml).toContain("Evil {RESOURCES} Name");
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
    const xml = buildFcpxmlFromTranscripts([t]);
    expect(xml).toContain("line1 line2 line3");
    expect(xml).not.toMatch(/line1\n/);
  });
});

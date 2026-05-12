/**
 * FCPXML 新規モード生成 (フェーズ 4a)
 *
 * 仕様: 仕様書 §8.3〜§8.7 / 実装計画 フェーズ4a
 *
 * 設計方針:
 *   - 純粋関数: Electron 非依存、入出力は値のみ
 *   - 出力は文字列テンプレート + 手書きエスケープで決定的に組み立てる
 *     (DOM 比較ハーネス側で属性順揺れを吸収する想定)
 *   - 動画は外部参照 (絶対パス) で <asset src="file://..."> を作る (仕様書 §8.7)
 *   - すべての use:true セグメントを spine 上に直列に連結する
 *   - 各セグメントには Basic Title を子要素として重ねる
 *   - <text-style-def> は <resources> 配下に 1 回だけ定義する (XML 的な id 衝突回避)
 *
 * fps はすべての入力動画で揃っている前提 (フェーズ4aは整数fps限定、§8.6)。
 * 動画間で fps が異なる場合は呼び出し側がエラーにする責務。
 *
 * テンプレートはビルド成果物への同梱を避けるため、TS 文字列リテラルとして
 * このファイル内に保持する。`templates/basic_title.fcpxml` は人間向けの
 * 参考ドキュメントとしてのみ残す。
 */

import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import type { Transcript, Segment } from "../shared/transcript-schema.js";
import { ensureIntegerFps, secondsToFrames } from "./fps.js";
import { sortTranscripts } from "./sort.js";

export interface BuildFcpxmlOptions {
  /** 出力プロジェクト名 (event/project の name に使う) */
  projectName?: string;
  /** 解像度 (仕様書では 1080p 基準。明示しない場合は 1920x1080) */
  width?: number;
  height?: number;
  /** フォーマット名 (FCP 既定値: FFVideoFormat<height>p<fps>) */
  formatName?: string;
}

const STYLE_ID = "ts1";

/**
 * Transcript[] (1 つ以上) から FCPXML 文字列を生成する。
 * 入力は recorded_at 昇順 (フォールバックはファイル名) で並べ替えてから処理する。
 */
export function buildFcpxml(
  transcripts: Transcript[],
  options: BuildFcpxmlOptions = {},
): string {
  if (transcripts.length === 0) {
    throw new Error("buildFcpxml: transcripts must contain at least one item");
  }

  const fpsSet = new Set(transcripts.map((t) => t.fps));
  if (fpsSet.size !== 1) {
    throw new Error(
      `buildFcpxml: mixed fps not supported (got ${[...fpsSet].join(", ")})`,
    );
  }
  const rawFps = transcripts[0].fps;
  const { fps } = ensureIntegerFps(rawFps);

  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const projectName = options.projectName ?? "FCPTeloper";
  const formatName = options.formatName ?? `FFVideoFormat${height}p${fps}`;

  const sorted = sortTranscripts(transcripts);

  // 各動画に asset id を振る。重複 source_video は明示エラー。
  const assetIds = new Map<string, string>();
  for (const t of sorted) {
    if (assetIds.has(t.source_video)) {
      throw new Error(
        `buildFcpxml: duplicate source_video not allowed (${t.source_video})`,
      );
    }
    assetIds.set(t.source_video, `r_asset_${assetIds.size + 1}`);
  }

  // spine: 各 use:true セグメントを順次連結し、累積 offset を計算
  let cursorFrames = 0;
  const spineParts: string[] = [];

  for (const t of sorted) {
    const assetId = assetIds.get(t.source_video)!;
    const used = t.segments.filter((s) => s.use);
    for (const seg of used) {
      const startF = secondsToFrames(seg.start, fps);
      const endF = secondsToFrames(seg.end, fps);
      const durF = endF - startF;
      if (durF <= 0) {
        // 0 長 or 逆転は skip して警告
        process.stderr.write(
          `[fcpxml_write] skipping zero-length segment id=${seg.id} in ${t.source_video}\n`,
        );
        continue;
      }
      spineParts.push(
        renderAssetClip({
          assetId,
          name: assetClipName(t, seg),
          offsetFrames: cursorFrames,
          startFrames: startF,
          durationFrames: durF,
          fps,
          telop: telopText(seg),
        }),
      );
      cursorFrames += durF;
    }
  }

  const sequenceDuration = framesToFcpTime(cursorFrames, fps);

  const resourceParts: string[] = [];
  for (const t of sorted) {
    const id = assetIds.get(t.source_video)!;
    const durF = secondsToFrames(t.video_duration_sec, fps);
    resourceParts.push(
      renderAsset({
        id,
        name: assetClipBaseName(t),
        src: t.source_video,
        durationFrames: durF,
        fps,
      }),
    );
  }

  return fillTemplate(TEMPLATE, {
    FORMAT_NAME: xmlEscape(formatName),
    FRAME_DURATION: `1/${fps}s`,
    WIDTH: String(width),
    HEIGHT: String(height),
    PROJECT_NAME: xmlEscape(projectName),
    RESOURCES: resourceParts.join("\n    "),
    SEQUENCE_DURATION: sequenceDuration,
    SPINE_BODY: spineParts.join("\n            "),
    STYLE_ID,
  });
}

/* ------------------------------ helpers ------------------------------ */

function assetClipBaseName(t: Transcript): string {
  const parts = t.source_video.split("/");
  return parts[parts.length - 1] ?? t.source_video;
}

function assetClipName(t: Transcript, seg: Segment): string {
  return `${assetClipBaseName(t)} #${seg.id}`;
}

function telopText(seg: Segment): string {
  const raw =
    seg.telop_text !== null && seg.telop_text.length > 0
      ? seg.telop_text
      : seg.text;
  // 仕様書 §8.4 は「全角 18 字で自動改行」だがフェーズ4a では未実装。
  // 入力に改行が混入していたら単一スペースに正規化する (FCP 表示の崩れ防止)。
  return raw.replace(/[\r\n\t]+/g, " ").trim();
}

/**
 * フレーム数を FCPXML の時間表記 "N/fps s" に変換する。
 *
 * 例: 90 frames @ 30fps → "90/30s"
 * 0 frames は特別扱いで "0s" (FCP の慣習に合わせる)。
 */
export function framesToFcpTime(frames: number, fps: number): string {
  if (frames === 0) return "0s";
  return `${frames}/${fps}s`;
}

interface AssetParams {
  id: string;
  name: string;
  src: string;
  durationFrames: number;
  fps: number;
}

function renderAsset(p: AssetParams): string {
  if (!isAbsolute(p.src)) {
    throw new Error(
      `fcpxml_write: source_video must be absolute path (got "${p.src}")`,
    );
  }
  const fileUrl = pathToFileUrl(p.src);
  const dur = framesToFcpTime(p.durationFrames, p.fps);
  // `<asset>` の format 属性は省略する (M-1 対応)。シーケンス側のみ format を持つ。
  return (
    `<asset id="${p.id}" name="${xmlEscape(p.name)}" src="${xmlEscape(fileUrl)}" ` +
    `start="0s" duration="${dur}" hasVideo="1" hasAudio="1"/>`
  );
}

interface AssetClipParams {
  assetId: string;
  name: string;
  offsetFrames: number;
  startFrames: number;
  durationFrames: number;
  fps: number;
  telop: string;
}

function renderAssetClip(p: AssetClipParams): string {
  const offset = framesToFcpTime(p.offsetFrames, p.fps);
  const start = framesToFcpTime(p.startFrames, p.fps);
  const dur = framesToFcpTime(p.durationFrames, p.fps);
  return [
    `<asset-clip ref="${p.assetId}" name="${xmlEscape(p.name)}" offset="${offset}" start="${start}" duration="${dur}">`,
    `              ${renderTitle({ offset, duration: dur, telop: p.telop })}`,
    `            </asset-clip>`,
  ].join("\n");
}

interface TitleParams {
  offset: string;
  duration: string;
  telop: string;
}

function renderTitle(p: TitleParams): string {
  // <text-style-def> は <resources> 配下に 1 回だけ定義し、ここでは ref のみ
  return [
    `<title ref="r_title" lane="1" offset="${p.offset}" duration="${p.duration}" name="Telop">`,
    `                <text>`,
    `                  <text-style ref="${STYLE_ID}">${xmlEscape(p.telop)}</text-style>`,
    `                </text>`,
    `              </title>`,
  ].join("\n");
}

/**
 * 1 度のパスで `{NAME}` プレースホルダを置換する。
 * 値内に `{...}` が含まれても再帰展開しない (M-2 対応)。
 */
function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{([A-Z_]+)\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key];
    return match;
  });
}

function xmlEscape(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * 絶対パスを file:// URL に変換する。Node 標準 `pathToFileURL` に委譲して
 * RFC 3986 準拠の最小エンコード (スペース→%20、日本語等の非 ASCII のみ
 * percent-encoding) に揃える (H-2 対応)。
 */
export function pathToFileUrl(absPath: string): string {
  if (!isAbsolute(absPath)) {
    throw new Error(`pathToFileUrl: not absolute (${absPath})`);
  }
  return pathToFileURL(absPath).href;
}

/**
 * FCPXML テンプレート。プレースホルダは `{NAME}` 形式 (`[A-Z_]+`)。
 * 内容変更時は tests/samples/sample01.expected.fcpxml の再生成が必要。
 *
 * <resources> 配下:
 *   - <format>: シーケンス用 1 つ
 *   - <effect>: Basic Title 1 つ
 *   - <text-style-def>: テロップ固定スタイル (仕様書 §8.4) を 1 回だけ定義
 *   - {RESOURCES}: 各動画の <asset>
 */
const TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<fcpxml version="1.11">
  <resources>
    <format id="r0" name="{FORMAT_NAME}" frameDuration="{FRAME_DURATION}" width="{WIDTH}" height="{HEIGHT}" colorSpace="1-1-1 (Rec. 709)"/>
    <effect id="r_title" name="Basic Title" uid=".../Titles.localized/Build In_Out.localized/Basic Title.localized/Basic Title.moti"/>
    <text-style-def id="{STYLE_ID}">
      <text-style font="Hiragino Sans W6" fontSize="60" fontColor="1 1 1 1" strokeColor="0 0 0 1" strokeWidth="4"/>
    </text-style-def>
    {RESOURCES}
  </resources>
  <library>
    <event name="{PROJECT_NAME}">
      <project name="{PROJECT_NAME}">
        <sequence format="r0" duration="{SEQUENCE_DURATION}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
            {SPINE_BODY}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;

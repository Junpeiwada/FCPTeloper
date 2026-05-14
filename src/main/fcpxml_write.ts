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
import {
  defaultFormatName,
  fpsEquals,
  frameDurationString,
  framesToFcpTime as framesToFcpTimeRational,
  normalizeFps,
  secondsToFrames,
  type FpsRational,
} from "./fps.js";
import { compareSortKey, parseIso8601 } from "./sort.js";
import { basename } from "node:path";

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
 * テロップ文字スタイル定義。
 *
 * ここを書き換えるだけで生成される FCPXML 内の `<text-style>` 属性が変わる。
 * 値が空文字列 / null / undefined の項目は属性自体を出力しないので、無効化したい場合は
 * その項目を消す or 空にすればよい。
 *
 * 主な属性 (FCPXML <text-style> 仕様):
 *   font           フォント名 (例: "Hiragino Sans W6", "Helvetica Neue")
 *   fontSize       文字サイズ (px 換算ではなく FCP 内部単位; 60 で 1080p に対し中程度)
 *   fontColor      "R G B A" (0..1)。例: "1 1 1 1" は白、"1 1 0 1" は黄
 *   bold           "1" で太字
 *   italic         "1" でイタリック
 *   underline      "1" で下線
 *   strokeColor    アウトライン (枠) の色。空にすると枠なし
 *   strokeWidth    アウトラインの太さ (0 で枠なし)
 *   alignment      "left" / "center" / "right"
 *   lineSpacing    行間 (整数)
 *   shadowColor    影の色 "R G B A"
 *   shadowOffset   "<距離> <角度°>"
 *   shadowBlur     ぼかし量
 *
 * 一覧にない属性 (背景パネル等) は <text-style> では表現できず、別の Motion テンプレート
 * (effect uid) への切り替えが必要。
 */
export const TELOP_STYLE: Record<string, string> = {
  // FCP 「基本タイトル (Bumper:Opener > Basic Title)」での実機エクスポート値ベース。
  // 数値の単位は Motion 内部単位 (1080p 換算で fontSize=60 がおよそ FCP インスペクタ "60pt")。
  font: "Helvetica",
  fontSize: "100",
  fontColor: "1 1 1 1",
  bold: "1",
  // italic: "1",
  // underline: "1",
  strokeColor: "0 0 0 1",
  // strokeWidth: マイナス値で「内側にアウトライン (face をはみ出さない)」
  // 正値で外側、0 / 削除でアウトラインなし。
  strokeWidth: "-1",
  // shadowColor: "0 0 0 0.75",
  // shadowOffset: "5 315",
  // shadowBlur: "8",
  alignment: "center",
};

/**
 * <title> 要素直下に注入する <param> 一覧。
 * Basic Title テンプレート (Bumper:Opener) の主要パラメータを実機エクスポート値で固定する。
 *
 * key は Motion テンプレートが内部的に持つ ID 文字列で、Apple 同梱の Basic Title.moti と
 * 1:1 対応している。テンプレート (uid) を変えるとこの key 体系も変わるため、テンプレート
 * 差し替え時にはセットで更新する。
 *
 * 主な意味:
 *   位置        画面上の (X Y) 座標。Y 負値で下寄せ。
 *   サイズ      テキスト全体の倍率 (100=等倍)
 *   フォント    Motion 内部のフォント識別子 ("119 4" = Helvetica Regular)
 *   配置        テキスト揃え (1=水平方向に中央揃え)
 *   カラー      アウトライン要素のカラー (face 色は <text-style fontColor> で別管理)
 *   平坦化      "1" でレイヤーをフラット表示
 *   ラップモード "1" でリピート
 */
export const TITLE_PARAMS: ReadonlyArray<{
  name: string;
  key: string;
  value: string;
}> = [
  { name: "位置", key: "9999/999166631/999166633/1/100/101", value: "0 -388" },
  { name: "平坦化", key: "9999/999166631/999166633/2/351", value: "1" },
  {
    name: "配置",
    key: "9999/999166631/999166633/2/354/999169573/401",
    value: "1 (水平方向に中央揃え)",
  },
  {
    name: "サイズ",
    key: "9999/999166631/999166633/5/999166635/3",
    value: "100",
  },
  {
    name: "カラー",
    key: "9999/999166631/999166633/5/999166635/30/32",
    value: "0 0 0",
  },
  {
    name: "ラップモード",
    key: "9999/999166631/999166633/5/999166635/30/34/5",
    value: "1 (繰り返し)",
  },
  {
    name: "フォント",
    key: "9999/999166631/999166633/5/999166635/83",
    value: "119 4",
  },
];

function renderTextStyleTag(): string {
  const attrs = Object.entries(TELOP_STYLE)
    .filter(([, v]) => v !== "" && v != null)
    .map(([k, v]) => `${k}="${xmlEscape(String(v))}"`)
    .join(" ");
  return `<text-style ${attrs}/>`;
}

/**
 * buildFcpxml の入力 1 項目。
 *
 * 動画 1 本に対し、対応する transcript があれば渡す。transcript が無い動画も
 * タイムラインに並べられるよう、videoDurationSec / fps / recordedAt は別途必須にしている。
 *
 * 設計意図:
 *   - チェックされた動画は字幕の有無に関わらず全部 spine に並べたい (要望)
 *   - 動画は 1 本 = 1 <asset-clip> で配置し、ブレード分割しない
 *   - テロップ (use:true セグメント) は <asset-clip> 配下 lane=1 の <title> として乗せる
 */
export interface BuildFcpxmlInput {
  /** 動画ファイル絶対パス (DTD `<media-rep src>` に入る) */
  videoPath: string;
  /** 動画長さ秒。ffprobe または transcript.video_duration_sec から渡す */
  videoDurationSec: number;
  /** 動画の fps (整数 or 29.97 / 59.94) */
  fps: number;
  /** 撮影日時。並び順決定に使う。不明なら null (この場合は videoPath 順フォールバック) */
  recordedAt: string | null;
  /** 対応 transcript (任意)。あれば use:true セグメントだけテロップ化する */
  transcript: Transcript | null;
  /** 映像の横ピクセル数 (省略時は options.width → 1920 のフォールバック) */
  width?: number;
  /** 映像の縦ピクセル数 (省略時は options.height → 1080 のフォールバック) */
  height?: number;
  /** 埋め込みタイムコード "HH:MM:SS:FF" (GoPro 等)。asset.start と asset-clip.start に使う */
  timecode?: string | null;
}

/**
 * BuildFcpxmlInput[] (1 つ以上) から FCPXML 文字列を生成する。
 * 入力は recorded_at 昇順 (フォールバックは videoPath) で並べ替えてから処理する。
 */
export function buildFcpxml(
  inputs: BuildFcpxmlInput[],
  options: BuildFcpxmlOptions = {},
): string {
  if (inputs.length === 0) {
    throw new Error("buildFcpxml: inputs must contain at least one item");
  }

  const fpsList = inputs.map((i) => normalizeFps(i.fps));
  const fps = fpsList[0];
  for (const f of fpsList) {
    if (!fpsEquals(f, fps)) {
      const labels = [...new Set(inputs.map((i) => i.fps))].join(", ");
      throw new Error(`buildFcpxml: mixed fps not supported (got ${labels})`);
    }
  }

  // 解像度は inputs[0] の実測値を優先し、options > デフォルト (1920×1080) にフォールバック
  const width = options.width ?? inputs[0].width ?? 1920;
  const height = options.height ?? inputs[0].height ?? 1080;
  const projectName = options.projectName ?? "FCPTeloper";
  const formatName = options.formatName ?? defaultFormatName(width, height, fps);

  const sorted = sortBuildInputs(inputs);

  // 各動画に asset id を振る。重複 videoPath は明示エラー。
  const assetIds = new Map<string, string>();
  for (const i of sorted) {
    if (assetIds.has(i.videoPath)) {
      throw new Error(
        `buildFcpxml: duplicate videoPath not allowed (${i.videoPath})`,
      );
    }
    assetIds.set(i.videoPath, `r_asset_${assetIds.size + 1}`);
  }

  // spine: 1 動画 = 1 <asset-clip> をフル尺で連結。
  // use:true セグメントは lane=1 の <title> として asset-clip 配下に重ねる。
  let cursorFrames = 0;
  const spineParts: string[] = [];
  let styleDefEmitted = false;

  for (const item of sorted) {
    const assetId = assetIds.get(item.videoPath)!;
    const clipDurF = secondsToFrames(item.videoDurationSec, fps);
    if (clipDurF <= 0) {
      process.stderr.write(
        `[fcpxml_write] skipping zero-length video ${item.videoPath}\n`,
      );
      continue;
    }

    // この動画に対するテロップを構築 (transcript があり、use:true セグメントがあるなら)
    const titles: string[] = [];
    if (item.transcript) {
      for (const seg of item.transcript.segments) {
        if (!seg.use) continue;
        const segStartF = secondsToFrames(seg.start, fps);
        // seg.end が動画長を超えるケースはクリップ境界でクランプ (Whisper 誤検出等の対処)
        const segEndF = Math.min(secondsToFrames(seg.end, fps), clipDurF);
        const segDurF = segEndF - segStartF;
        if (segDurF <= 0) {
          process.stderr.write(
            `[fcpxml_write] skipping zero-length or overflow segment id=${seg.id} in ${item.videoPath}\n`,
          );
          continue;
        }
        // <title> の offset は親 <asset-clip> の時間軸 (= シーケンス絶対時間) に乗せる。
        // 親 asset-clip の offset が cursorFrames、start=0 なので、
        // セグメントの先頭は cursorFrames + segStartF (sequence の絶対位置) になる。
        const titleOffsetF = cursorFrames + segStartF;
        titles.push(
          renderTitle({
            offset: framesToFcpTimeRational(titleOffsetF, fps),
            duration: framesToFcpTimeRational(segDurF, fps),
            telop: telopText(seg),
            includeStyleDef: !styleDefEmitted,
          }),
        );
        styleDefEmitted = true;
      }
    }

    spineParts.push(
      renderAssetClip({
        assetId,
        name: assetClipBaseName(item),
        offsetFrames: cursorFrames,
        durationFrames: clipDurF,
        fps,
        titles,
        timecode: item.timecode,
      }),
    );
    cursorFrames += clipDurF;
  }

  const sequenceDuration = framesToFcpTime(cursorFrames, fps);

  const resourceParts: string[] = [];
  for (const item of sorted) {
    const id = assetIds.get(item.videoPath)!;
    const durF = secondsToFrames(item.videoDurationSec, fps);
    resourceParts.push(
      renderAsset({
        id,
        name: assetClipBaseName(item),
        src: item.videoPath,
        durationFrames: durF,
        fps,
        timecode: item.timecode,
      }),
    );
  }

  return fillTemplate(TEMPLATE, {
    FORMAT_NAME: xmlEscape(formatName),
    FRAME_DURATION: frameDurationString(fps),
    WIDTH: String(width),
    HEIGHT: String(height),
    PROJECT_NAME: xmlEscape(projectName),
    RESOURCES: resourceParts.join("\n    "),
    SEQUENCE_DURATION: sequenceDuration,
    SPINE_BODY: spineParts.join("\n            "),
    STYLE_ID,
  });
}

/**
 * 後方互換: Transcript[] を旧シグネチャで受け取って BuildFcpxmlInput[] に変換するヘルパー。
 * 既存テストや CLI のために残置。
 */
export function buildFcpxmlFromTranscripts(
  transcripts: Transcript[],
  options: BuildFcpxmlOptions = {},
): string {
  const inputs: BuildFcpxmlInput[] = transcripts.map((t) => ({
    videoPath: t.source_video,
    videoDurationSec: t.video_duration_sec,
    fps: t.fps,
    recordedAt: t.recorded_at,
    transcript: t,
  }));
  return buildFcpxml(inputs, options);
}

/* ------------------------------ helpers ------------------------------ */

/**
 * "HH:MM:SS:FF" 形式の NDF タイムコードを FCPXML 時間文字列に変換する。
 * GoPro 等の GPS タイムコードに対応。
 * 書式エラーや fps が 0 の場合は null を返す (呼び出し側は "0s" にフォールバック)。
 */
export function timecodeToFcpTime(
  tc: string,
  fps: FpsRational,
): string | null {
  const m = /^(\d+):(\d{2}):(\d{2})[:;](\d+)$/.exec(tc);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ss = parseInt(m[3], 10);
  const ff = parseInt(m[4], 10);
  const totalSeconds = hh * 3600 + mm * 60 + ss;
  // 有理数で正確に計算: (seconds * num + FF * den) / num
  const numerator = totalSeconds * fps.num + ff * fps.den;
  if (numerator === 0) return "0s";
  return `${numerator}/${fps.num}s`;
}

/**
 * BuildFcpxmlInput[] を recorded_at 昇順 (フォールバックは videoPath の basename) で並べる。
 * sort.ts の比較ロジックを再利用するために、SortKey 互換のオブジェクトを組み立てて渡す。
 */
function sortBuildInputs(items: BuildFcpxmlInput[]): BuildFcpxmlInput[] {
  return [...items].sort((a, b) => {
    const da = parseIso8601(a.recordedAt);
    const db = parseIso8601(b.recordedAt);
    return compareSortKey(
      {
        hasTime: da !== null,
        time: da?.getTime() ?? 0,
        fallbackName: basename(a.videoPath),
      },
      {
        hasTime: db !== null,
        time: db?.getTime() ?? 0,
        fallbackName: basename(b.videoPath),
      },
    );
  });
}

function assetClipBaseName(item: BuildFcpxmlInput): string {
  const parts = item.videoPath.split("/");
  return parts[parts.length - 1] ?? item.videoPath;
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
 * フレーム数を FCPXML の時間表記に変換する。
 *
 * 整数 fps:  例 90 @ 30fps → "90/30s"
 * NTSC fps:  例 60 @ 59.94fps → "60060/60000s"
 * 0 frames は特別扱いで "0s" (FCP の慣習に合わせる)。
 *
 * 後方互換のため `fps` に `number` を渡された場合は整数 fps として扱う。
 */
export function framesToFcpTime(
  frames: number,
  fps: number | FpsRational,
): string {
  const r: FpsRational = typeof fps === "number" ? { num: fps, den: 1 } : fps;
  return framesToFcpTimeRational(frames, r);
}

interface AssetParams {
  id: string;
  name: string;
  src: string;
  durationFrames: number;
  fps: FpsRational;
  /** "HH:MM:SS:FF" 形式の埋め込みタイムコード (GoPro 等)。省略時は "0s" */
  timecode?: string | null;
}

function renderAsset(p: AssetParams): string {
  if (!isAbsolute(p.src)) {
    throw new Error(
      `fcpxml_write: source_video must be absolute path (got "${p.src}")`,
    );
  }
  const fileUrl = pathToFileUrl(p.src);
  const dur = framesToFcpTimeRational(p.durationFrames, p.fps);
  const start =
    (p.timecode && timecodeToFcpTime(p.timecode, p.fps)) ?? "0s";
  return [
    `<asset id="${p.id}" name="${xmlEscape(p.name)}" start="${start}" duration="${dur}" format="r0" hasVideo="1" hasAudio="1" videoSources="1" audioSources="1" audioChannels="2" audioRate="48000">`,
    `      <media-rep kind="original-media" src="${xmlEscape(fileUrl)}"/>`,
    `    </asset>`,
  ].join("\n");
}

interface AssetClipParams {
  assetId: string;
  name: string;
  offsetFrames: number;
  durationFrames: number;
  fps: FpsRational;
  /** この <asset-clip> 配下に乗せる <title> 文字列 (0 件可) */
  titles: string[];
  /** "HH:MM:SS:FF" 形式の埋め込みタイムコード (GoPro 等)。asset.start と合わせる必要がある */
  timecode?: string | null;
}

function renderAssetClip(p: AssetClipParams): string {
  const offset = framesToFcpTimeRational(p.offsetFrames, p.fps);
  const dur = framesToFcpTimeRational(p.durationFrames, p.fps);
  // start は asset.start と一致させる。タイムコードがある場合はそれを使う。
  const start =
    (p.timecode && timecodeToFcpTime(p.timecode, p.fps)) ?? "0s";
  const titlesBlock =
    p.titles.length > 0
      ? "\n              " + p.titles.join("\n              ")
      : "";
  return [
    `<asset-clip ref="${p.assetId}" name="${xmlEscape(p.name)}" offset="${offset}" start="${start}" duration="${dur}" format="r0" tcFormat="NDF">${titlesBlock}`,
    `            </asset-clip>`,
  ].join("\n");
}

interface TitleParams {
  offset: string;
  duration: string;
  telop: string;
  /** 最初の title のみ <text-style-def> を内側で定義する (FCPXML DTD 適合) */
  includeStyleDef: boolean;
}

function renderTitle(p: TitleParams): string {
  // FCPXML DTD `(param* , text* , text-style-def* , ...)` の順序に従い
  // <param> → <text> → <text-style-def> の順で出力する。
  // <text-style-def> は <resources> 直下に置けないため、最初の <title> 内で 1 度だけ定義。
  const paramsBlock = TITLE_PARAMS.map(
    (pp) =>
      `                <param name="${xmlEscape(pp.name)}" key="${xmlEscape(pp.key)}" value="${xmlEscape(pp.value)}"/>`,
  ).join("\n");
  const styleDefBlock = p.includeStyleDef
    ? "\n" +
      [
        `                <text-style-def id="${STYLE_ID}">`,
        `                  ${renderTextStyleTag()}`,
        `                </text-style-def>`,
      ].join("\n")
    : "";
  return [
    `<title ref="r_title" lane="1" offset="${p.offset}" duration="${p.duration}" name="Telop">`,
    paramsBlock,
    `                <text>`,
    `                  <text-style ref="${STYLE_ID}">${xmlEscape(p.telop)}</text-style>`,
    `                </text>${styleDefBlock}`,
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
 * <resources> 配下 (DTD: asset | effect | format | media | locator のみ):
 *   - <format>: シーケンス用 1 つ
 *   - <effect>: Basic Title 1 つ
 *   - {RESOURCES}: 各動画の <asset> (中に <media-rep> を持つ)
 *
 * <text-style-def> は DTD 上 <resources> 配下に置けないため、最初の <title> 内で
 * 1 度だけ定義し、以降の <title> は <text-style ref="..."> で参照する。
 */
const TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<fcpxml version="1.11">
  <resources>
    <format id="r0" name="{FORMAT_NAME}" frameDuration="{FRAME_DURATION}" width="{WIDTH}" height="{HEIGHT}" colorSpace="9-18-9 (Rec. 2020 HLG)"/>
    <effect id="r_title" name="基本タイトル" uid=".../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti"/>
    {RESOURCES}
  </resources>
  <library colorProcessing="wide-hdr">
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

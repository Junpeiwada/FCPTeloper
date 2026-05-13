/**
 * FFprobe ラッパー (フェーズ 4a)
 *
 * 仕様: 仕様書 §8.1 (撮影日時の取得) / §8.6 (タイムコード) / 実装計画 フェーズ4a
 *
 * - `creation_time`, `fps`, `video_duration_sec` を取得して JSON 化する
 * - Electron 非依存、Node 単体で動く純粋ラッパー
 * - `creation_time` の ISO8601 形式の揺れ (`Z` 終わり / `+09:00`) は標準パーサーに任せる
 *
 * fps は文字列 "30/1" 形式 (rational) を分数評価して数値化する。
 * v:0 ストリームのみ対象とする（音声/データストリームの `0/0` を除外）。
 */

import { spawnSync } from "node:child_process";

export interface FFprobeResult {
  /** 動画ファイル絶対パス */
  source_video: string;
  /** 動画全体の長さ (秒) */
  video_duration_sec: number;
  /** フレームレート (整数化前の数値。29.97/59.94 もそのまま入る) */
  fps: number;
  /** ISO8601 文字列 or null */
  creation_time: string | null;
  /** 映像の横ピクセル数 */
  width: number;
  /** 映像の縦ピクセル数 */
  height: number;
  /** 埋め込みタイムコード "HH:MM:SS:FF" or null (GoPro 等の GPS タイムコード) */
  timecode: string | null;
}

export interface FFprobeOptions {
  /** ffprobe 実行ファイルへのパス (省略時は `ffprobe`) */
  ffprobePath?: string;
}

/**
 * ffprobe を 1 回起動して必要なメタ情報を取得する。
 *
 * 失敗時は Error を throw する。creation_time だけは取れないことが許容される
 * ので、その場合は null で返す。
 */
export function probeVideo(
  videoPath: string,
  options: FFprobeOptions = {},
): FFprobeResult {
  const ffprobe = options.ffprobePath ?? "ffprobe";
  const args = [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    "-select_streams",
    "v:0",
    videoPath,
  ];
  const r = spawnSync(ffprobe, args, { encoding: "utf-8" });
  if (r.error) {
    throw new Error(
      `ffprobe spawn failed: ${r.error.message} (path=${ffprobe})`,
    );
  }
  if (r.status !== 0) {
    throw new Error(
      `ffprobe exited with code ${r.status}: ${r.stderr?.trim() ?? ""}`,
    );
  }
  const json = JSON.parse(r.stdout) as FFprobeJson;
  const stream = json.streams?.[0];
  if (!stream) {
    throw new Error(`ffprobe: no video stream found in ${videoPath}`);
  }

  const fps = parseRational(stream.r_frame_rate);
  if (fps === null || fps <= 0) {
    throw new Error(
      `ffprobe: invalid r_frame_rate "${stream.r_frame_rate}" for ${videoPath}`,
    );
  }

  const duration = parseFloat(
    stream.duration ?? json.format?.duration ?? "NaN",
  );
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(
      `ffprobe: invalid duration for ${videoPath} (stream=${stream.duration}, format=${json.format?.duration})`,
    );
  }

  const creation =
    stream.tags?.creation_time ?? json.format?.tags?.creation_time ?? null;

  const width = stream.width ?? 0;
  const height = stream.height ?? 0;
  const timecode = stream.tags?.timecode ?? null;

  return {
    source_video: videoPath,
    video_duration_sec: duration,
    fps,
    creation_time: creation,
    width,
    height,
    timecode,
  };
}

/**
 * "30/1" や "30000/1001" 形式を数値化する。
 * `0/0` (音声/データ等) や不正フォーマット (`"30abc/1"` 等) は null を返す。
 *
 * `parseInt` は `"30abc"` を `30` として通してしまうため、
 * `/^\d+\/\d+$/` で厳格に形式チェックしてから数値化する。
 */
export function parseRational(s: string | undefined): number | null {
  if (!s) return null;
  if (!/^\d+\/\d+$/.test(s)) return null;
  const [nStr, dStr] = s.split("/");
  const n = Number(nStr);
  const d = Number(dStr);
  if (!Number.isInteger(n) || !Number.isInteger(d) || d === 0) return null;
  return n / d;
}

interface FFprobeStream {
  r_frame_rate?: string;
  duration?: string;
  width?: number;
  height?: number;
  tags?: { creation_time?: string; timecode?: string };
}

interface FFprobeFormat {
  duration?: string;
  tags?: { creation_time?: string };
}

interface FFprobeJson {
  streams?: FFprobeStream[];
  format?: FFprobeFormat;
}

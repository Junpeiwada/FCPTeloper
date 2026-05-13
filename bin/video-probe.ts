/**
 * 動画メタ取得 CLI (フェーズ 4a)
 *
 * 仕様: 仕様書 §8.1 / §8.6 / 実装計画 フェーズ4a
 *
 * 使い方:
 *   npm run video:probe -- <video>
 *
 * 出力 (stdout, JSON):
 *   {
 *     "source_video": "<abs>",
 *     "recorded_at": <ISO8601 or null>,
 *     "fps": <float>,           // ffprobe 由来の数値そのまま
 *     "raw_fps": <float>,        // 互換のため残置 (fps と同値)
 *     "fps_num": <int>,          // 正規化後の分子 (例: 60000)
 *     "fps_den": <int>,          // 正規化後の分母 (例: 1001)
 *     "video_duration_sec": <number>
 *   }
 *
 * サポート外 fps (例: 23.976) の場合は exit 1。stderr に "unsupported fps" を含む。
 */

import { resolve } from "node:path";
import { probeVideo } from "../src/main/ffprobe.js";
import { normalizeFps } from "../src/main/fps.js";
import { logger } from "../src/main/log.js";

function printUsage(code: number): never {
  process.stderr.write("usage: npm run video:probe -- <video>\n");
  process.exit(code);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith("-")) printUsage(64);
  const path = resolve(args[0]);

  let probed;
  try {
    probed = probeVideo(path);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[video-probe] ${msg}\n`);
    logger.error("video-probe", "ffprobe_failed", { path, message: msg });
    process.exit(1);
  }

  let fpsRational;
  try {
    fpsRational = normalizeFps(probed.fps);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[video-probe] ${msg}\n`);
    logger.warn("video-probe", "unsupported_fps", {
      path,
      fps: probed.fps,
    });
    process.exit(1);
  }

  const result = {
    source_video: probed.source_video,
    recorded_at: probed.creation_time,
    fps: probed.fps,
    raw_fps: probed.fps,
    fps_num: fpsRational.num,
    fps_den: fpsRational.den,
    video_duration_sec: probed.video_duration_sec,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  logger.info("video-probe", "ok", {
    path,
    fps_num: fpsRational.num,
    fps_den: fpsRational.den,
  });
}

main();

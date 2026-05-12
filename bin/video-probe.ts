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
 *     "fps": <int>,
 *     "raw_fps": <float>,
 *     "video_duration_sec": <number>
 *   }
 *
 * fps が非整数 (29.97 / 59.94 等) の場合は exit 1。stderr に "non-integer fps" を含む。
 */

import { resolve } from "node:path";
import { probeVideo } from "../src/main/ffprobe.js";
import { ensureIntegerFps } from "../src/main/fps.js";
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

  let fpsInt: number;
  try {
    fpsInt = ensureIntegerFps(probed.fps).fps;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[video-probe] ${msg}\n`);
    logger.warn("video-probe", "non_integer_fps", {
      path,
      fps: probed.fps,
    });
    process.exit(1);
  }

  const result = {
    source_video: probed.source_video,
    recorded_at: probed.creation_time,
    fps: fpsInt,
    raw_fps: probed.fps,
    video_duration_sec: probed.video_duration_sec,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  logger.info("video-probe", "ok", { path, fps: fpsInt });
}

main();

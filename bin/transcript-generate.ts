/**
 * 文字起こし CLI (Node エントリ)
 *
 * Python サブプロセス (`python/transcribe_to_json.py`) を起動し、
 * 指定動画から仕様書 §6 準拠の Transcript JSON を生成する。
 *
 * 使い方:
 *   npm run transcript:generate -- <video.mp4> -o <out.json>
 *   npm run transcript:generate -- <video.mp4> -o <out.json> --model small
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

interface Args {
  videoPath: string;
  outputPath: string;
  model: string | undefined;
  keepAudio: boolean;
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  let videoPath: string | undefined;
  let outputPath: string | undefined;
  let model: string | undefined;
  let keepAudio = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-o" || a === "--output") {
      outputPath = args[++i];
    } else if (a === "-m" || a === "--model") {
      model = args[++i];
    } else if (a === "--keep-audio") {
      keepAudio = true;
    } else if (a === "-h" || a === "--help") {
      printUsageAndExit(0);
    } else if (a.startsWith("-")) {
      process.stderr.write(`unknown option: ${a}\n`);
      printUsageAndExit(64);
    } else if (!videoPath) {
      videoPath = a;
    } else {
      process.stderr.write(`extra positional arg: ${a}\n`);
      printUsageAndExit(64);
    }
  }

  if (!videoPath || !outputPath) printUsageAndExit(64);
  return { videoPath, outputPath, model, keepAudio };
}

function printUsageAndExit(code: number): never {
  process.stderr.write(
    "usage: npm run transcript:generate -- <video> -o <out.json> [--model large-v3] [--keep-audio]\n",
  );
  process.exit(code);
}

function findPythonExecutable(): string {
  // 優先順:
  //   1. python/venv/bin/python (プロジェクト venv)
  //   2. システムの python3
  const venvPython = resolve(PROJECT_ROOT, "python", "venv", "bin", "python");
  if (existsSync(venvPython)) return venvPython;
  process.stderr.write(
    "[transcript-generate] WARN: python/venv が見つかりません。" +
      "python3 (system) にフォールバックします。\n" +
      "  → セットアップ: bash python/setup.sh\n",
  );
  return "python3";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const videoAbs = resolve(args.videoPath);
  const outAbs = resolve(args.outputPath);

  if (!existsSync(videoAbs)) {
    process.stderr.write(`[transcript-generate] ERROR: 動画が見つかりません: ${videoAbs}\n`);
    process.exit(1);
  }

  const pythonBin = findPythonExecutable();
  const script = resolve(PROJECT_ROOT, "python", "transcribe_to_json.py");

  const pyArgs = [script, videoAbs, "-o", outAbs];
  if (args.model) {
    pyArgs.push("--model", args.model);
  }
  if (args.keepAudio) {
    pyArgs.push("--keep-audio");
  }

  process.stderr.write(
    `[transcript-generate] spawn: ${pythonBin} ${pyArgs.join(" ")}\n`,
  );

  const child = spawn(pythonBin, pyArgs, {
    stdio: "inherit",
    cwd: PROJECT_ROOT,
  });

  const code: number = await new Promise((resolveExit) => {
    child.on("exit", (c) => resolveExit(c ?? 1));
    child.on("error", (err) => {
      process.stderr.write(`[transcript-generate] spawn error: ${err.message}\n`);
      resolveExit(1);
    });
  });

  process.exit(code);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[transcript-generate] ERROR: ${msg}\n`);
  process.exit(1);
});

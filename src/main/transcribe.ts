/**
 * 文字起こしサブプロセス起動 (フェーズ 4b)
 *
 * 仕様: 実装計画 フェーズ4b「Main プロセス」
 *   - フェーズ 2 の Python スクリプト (`python/transcribe_to_json.py`) を spawn
 *   - stdout/stderr を行ごとに onProgress コールバックへ渡す
 *   - 結果ファイル (JSON) は Python 側が `-o` で書き出す
 *
 * 設計方針:
 *   - bin/transcript-generate.ts と純粋関数を共有したいが、CLI は親プロセスを
 *     `stdio: "inherit"` で繋いでいるため、IPC 経由で進捗を吸い上げる本モジュールは別実装にする
 *   - Electron 依存は持たず、process.cwd() ベースで動かす (テスト容易性)
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "./log.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
/** リポジトリルート (このファイルから 2 つ上) */
const PROJECT_ROOT = resolve(__dirname, "..", "..");

export interface TranscribeOptions {
  /** 文字起こし対象の動画ファイル (絶対パス) */
  videoPath: string;
  /** 出力 JSON 先 (絶対パス) */
  outputPath: string;
  /** Whisper モデル名 (省略時は Python 側のデフォルト) */
  model?: string;
  /** 中間音声ファイルを残す */
  keepAudio?: boolean;
  /** 進捗メッセージのコールバック (stdout/stderr の1行ごと) */
  onProgress?: (line: string, stream: "stdout" | "stderr") => void;
  /** 中断シグナル */
  signal?: AbortSignal;
}

export interface TranscribeResult {
  /** 出力 JSON の絶対パス */
  outputPath: string;
  /** Python プロセスの exit code */
  exitCode: number;
}

/**
 * Python venv の python を優先し、なければ system python3。
 */
function findPythonExecutable(): string {
  const venvPython = resolve(PROJECT_ROOT, "python", "venv", "bin", "python");
  if (existsSync(venvPython)) return venvPython;
  return "python3";
}

/**
 * Python サブプロセスで文字起こしを実行する。
 * 失敗時は Error を throw する (exit code != 0 含む)。
 */
export async function transcribeVideo(
  options: TranscribeOptions,
): Promise<TranscribeResult> {
  const videoAbs = resolve(options.videoPath);
  const outAbs = resolve(options.outputPath);

  if (!existsSync(videoAbs)) {
    throw new Error(`video not found: ${videoAbs}`);
  }

  const pythonBin = findPythonExecutable();
  const script = resolve(PROJECT_ROOT, "python", "transcribe_to_json.py");
  if (!existsSync(script)) {
    throw new Error(`python script not found: ${script}`);
  }

  const pyArgs = [script, videoAbs, "-o", outAbs];
  if (options.model) pyArgs.push("--model", options.model);
  if (options.keepAudio) pyArgs.push("--keep-audio");

  logger.info("transcribe", "spawn", {
    pythonBin,
    videoAbs,
    outAbs,
    model: options.model ?? null,
  });

  const child = spawn(pythonBin, pyArgs, {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // 中断シグナル: SIGTERM を送り、5秒たっても落ちなければ SIGKILL に昇格させる。
  // Whisper の重い区間はシグナルを取りこぼすことがあるため (pyannote/torch の内部)。
  let killTimer: ReturnType<typeof setTimeout> | null = null;
  const onAbort = () => {
    if (child.killed || child.exitCode !== null) return;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        logger.warn("transcribe", "escalating_to_sigkill", { videoAbs });
        child.kill("SIGKILL");
      }
    }, 5000);
  };
  if (options.signal) {
    if (options.signal.aborted) {
      onAbort();
    } else {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const pump = (
    stream: NodeJS.ReadableStream,
    kind: "stdout" | "stderr",
  ) => {
    let buf = "";
    stream.setEncoding("utf-8");
    stream.on("data", (chunk: string) => {
      buf += chunk;
      // \r も区切りとして扱う (tqdm 等の進捗バーは \r でフラッシュする)
      let idx: number;
      while ((idx = buf.search(/[\r\n]/)) !== -1) {
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
        if (line.length > 0) options.onProgress?.(line, kind);
      }
      // 行末が来ない巨大出力で buf が膨らみ続けるのを抑制 (8KiB で強制 flush)
      if (buf.length > 8192) {
        options.onProgress?.(buf, kind);
        buf = "";
      }
    });
    stream.on("end", () => {
      if (buf.length > 0) options.onProgress?.(buf, kind);
    });
  };
  if (child.stdout) pump(child.stdout, "stdout");
  if (child.stderr) pump(child.stderr, "stderr");

  let exitCode: number;
  try {
    exitCode = await new Promise<number>((resolveExit, rejectExit) => {
      child.on("exit", (code) => resolveExit(code ?? 1));
      child.on("error", (err) => rejectExit(err));
    });
  } finally {
    // 正常終了・例外いずれの場合も後片付け
    if (killTimer) {
      clearTimeout(killTimer);
      killTimer = null;
    }
    options.signal?.removeEventListener("abort", onAbort);
  }

  if (exitCode !== 0) {
    logger.error("transcribe", "exit_nonzero", { exitCode, videoAbs });
    throw new Error(
      `transcribe_to_json.py exited with code ${exitCode} for ${videoAbs}`,
    );
  }

  logger.info("transcribe", "ok", { outAbs, exitCode });
  return { outputPath: outAbs, exitCode };
}

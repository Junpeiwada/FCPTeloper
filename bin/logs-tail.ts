/**
 * 構造化ログを tail -f する CLI
 *
 * 用途: 実装計画「Claude が `tail` で追跡できるようにする」(構造化ログ基盤)。
 *
 * 使い方:
 *   npm run logs:tail
 *   npm run logs:tail -- --pretty  # JSON を読みやすく整形
 *
 * Ctrl+C で終了。
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, closeSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { getLogFile } from "../src/main/log.js";

function parseArgs(): { pretty: boolean } {
  const args = process.argv.slice(2);
  return { pretty: args.includes("--pretty") };
}

function ensureFileExists(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(path)) {
    // 空ファイルを作って tail -F が即座に追従できるようにする
    closeSync(openSync(path, "a"));
  }
}

function main(): void {
  const { pretty } = parseArgs();
  const logPath = getLogFile();
  ensureFileExists(logPath);

  process.stderr.write(`[logs-tail] tailing: ${logPath}\n`);
  process.stderr.write("[logs-tail] Ctrl+C to exit\n");

  // -F (capital) でファイル消失/ローテート時も追従
  const tail = spawn("tail", ["-F", "-n", "0", logPath], { stdio: ["ignore", "pipe", "inherit"] });

  // tail バイナリが PATH に無い (Windows 等) 場合は ENOENT で即終了
  tail.on("error", (err) => {
    process.stderr.write(`[logs-tail] failed to spawn tail: ${err.message}\n`);
    process.exit(1);
  });

  let buf = "";
  tail.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString("utf-8");
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line) continue;
      if (pretty) {
        try {
          const obj = JSON.parse(line);
          const ts = obj.ts ?? "?";
          const lvl = (obj.level ?? "?").toString().toUpperCase().padEnd(5);
          const comp = obj.component ?? "?";
          const event = obj.event ?? "?";
          const data = obj.data ? " " + JSON.stringify(obj.data) : "";
          process.stdout.write(`${ts} [${lvl}] ${comp}/${event}${data}\n`);
        } catch {
          // JSON 以外の行はそのまま流す
          process.stdout.write(line + "\n");
        }
      } else {
        process.stdout.write(line + "\n");
      }
    }
  });

  tail.on("exit", (code) => {
    process.stderr.write(`[logs-tail] tail exited with code ${code}\n`);
    process.exit(code ?? 1);
  });

  // Ctrl+C 時に tail を終了させる。SIGTERM 後 2 秒で応答が無ければ SIGKILL。
  process.on("SIGINT", () => {
    tail.kill("SIGTERM");
    const killTimer = setTimeout(() => {
      if (!tail.killed) tail.kill("SIGKILL");
      process.exit(130); // 128 + SIGINT(2)
    }, 2000);
    killTimer.unref();
  });
}

main();

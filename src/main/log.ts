/**
 * 構造化ログ基盤 (フェーズ3)
 *
 * 仕様: 実装計画 §フェーズ3「構造化ログ基盤」
 *   - スキーマ: { ts, level, component, event, data } (JSON 行)
 *   - ローテーション: 日次 (ローカル日付基準) または 10MB 上限
 *   - PII: text/prompt/body 等の本文フィールドは長さに置換
 *   - 出力先: ~/Library/Logs/FCPTeloper/app.log
 *
 * 設計方針:
 *   - Electron 非依存にして CLI からも使えるようにする
 *   - 出力先パスは `getLogDir()` で取得し、テストでは差し替え可能にする
 *   - 同期書き込み (appendFileSync) で順序保証。ローテート判定はスロットルする
 *   - ログ書き込み失敗は呼び出し側を落とさない (stderr に逃がす)
 */

import {
  existsSync,
  mkdirSync,
  statSync,
  renameSync,
  appendFileSync,
  linkSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  component: string;
  event: string;
  data?: Record<string, unknown>;
}

/** 1ファイルあたりの上限 (10MB) */
const MAX_LOG_BYTES = 10 * 1024 * 1024;

/** 文字列フィールドの上限 (1KiB)。超過分は切り詰めて末尾に省略マーカーを付ける */
const MAX_FIELD_LEN = 1024;

/** ローテート判定のスロットル間隔 (5秒) */
const ROTATE_CHECK_INTERVAL_MS = 5000;

/**
 * 本文系フィールドのキー判定。
 * 完全一致 or 末尾が本文ワード (例: userPrompt, assistantText, telop_text)。
 * lowerCamelCase を扱うため、判定前にキーを小文字に正規化した上で末尾一致を見る。
 */
const PII_WORDS = [
  "text",
  "prompt",
  "body",
  "content",
  "message",
  "response",
  "output",
];

function isPiiKey(key: string): boolean {
  const lower = key.toLowerCase();
  for (const w of PII_WORDS) {
    if (lower === w) return true;
    if (lower.endsWith(w) && lower.length > w.length) {
      // userPrompt → "user" + "prompt" の境界。直前が英字下線でも単語結合とみなす。
      return true;
    }
  }
  // 既存仕様で扱っていた telop_text 互換 (PII_WORDS の text 末尾一致で既にカバー)
  return false;
}

/**
 * 出力先ディレクトリ。
 * 環境変数 FCPTELOPER_LOG_DIR があればそれを優先 (テスト用)、
 * なければ ~/Library/Logs/FCPTeloper/ (macOS 標準のアプリログ位置)。
 */
export function getLogDir(): string {
  const envOverride = process.env.FCPTELOPER_LOG_DIR;
  if (envOverride && envOverride.length > 0) return envOverride;
  return join(homedir(), "Library", "Logs", "FCPTeloper");
}

export function getLogFile(): string {
  return join(getLogDir(), "app.log");
}

let logDirEnsured = false;
function ensureLogDir(): void {
  if (logDirEnsured) return;
  const dir = getLogDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  logDirEnsured = true;
}

/** ローカル日付を YYYY-MM-DD で返す */
function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

let lastRotateCheckMs = 0;

/**
 * 既存 app.log が日付またぎ (ローカル日付) or サイズ超過していたらローテートする。
 * リネーム後の名前は `app.<YYYY-MM-DD>.<seq>.log`。
 * 並行プロセス対策として linkSync + unlinkSync の 2 段方式で行う。
 */
function rotateIfNeeded(force = false): void {
  if (!force) {
    const now = Date.now();
    if (now - lastRotateCheckMs < ROTATE_CHECK_INTERVAL_MS) return;
    lastRotateCheckMs = now;
  }

  const filePath = getLogFile();
  if (!existsSync(filePath)) return;
  const st = statSync(filePath);
  const today = localDay(new Date());
  const mtimeDay = localDay(new Date(st.mtimeMs));
  const tooBig = st.size >= MAX_LOG_BYTES;
  const dayChanged = mtimeDay !== today;
  if (!tooBig && !dayChanged) return;

  // 連番を探して link + unlink で安全にローテート。
  // link は宛先が既存なら EEXIST で失敗するので競合時もデータを失わない。
  for (let seq = 0; seq < 1000; seq++) {
    const rotated = join(
      getLogDir(),
      `app.${mtimeDay}.${String(seq).padStart(3, "0")}.log`,
    );
    if (existsSync(rotated)) continue;
    try {
      linkSync(filePath, rotated);
      unlinkSync(filePath);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EEXIST") continue; // 別プロセスが先取りした
      // fs が link を拒否する FS (FAT 等) では rename にフォールバック
      try {
        renameSync(filePath, rotated);
        return;
      } catch {
        // 失敗してもログ書き込みは続行 (落とさない)
        return;
      }
    }
  }
}

/**
 * 文字列を 1KiB で切り詰める。
 */
function truncateString(s: string): string {
  if (s.length <= MAX_FIELD_LEN) return s;
  return s.slice(0, MAX_FIELD_LEN) + `…(+${s.length - MAX_FIELD_LEN} chars)`;
}

/**
 * PII (= 個人特定/機密データ) を含みうるキーをルールに従って整形する。
 *
 * 仕様:
 *   - text / prompt / body / content / message / response / output / telop_text
 *     および末尾が *_text / *_prompt 等のキーは長さに置換 (`<key>_len`)
 *   - それ以外の string 値も MAX_FIELD_LEN を超えていたら切り詰める
 *   - 配列・オブジェクトは再帰
 */
export function redactPii<T extends Record<string, unknown>>(
  data: T | undefined,
): Record<string, unknown> | undefined {
  if (data === undefined) return undefined;
  const seen = new WeakSet<object>();
  return redactValue(data, seen) as Record<string, unknown>;
}

function redactValue(v: unknown, seen: WeakSet<object>): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "string") return truncateString(v);
  if (typeof v !== "object") return v;
  if (seen.has(v as object)) return "[Circular]";
  seen.add(v as object);
  if (Array.isArray(v)) return v.map((item) => redactValue(item, seen));

  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string" && isPiiKey(k)) {
      out[`${k}_len`] = val.length;
    } else {
      out[k] = redactValue(val, seen);
    }
  }
  return out;
}

/**
 * 構造化ログを 1 行追記する。
 * 失敗しても呼び出し側を落とさない (stderr に警告を出して握りつぶす)。
 */
export function log(
  level: LogLevel,
  component: string,
  event: string,
  data?: Record<string, unknown>,
): void {
  try {
    ensureLogDir();
    rotateIfNeeded();
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      component,
      event,
      ...(data !== undefined ? { data: redactPii(data) } : {}),
    };
    let line: string;
    try {
      line = JSON.stringify(entry);
    } catch (e) {
      // 循環参照などで stringify に失敗した場合は data を捨てて再試行
      line = JSON.stringify({
        ts: entry.ts,
        level,
        component,
        event,
        data: { _stringify_error: (e as Error).message },
      });
    }
    appendFileSync(getLogFile(), line + "\n", "utf-8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[log] write failed: ${msg}\n`);
  }
}

/** テスト用: 内部状態をリセットする */
export function _resetForTest(): void {
  logDirEnsured = false;
  lastRotateCheckMs = 0;
}

/** ショートカット */
export const logger = {
  debug: (component: string, event: string, data?: Record<string, unknown>) =>
    log("debug", component, event, data),
  info: (component: string, event: string, data?: Record<string, unknown>) =>
    log("info", component, event, data),
  warn: (component: string, event: string, data?: Record<string, unknown>) =>
    log("warn", component, event, data),
  error: (component: string, event: string, data?: Record<string, unknown>) =>
    log("error", component, event, data),
};

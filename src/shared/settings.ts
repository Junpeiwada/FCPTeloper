/**
 * アプリ設定 (settings.json) の読み書き (フェーズ 4a)
 *
 * 仕様: 仕様書 §7.3 / 実装計画 フェーズ4a
 *
 * 最小スキーマ: 最近開いたフォルダの履歴のみ。
 * 保存先は本来 `app.getPath('userData')` 配下だが、CLI からも読み書きするため
 * Electron 非依存の関数として実装する。Electron 側では `app.getPath` の戻り値を
 * `setSettingsDir()` で注入する。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

export const SettingsSchema = z.object({
  /** 最近開いたフォルダ (絶対パス、新しい順) */
  recentFolders: z.array(z.string()).default([]),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = { recentFolders: [] };
const RECENT_LIMIT = 10;

/**
 * 既定の settings.json パス。
 * 環境変数 FCPTELOPER_SETTINGS_DIR があればそれを優先 (テスト用)、
 * なければ ~/Library/Application Support/FCPTeloper/ (macOS 標準)。
 *
 * Electron main プロセスからは `app.getPath('userData')` を環境変数経由で渡すのが楽。
 */
export function getSettingsFile(): string {
  const override = process.env.FCPTELOPER_SETTINGS_DIR;
  const dir =
    override && override.length > 0
      ? override
      : join(homedir(), "Library", "Application Support", "FCPTeloper");
  return join(dir, "settings.json");
}

export function loadSettings(filePath: string = getSettingsFile()): Settings {
  if (!existsSync(filePath)) return { ...DEFAULT_SETTINGS };
  try {
    const raw = readFileSync(filePath, "utf-8");
    const json = JSON.parse(raw);
    const parsed = SettingsSchema.safeParse(json);
    if (!parsed.success) {
      // 破損していたら既定値で復元 (落とさない)
      process.stderr.write(
        `[settings] invalid settings.json, using defaults: ${parsed.error.message}\n`,
      );
      return { ...DEFAULT_SETTINGS };
    }
    return parsed.data;
  } catch (e) {
    process.stderr.write(
      `[settings] failed to read settings.json: ${(e as Error).message}\n`,
    );
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(
  settings: Settings,
  filePath: string = getSettingsFile(),
): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(settings, null, 2), "utf-8");
}

/**
 * 最近フォルダ履歴に追加する。既存エントリは先頭に押し出す。
 * RECENT_LIMIT 件を超えたら古いものから捨てる。
 */
export function pushRecentFolder(
  settings: Settings,
  folder: string,
): Settings {
  const filtered = settings.recentFolders.filter((p) => p !== folder);
  const next = [folder, ...filtered].slice(0, RECENT_LIMIT);
  return { ...settings, recentFolders: next };
}

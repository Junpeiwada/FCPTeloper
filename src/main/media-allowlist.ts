/**
 * media:// プロトコル用 allow-list (フェーズ 4b 修正)
 *
 * Renderer から `<video src="media://local/<abs>">` で開けるファイルを、
 * ユーザーが明示的に選択した「フォルダ配下の動画ファイル」だけに絞る。
 *
 * 設計:
 *   - `fs:list-videos` 等で得たフォルダを `allowFolder()` で登録する
 *   - `isMediaAllowed(absPath)` が allow-list 内のどれかのフォルダに包含されるかを判定
 *   - 拡張子は VIDEO_EXTENSIONS のみ
 *   - `path.resolve` で正規化したあとに比較するため、`..` を含む path traversal は無効化される
 *
 * 信頼境界:
 *   - Renderer は信頼境界外。Renderer が提示する `currentFolder` をそのまま信じる代わりに、
 *     `ipc.ts` の handler 側 (絶対パス検証 + existsSync 済み) でこの allow-list を更新する。
 */

import { resolve, sep, extname } from "node:path";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v"]);

/** 許可ディレクトリ (絶対・正規化済み) */
const allowedFolders = new Set<string>();

function normalizeFolder(folder: string): string {
  const r = resolve(folder);
  return r.endsWith(sep) ? r : r + sep;
}

export function allowFolder(folder: string): void {
  allowedFolders.add(normalizeFolder(folder));
}

export function isMediaAllowed(absPath: string): boolean {
  if (absPath.length === 0) return false;
  const ext = extname(absPath).toLowerCase();
  if (!VIDEO_EXTENSIONS.has(ext)) return false;
  const normalized = resolve(absPath);
  for (const folder of allowedFolders) {
    if (normalized.startsWith(folder)) return true;
  }
  return false;
}

/** テスト用: 状態リセット */
export function _resetForTest(): void {
  allowedFolders.clear();
}

/** デバッグ・ログ用 */
export function listAllowedFolders(): string[] {
  return [...allowedFolders];
}

/**
 * Preload script
 *
 * Renderer から Main プロセスを呼ぶときの安全な橋渡しを提供する。
 * フェーズ 4b 以降で文字起こし起動・JSON 読み書き・FCPXML 出力等の IPC を追加していく。
 *
 * セキュリティ方針:
 *   - contextIsolation: true (BrowserWindow webPreferences 既定値)
 *   - Node API を直接 renderer に漏らさず、必要な関数だけ contextBridge.exposeInMainWorld で公開
 *   - renderer 側の型は src/shared/preload-api.ts (フェーズ 4b で追加) で共有
 */

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("fcpteloper", {
  /**
   * 構造化ログにエントリを追加する (動作確認用の最小 API)。
   * 本格的な IPC はフェーズ 4b で追加。
   */
  log: (event: string, data?: Record<string, unknown>) =>
    ipcRenderer.invoke("log:append", { event, data }),
});

declare global {
  interface Window {
    fcpteloper: {
      log: (event: string, data?: Record<string, unknown>) => Promise<void>;
    };
  }
}

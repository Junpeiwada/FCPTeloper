/**
 * App ルートコンポーネント (フェーズ3 雛形)
 *
 * フェーズ3 の完了基準として renderer→main IPC が動くことを示すための疎通確認 UI のみを含む。
 * フェーズ4b で動画一覧・プレビュー・セグメント編集 UI に置き換える。
 */

import { useState } from "react";

export default function App() {
  const [count, setCount] = useState(0);
  const [lastLog, setLastLog] = useState<string>("(まだ送っていません)");

  const handleClick = async () => {
    const next = count + 1;
    setCount(next);
    try {
      await window.fcpteloper.log("ui_click", { count: next });
      setLastLog(`ui_click sent (count=${next})`);
    } catch (e) {
      setLastLog(`log failed: ${(e as Error).message}`);
    }
  };

  return (
    <main style={{ padding: "16px", fontFamily: "system-ui, sans-serif" }}>
      <h1>FCPTeloper</h1>
      <p>Electron + Vite + React 雛形 (フェーズ3)。UI 本体はフェーズ4b で実装。</p>
      <button onClick={handleClick}>count: {count}</button>
      <p style={{ color: "#666", fontSize: "12px" }}>{lastLog}</p>
    </main>
  );
}

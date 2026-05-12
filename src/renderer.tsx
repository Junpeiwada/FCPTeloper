/**
 * Renderer エントリ
 *
 * Vite が `<script type="module" src="/src/renderer.tsx">` から自動ロードする。
 * フェーズ4b で本格的な UI コンポーネントに置き換える。
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./renderer/App.js";
import "./index.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("renderer: #root element not found in index.html");
}
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

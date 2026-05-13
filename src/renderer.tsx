/**
 * Renderer エントリ
 *
 * Vite が `<script type="module" src="/src/renderer.tsx">` から自動ロードする。
 * MUI の CssBaseline + ThemeProvider をここで一度だけ被せる。
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";

import App from "./renderer/App.js";
import "./index.css";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#1976d2" },
  },
  typography: {
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    fontSize: 13,
  },
});

const container = document.getElementById("root");
if (!container) {
  throw new Error("renderer: #root element not found in index.html");
}
createRoot(container).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </StrictMode>,
);

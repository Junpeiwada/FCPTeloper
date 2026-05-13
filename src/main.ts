import { app, BrowserWindow, net, protocol, shell } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { registerIpcHandlers } from "./main/ipc.js";
import { logger } from "./main/log.js";
import { isMediaAllowed } from "./main/media-allowlist.js";

// Windows 用 squirrel 起動ハンドリング (macOS/Linux では何もしない)
if (process.platform === "win32") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  if (require("electron-squirrel-startup")) {
    app.quit();
  }
}

let mainWindow: BrowserWindow | null = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // 開発時のみ DevTools を自動オープン
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
};

// settings.json の保存先を Electron の userData に揃える (CLI 用とは別パスになるが許容)
const userData = app.getPath("userData");
if (!process.env.FCPTELOPER_SETTINGS_DIR) {
  process.env.FCPTELOPER_SETTINGS_DIR = userData;
}

// renderer から `<video src="media:///abs/path.mp4">` で動画を読み込めるように
// 標準スキームとして登録する (range request 対応のため Stream Protocol)。
// Electron sandbox renderer は `file://` を直接踏めないので、独自スキームでブリッジする。
protocol.registerSchemesAsPrivileged([
  {
    scheme: "media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

// IPC handler は ready 前に登録しても問題ない (ipcMain.handle はキューイングされる)
registerIpcHandlers(() => mainWindow);

// ウインドウ生成系のハードニング: 任意の URL を開かせない。
// 外部リンクはデフォルトブラウザに委譲する。
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (e, url) => {
    // 開発時の Vite dev server / 本番の file:// 以外は遮断
    const allowed =
      url.startsWith("http://localhost") ||
      url.startsWith("http://127.0.0.1") ||
      url.startsWith("file://");
    if (!allowed) e.preventDefault();
  });
});

app.on("ready", () => {
  // `media://local/<encoded abs path>` を ローカルファイルにマップする
  // Renderer は信頼境界外。任意ファイル読み出しを防ぐため、media-allowlist で
  // 「ユーザーが `fs:list-videos` で開いたフォルダ配下の動画ファイル」のみ許可する。
  protocol.handle("media", (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== "local") {
        return new Response("Forbidden host", { status: 403 });
      }
      // pathname は `/abs/path` 形式 (URL コンストラクタが既に %デコード済)
      const filePath = decodeURIComponent(url.pathname);
      if (!isMediaAllowed(filePath)) {
        logger.warn("main", "media_protocol_denied", { filePath });
        return new Response("Forbidden", { status: 403 });
      }
      return net.fetch(pathToFileURL(filePath).toString(), {
        headers: request.headers,
        method: request.method,
      });
    } catch (err) {
      logger.warn("main", "media_protocol_error", {
        url: request.url,
        message: err instanceof Error ? err.message : String(err),
      });
      return new Response("Bad media request", { status: 400 });
    }
  });

  logger.info("main", "app_ready", { userData });
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

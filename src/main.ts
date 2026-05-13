import { app, BrowserWindow, protocol, shell } from "electron";
import {
  createReadStream,
  statSync,
} from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";

import { registerIpcHandlers } from "./main/ipc.js";
import { logger } from "./main/log.js";
import { isMediaAllowed } from "./main/media-allowlist.js";

function guessMediaContentType(filePath: string): string {
  const ext = filePath.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "mp4":
    case "m4v":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    default:
      return "application/octet-stream";
  }
}

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

  // 開発時のみ DevTools を自動オープン (メインウィンドウ内に dock)
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  // F12 で DevTools をトグル (本番ビルドでも有効、メインウィンドウ内に dock)
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F12") {
      const wc = mainWindow?.webContents;
      if (!wc) return;
      if (wc.isDevToolsOpened()) wc.closeDevTools();
      else wc.openDevTools();
      event.preventDefault();
    }
  });

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
  //
  // シーク (`<video>.currentTime` 設定) を成立させるため Range リクエストを自前で処理し、
  // 206 Partial Content + Accept-Ranges/Content-Range を明示的に返す。
  // Electron の `net.fetch(file://)` 経由では Range が無視されることがあるため。
  protocol.handle("media", (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== "local") {
        return new Response("Forbidden host", { status: 403 });
      }
      const filePath = decodeURIComponent(url.pathname);
      if (!isMediaAllowed(filePath)) {
        logger.warn("main", "media_protocol_denied", { filePath });
        return new Response("Forbidden", { status: 403 });
      }

      const stat = statSync(filePath);
      const totalSize = stat.size;
      const rangeHeader = request.headers.get("range");
      const contentType = guessMediaContentType(filePath);

      if (!rangeHeader) {
        const stream = Readable.toWeb(
          createReadStream(filePath),
        ) as NodeWebReadableStream<Uint8Array>;
        return new Response(stream as unknown as BodyInit, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(totalSize),
            "Accept-Ranges": "bytes",
          },
        });
      }

      // "bytes=START-END" / "bytes=START-" を解析
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (!match) {
        return new Response("Invalid Range", {
          status: 416,
          headers: { "Content-Range": `bytes */${totalSize}` },
        });
      }
      const startStr = match[1];
      const endStr = match[2];
      let start: number;
      let end: number;
      if (startStr === "" && endStr !== "") {
        // suffix range: 末尾 N バイト
        const suffix = Number(endStr);
        start = Math.max(0, totalSize - suffix);
        end = totalSize - 1;
      } else {
        start = startStr === "" ? 0 : Number(startStr);
        end = endStr === "" ? totalSize - 1 : Number(endStr);
      }
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start > end ||
        start >= totalSize
      ) {
        return new Response("Range Not Satisfiable", {
          status: 416,
          headers: { "Content-Range": `bytes */${totalSize}` },
        });
      }
      end = Math.min(end, totalSize - 1);
      const chunkSize = end - start + 1;
      const stream = Readable.toWeb(
        createReadStream(filePath, { start, end }),
      ) as NodeWebReadableStream<Uint8Array>;
      return new Response(stream as unknown as BodyInit, {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(chunkSize),
          "Content-Range": `bytes ${start}-${end}/${totalSize}`,
          "Accept-Ranges": "bytes",
        },
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

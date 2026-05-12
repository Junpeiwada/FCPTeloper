import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { logger } from './main/log.js';

// Windows 用 squirrel 起動ハンドリング (macOS/Linux では何もしない)
if (process.platform === 'win32') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  if (require('electron-squirrel-startup')) {
    app.quit();
  }
}

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
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
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
};

/**
 * Renderer から構造化ログに 1 行追記するための IPC ハンドラ。
 * payload は信頼境界外なので型強制 + 長さ制限を行う。
 */
ipcMain.handle('log:append', (_event, payload: unknown) => {
  if (typeof payload !== 'object' || payload === null) return;
  const p = payload as { event?: unknown; data?: unknown };
  const ev = String(p.event ?? 'unknown').slice(0, 128);
  const data =
    typeof p.data === 'object' && p.data !== null && !Array.isArray(p.data)
      ? (p.data as Record<string, unknown>)
      : undefined;
  logger.info('renderer', ev, data);
});

// ウインドウ生成系のハードニング: 任意の URL を開かせない。
// 外部リンクはデフォルトブラウザに委譲する。
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (e, url) => {
    // 開発時の Vite dev server / 本番の file:// 以外は遮断
    const allowed =
      url.startsWith('http://localhost') ||
      url.startsWith('http://127.0.0.1') ||
      url.startsWith('file://');
    if (!allowed) e.preventDefault();
  });
});

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

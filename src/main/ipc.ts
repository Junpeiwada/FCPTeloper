/**
 * Main プロセス IPC handler 群 (フェーズ 4b)
 *
 * 仕様: 実装計画 フェーズ4b「Main プロセス」
 *   - フェーズ 4a の純粋関数 (fcpxml_write / sort / settings) を薄くラップ
 *   - dialog 系は Electron 依存だがロジック側は最小に留める
 *   - transcribe は子プロセスを Map で管理し、キャンセル可
 *
 * 副作用の分離:
 *   - 本ファイルは Electron 依存 (BrowserWindow / dialog / ipcMain) を持つが、
 *     呼び出すロジックは全て純粋関数。
 *   - `registerIpcHandlers(window)` を main.ts から 1 回呼ぶだけで結線する。
 */

import { BrowserWindow, dialog, ipcMain } from "electron";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, join, resolve } from "node:path";

import { logger } from "./log.js";
import { transcribeVideo } from "./transcribe.js";
import { buildFcpxml, type BuildFcpxmlInput } from "./fcpxml_write.js";
import { probeVideo } from "./ffprobe.js";
import { allowFolder } from "./media-allowlist.js";
import {
  loadSettings,
  pushRecentFolder,
  saveSettings,
} from "../shared/settings.js";
import {
  TranscriptSchema,
  validateTranscript,
  type Transcript,
} from "../shared/transcript-schema.js";
import {
  IpcChannels,
  type FcpxmlBuildPayload,
  type FcpxmlBuildResult,
  type ReadTranscriptResult,
  type SettingsSnapshot,
  type TranscribeProgressEvent,
  type TranscribeStartPayload,
  type TranscribeStartResult,
  type VideoEntry,
  type WriteTranscriptPayload,
} from "../shared/ipc-api.js";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v"]);

/** 文字起こし中の子プロセス制御 (videoPath -> AbortController) */
const activeTranscribes = new Map<string, AbortController>();

function getTranscriptPath(videoPath: string): string {
  return `${videoPath}.transcript.json`;
}

function emitProgress(
  window: BrowserWindow | null,
  ev: TranscribeProgressEvent,
): void {
  if (!window || window.isDestroyed()) return;
  window.webContents.send(IpcChannels.transcribeProgress, ev);
}

/**
 * すべての IPC handler を登録する。
 * main.ts の `app.on('ready')` の中で呼ぶこと。
 *
 * `getWindow` で進捗を送る相手を解決する (BrowserWindow 生成と handler 登録の順序差を吸収)。
 */
export function registerIpcHandlers(
  getWindow: () => BrowserWindow | null,
): void {
  // ---- log:append (フェーズ3 互換) ----
  ipcMain.handle(IpcChannels.logAppend, (_event, payload: unknown) => {
    if (typeof payload !== "object" || payload === null) return;
    const p = payload as { event?: unknown; data?: unknown };
    const ev = String(p.event ?? "unknown").slice(0, 128);
    const data =
      typeof p.data === "object" && p.data !== null && !Array.isArray(p.data)
        ? (p.data as Record<string, unknown>)
        : undefined;
    logger.info("renderer", ev, data);
  });

  // ---- settings ----
  ipcMain.handle(IpcChannels.settingsGet, async (): Promise<SettingsSnapshot> => {
    const s = loadSettings();
    return { recentFolders: s.recentFolders };
  });

  ipcMain.handle(
    IpcChannels.settingsAddRecent,
    async (_event, folder: unknown): Promise<SettingsSnapshot> => {
      if (typeof folder !== "string" || !isAbsolute(folder)) {
        throw new Error("settings:add-recent: folder must be absolute path");
      }
      const next = pushRecentFolder(loadSettings(), folder);
      saveSettings(next);
      return { recentFolders: next.recentFolders };
    },
  );

  // ---- dialog ----
  ipcMain.handle(
    IpcChannels.dialogOpenFolder,
    async (_event, defaultPath?: unknown): Promise<string | null> => {
      const window = getWindow();
      const opts: Electron.OpenDialogOptions = {
        properties: ["openDirectory", "createDirectory"],
      };
      if (typeof defaultPath === "string" && defaultPath.length > 0) {
        opts.defaultPath = defaultPath;
      }
      const result = window
        ? await dialog.showOpenDialog(window, opts)
        : await dialog.showOpenDialog(opts);
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    },
  );

  ipcMain.handle(
    IpcChannels.dialogSaveFile,
    async (
      _event,
      payload: unknown,
    ): Promise<string | null> => {
      const window = getWindow();
      const p = (payload ?? {}) as {
        defaultPath?: unknown;
        filters?: unknown;
      };
      const opts: Electron.SaveDialogOptions = {};
      if (typeof p.defaultPath === "string") opts.defaultPath = p.defaultPath;
      if (Array.isArray(p.filters)) {
        opts.filters = p.filters as Electron.FileFilter[];
      }
      const result = window
        ? await dialog.showSaveDialog(window, opts)
        : await dialog.showSaveDialog(opts);
      if (result.canceled || !result.filePath) return null;
      return result.filePath;
    },
  );

  // ---- fs:list-videos ----
  ipcMain.handle(
    IpcChannels.fsListVideos,
    async (_event, folder: unknown): Promise<VideoEntry[]> => {
      if (typeof folder !== "string" || !isAbsolute(folder)) {
        throw new Error("fs:list-videos: folder must be absolute path");
      }
      if (!existsSync(folder)) {
        throw new Error(`fs:list-videos: folder not found: ${folder}`);
      }
      const st = statSync(folder);
      if (!st.isDirectory()) {
        throw new Error(`fs:list-videos: not a directory: ${folder}`);
      }
      const entries = readdirSync(folder, { withFileTypes: true });
      const videos: VideoEntry[] = [];
      for (const e of entries) {
        if (!e.isFile()) continue;
        const ext = extname(e.name).toLowerCase();
        if (!VIDEO_EXTENSIONS.has(ext)) continue;
        const videoPath = join(folder, e.name);
        const transcriptPath = getTranscriptPath(videoPath);
        videos.push({
          videoPath,
          transcriptPath,
          hasTranscript: existsSync(transcriptPath),
        });
      }
      // フェーズ4b ではファイル名昇順で十分。recorded_at ソートは UI 側で
      // transcript を読み込んだあとに sort.ts でかける。
      videos.sort((a, b) => a.videoPath.localeCompare(b.videoPath));
      // この後 renderer が `<video src="media://...">` で動画を再生するため、
      // 開いたフォルダを media:// allow-list に登録する (任意ファイル読出し防止)
      allowFolder(folder);
      return videos;
    },
  );

  // ---- fs:read-transcript ----
  ipcMain.handle(
    IpcChannels.fsReadTranscript,
    async (_event, transcriptPath: unknown): Promise<ReadTranscriptResult> => {
      if (typeof transcriptPath !== "string" || !isAbsolute(transcriptPath)) {
        throw new Error("fs:read-transcript: path must be absolute");
      }
      const raw = readFileSync(transcriptPath, "utf-8");
      const json = JSON.parse(raw);
      const v = validateTranscript(json);
      if (!v.ok) {
        logger.warn("ipc", "transcript_schema_violation", {
          transcriptPath,
          issues: v.error.issues.length,
        });
        throw new Error(
          `transcript schema violation in ${transcriptPath}: ${v.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
        );
      }
      return { transcript: v.value };
    },
  );

  // ---- fs:write-transcript ----
  ipcMain.handle(
    IpcChannels.fsWriteTranscript,
    async (_event, payload: unknown): Promise<void> => {
      const p = payload as Partial<WriteTranscriptPayload> | null;
      if (
        !p ||
        typeof p.transcriptPath !== "string" ||
        !isAbsolute(p.transcriptPath)
      ) {
        throw new Error("fs:write-transcript: transcriptPath must be absolute");
      }
      // payload.transcript は Renderer 由来なので Zod で再検証
      const parsed = TranscriptSchema.safeParse(p.transcript);
      if (!parsed.success) {
        throw new Error(
          `fs:write-transcript: invalid transcript: ${parsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
        );
      }
      writeFileSync(
        p.transcriptPath,
        JSON.stringify(parsed.data, null, 2),
        "utf-8",
      );
      logger.info("ipc", "transcript_written", {
        transcriptPath: p.transcriptPath,
        segments: parsed.data.segments.length,
      });
    },
  );

  // ---- transcribe:start ----
  ipcMain.handle(
    IpcChannels.transcribeStart,
    async (
      _event,
      payload: unknown,
    ): Promise<TranscribeStartResult> => {
      const p = payload as Partial<TranscribeStartPayload> | null;
      if (!p || typeof p.videoPath !== "string" || !isAbsolute(p.videoPath)) {
        throw new Error("transcribe:start: videoPath must be absolute");
      }
      const videoPath = resolve(p.videoPath);
      if (activeTranscribes.has(videoPath)) {
        throw new Error(`transcribe:start: already running for ${videoPath}`);
      }
      const outputPath = getTranscriptPath(videoPath);
      const controller = new AbortController();
      activeTranscribes.set(videoPath, controller);
      try {
        const window = getWindow();
        await transcribeVideo({
          videoPath,
          outputPath,
          model: p.model,
          signal: controller.signal,
          onProgress: (line, stream) => {
            emitProgress(window, { videoPath, line, stream });
          },
        });
      } finally {
        activeTranscribes.delete(videoPath);
      }
      return { transcriptPath: outputPath };
    },
  );

  // ---- transcribe:cancel ----
  ipcMain.handle(
    IpcChannels.transcribeCancel,
    async (_event, videoPath: unknown): Promise<void> => {
      if (typeof videoPath !== "string") return;
      const ctrl = activeTranscribes.get(videoPath);
      if (ctrl) ctrl.abort();
    },
  );

  // ---- fcpxml:build ----
  // チェック済み動画リスト (transcript 任意) を受けて FCPXML を生成する。
  // 動画は 1 本 = 1 <asset-clip> 全長で配置し、transcript があれば use:true セグメントを
  // lane=1 の <title> として重ねる。transcript が無い動画は ffprobe でメタ情報を補う。
  ipcMain.handle(
    IpcChannels.fcpxmlBuild,
    async (_event, payload: unknown): Promise<FcpxmlBuildResult> => {
      const p = payload as Partial<FcpxmlBuildPayload> | null;
      if (!p || !Array.isArray(p.items) || p.items.length === 0) {
        throw new Error("fcpxml:build: items must be a non-empty array");
      }
      if (typeof p.outputPath !== "string" || !isAbsolute(p.outputPath)) {
        throw new Error("fcpxml:build: outputPath must be absolute");
      }

      const inputs: BuildFcpxmlInput[] = p.items.map((item, idx) => {
        if (!item || typeof item !== "object") {
          throw new Error(`fcpxml:build: items[${idx}] must be an object`);
        }
        const it = item as {
          videoPath?: unknown;
          transcriptPath?: unknown;
        };
        if (
          typeof it.videoPath !== "string" ||
          !isAbsolute(it.videoPath)
        ) {
          throw new Error(
            `fcpxml:build: items[${idx}].videoPath must be absolute: ${String(
              it.videoPath,
            )}`,
          );
        }
        const videoPath = it.videoPath;

        // 対応する transcript があれば読み込む
        let transcript: Transcript | null = null;
        const tp = it.transcriptPath;
        if (typeof tp === "string" && tp.length > 0) {
          if (!isAbsolute(tp)) {
            throw new Error(
              `fcpxml:build: items[${idx}].transcriptPath must be absolute: ${tp}`,
            );
          }
          const raw = readFileSync(tp, "utf-8");
          const json = JSON.parse(raw);
          const v = validateTranscript(json);
          if (!v.ok) {
            throw new Error(
              `fcpxml:build: schema violation in ${tp}: ${v.error.issues
                .slice(0, 3)
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join("; ")}`,
            );
          }
          transcript = v.value;
        }

        // width/height/timecode は常に ffprobe から取得する（transcript にはこの情報がない）
        const probed = probeVideo(videoPath);
        if (transcript) {
          return {
            videoPath,
            videoDurationSec: transcript.video_duration_sec,
            fps: transcript.fps,
            recordedAt: transcript.recorded_at,
            transcript,
            width: probed.width,
            height: probed.height,
            timecode: probed.timecode,
          };
        }
        return {
          videoPath,
          videoDurationSec: probed.video_duration_sec,
          fps: probed.fps,
          recordedAt: probed.creation_time,
          transcript: null,
          width: probed.width,
          height: probed.height,
          timecode: probed.timecode,
        };
      });

      const xml = buildFcpxml(inputs, { projectName: p.projectName });
      writeFileSync(p.outputPath, xml, "utf-8");
      logger.info("ipc", "fcpxml_built", {
        outputPath: p.outputPath,
        inputs: inputs.length,
        withTranscript: inputs.filter((i) => i.transcript !== null).length,
      });
      return { outputPath: p.outputPath };
    },
  );
}

/** テスト用: 内部状態をリセット */
export function _resetForTest(): void {
  for (const ctrl of activeTranscribes.values()) ctrl.abort();
  activeTranscribes.clear();
}

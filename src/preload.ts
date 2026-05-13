/**
 * Preload script
 *
 * Renderer から Main プロセスを呼ぶときの安全な橋渡しを提供する。
 *
 * セキュリティ方針:
 *   - contextIsolation: true (BrowserWindow webPreferences 既定値)
 *   - Node API を直接 renderer に漏らさず、必要な関数だけ contextBridge.exposeInMainWorld で公開
 *   - 公開する API シグネチャは src/shared/ipc-api.ts の `FcpteloperApi` と一致させる
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import {
  IpcChannels,
  type FcpteloperApi,
  type FcpxmlBuildPayload,
  type FcpxmlBuildResult,
  type ReadTranscriptResult,
  type SettingsSnapshot,
  type TranscribeProgressEvent,
  type TranscribeStartPayload,
  type TranscribeStartResult,
  type VideoEntry,
  type WriteTranscriptPayload,
} from "./shared/ipc-api.js";

const api: FcpteloperApi = {
  log: (event, data) =>
    ipcRenderer.invoke(IpcChannels.logAppend, { event, data }),

  getSettings: () =>
    ipcRenderer.invoke(IpcChannels.settingsGet) as Promise<SettingsSnapshot>,
  addRecentFolder: (folder) =>
    ipcRenderer.invoke(
      IpcChannels.settingsAddRecent,
      folder,
    ) as Promise<SettingsSnapshot>,

  openFolderDialog: (defaultPath) =>
    ipcRenderer.invoke(
      IpcChannels.dialogOpenFolder,
      defaultPath,
    ) as Promise<string | null>,
  saveFileDialog: (options) =>
    ipcRenderer.invoke(
      IpcChannels.dialogSaveFile,
      options,
    ) as Promise<string | null>,

  listVideos: (folder) =>
    ipcRenderer.invoke(
      IpcChannels.fsListVideos,
      folder,
    ) as Promise<VideoEntry[]>,
  readTranscript: (transcriptPath) =>
    ipcRenderer.invoke(
      IpcChannels.fsReadTranscript,
      transcriptPath,
    ) as Promise<ReadTranscriptResult>,
  writeTranscript: (payload: WriteTranscriptPayload) =>
    ipcRenderer.invoke(IpcChannels.fsWriteTranscript, payload) as Promise<void>,

  startTranscribe: (payload: TranscribeStartPayload) =>
    ipcRenderer.invoke(
      IpcChannels.transcribeStart,
      payload,
    ) as Promise<TranscribeStartResult>,
  cancelTranscribe: (videoPath) =>
    ipcRenderer.invoke(IpcChannels.transcribeCancel, videoPath) as Promise<void>,
  onTranscribeProgress: (cb) => {
    const listener = (_event: IpcRendererEvent, payload: unknown) => {
      cb(payload as TranscribeProgressEvent);
    };
    ipcRenderer.on(IpcChannels.transcribeProgress, listener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.transcribeProgress, listener);
    };
  },

  buildFcpxml: (payload: FcpxmlBuildPayload) =>
    ipcRenderer.invoke(
      IpcChannels.fcpxmlBuild,
      payload,
    ) as Promise<FcpxmlBuildResult>,
};

contextBridge.exposeInMainWorld("fcpteloper", api);

declare global {
  interface Window {
    fcpteloper: FcpteloperApi;
  }
}

/**
 * Renderer <-> Main の IPC 型定義 (フェーズ 4b)
 *
 * - preload.ts が `contextBridge.exposeInMainWorld("fcpteloper", ...)` で公開する API の型
 * - main 側の `ipcMain.handle(...)` と一対一に対応
 *
 * 設計方針:
 *   - Transcript 等のドメイン型は shared/transcript-schema 経由で取得
 *   - 進捗イベント (`transcribe:progress` など) は ipcRenderer.on で購読する形を取る
 */

import type { Transcript } from "./transcript-schema.js";

/** IPC チャネル名の一覧 (handle / on どちらも) */
export const IpcChannels = {
  // log
  logAppend: "log:append",
  // settings
  settingsGet: "settings:get",
  settingsAddRecent: "settings:add-recent",
  // dialog
  dialogOpenFolder: "dialog:open-folder",
  dialogOpenFiles: "dialog:open-files",
  dialogSaveFile: "dialog:save-file",
  // fs
  fsListVideos: "fs:list-videos",
  fsReadTranscript: "fs:read-transcript",
  fsWriteTranscript: "fs:write-transcript",
  // transcribe
  transcribeStart: "transcribe:start",
  transcribeCancel: "transcribe:cancel",
  transcribeProgress: "transcribe:progress", // event (on)
  // fcpxml
  fcpxmlBuild: "fcpxml:build",
} as const;
export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

// ===== payload / result 型 =====

export interface SettingsSnapshot {
  recentFolders: string[];
}

export interface VideoEntry {
  /** 動画の絶対パス */
  videoPath: string;
  /** 対応 transcript.json の絶対パス (`<video>.transcript.json`) */
  transcriptPath: string;
  /** transcript.json が存在するか */
  hasTranscript: boolean;
}

export interface TranscribeStartPayload {
  videoPath: string;
  /** Whisper モデル名 */
  model?: string;
}

export interface TranscribeStartResult {
  /** Python 側が書き出した transcript.json の絶対パス */
  transcriptPath: string;
}

export interface TranscribeProgressEvent {
  videoPath: string;
  line: string;
  stream: "stdout" | "stderr";
}

/**
 * FCPXML 生成 1 動画分の入力。
 * transcript が無い動画もタイムラインに並べたいので、videoPath を必須にし
 * transcriptPath は任意とする。
 */
export interface FcpxmlBuildItem {
  /** 動画ファイルの絶対パス (必須) */
  videoPath: string;
  /** 対応 transcript.json の絶対パス。存在しないなら省略 (テロップなしで配置) */
  transcriptPath?: string;
}

export interface FcpxmlBuildPayload {
  /** タイムラインに並べる動画のリスト (チェック ON の動画すべて) */
  items: FcpxmlBuildItem[];
  /** 出力 FCPXML の絶対パス */
  outputPath: string;
  projectName?: string;
}

export interface FcpxmlBuildResult {
  outputPath: string;
}

export interface ReadTranscriptResult {
  transcript: Transcript;
}

export interface WriteTranscriptPayload {
  transcriptPath: string;
  transcript: Transcript;
}

/**
 * `window.fcpteloper` に公開する API。
 * preload で contextBridge.exposeInMainWorld の値と一致させる。
 */
export interface FcpteloperApi {
  log(event: string, data?: Record<string, unknown>): Promise<void>;

  getSettings(): Promise<SettingsSnapshot>;
  addRecentFolder(folder: string): Promise<SettingsSnapshot>;

  openFolderDialog(defaultPath?: string): Promise<string | null>;
  saveFileDialog(options: {
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<string | null>;

  listVideos(folder: string): Promise<VideoEntry[]>;
  readTranscript(transcriptPath: string): Promise<ReadTranscriptResult>;
  writeTranscript(payload: WriteTranscriptPayload): Promise<void>;

  startTranscribe(payload: TranscribeStartPayload): Promise<TranscribeStartResult>;
  cancelTranscribe(videoPath: string): Promise<void>;
  onTranscribeProgress(
    cb: (event: TranscribeProgressEvent) => void,
  ): () => void;

  buildFcpxml(payload: FcpxmlBuildPayload): Promise<FcpxmlBuildResult>;
}

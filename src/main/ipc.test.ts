/**
 * IPC handler のユニットテスト (フェーズ 4b)
 *
 * Electron 依存 (ipcMain, dialog, BrowserWindow) は vi.mock で差し替える。
 * フェーズ4b 受け入れ条件「IPC handler はフェーズ 4a の純粋関数を呼ぶだけの薄いラッパー」を担保するため、
 * 主にバリデーション・ファイル I/O 結線・引数チェックの正常系/異常系をカバーする。
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---- Electron モック ----
type Handler = (
  event: unknown,
  ...args: unknown[]
) => unknown | Promise<unknown>;
const handlers = new Map<string, Handler>();

vi.mock("electron", () => {
  return {
    BrowserWindow: class FakeBrowserWindow {},
    ipcMain: {
      handle: (channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      },
    },
    dialog: {
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
      showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined })),
    },
  };
});

// transcribe は外部プロセスなので無効化
vi.mock("./transcribe.js", () => ({
  transcribeVideo: vi.fn(async () => ({ outputPath: "/tmp/dummy.json", exitCode: 0 })),
}));

import { _resetForTest, registerIpcHandlers } from "./ipc.js";
import {
  IpcChannels,
  type FcpxmlBuildResult,
  type ReadTranscriptResult,
  type SettingsSnapshot,
  type VideoEntry,
} from "../shared/ipc-api.js";
import type { Transcript } from "../shared/transcript-schema.js";

function call<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const h = handlers.get(channel);
  if (!h) throw new Error(`handler not registered for ${channel}`);
  return Promise.resolve(h({}, ...args) as T);
}

function makeTranscript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    version: "1.1",
    source_video: "/tmp/dummy/video.mp4",
    video_duration_sec: 10,
    recorded_at: "2026-05-12T10:00:00Z",
    recorded_at_source: "mp4_creation_time",
    asr_engine: "whisper",
    asr_engine_version: "1.0",
    fps: 30,
    created_at: "2026-05-12T11:00:00Z",
    segments: [
      {
        id: 0,
        start: 0,
        end: 1,
        text: "こんにちは",
        language: "ja",
        speaker: null,
        use: true,
        telop_text: null,
        ai_edited: false,
      },
    ],
    ai_suggestions: [],
    ...overrides,
  };
}

let tempDir: string;

beforeEach(() => {
  handlers.clear();
  _resetForTest();
  tempDir = mkdtempSync(join(tmpdir(), "fcpteloper-ipc-"));
  // settings は別パスを使わせる
  process.env.FCPTELOPER_SETTINGS_DIR = join(tempDir, "settings");
  process.env.FCPTELOPER_LOG_DIR = join(tempDir, "logs");
  registerIpcHandlers(() => null);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.FCPTELOPER_SETTINGS_DIR;
  delete process.env.FCPTELOPER_LOG_DIR;
});

describe("registerIpcHandlers", () => {
  it("registers all expected channels", () => {
    expect(handlers.has(IpcChannels.settingsGet)).toBe(true);
    expect(handlers.has(IpcChannels.fsListVideos)).toBe(true);
    expect(handlers.has(IpcChannels.transcribeStart)).toBe(true);
    expect(handlers.has(IpcChannels.fcpxmlBuild)).toBe(true);
  });
});

describe("settings", () => {
  it("settings:get returns empty recents initially", async () => {
    const s = await call<SettingsSnapshot>(IpcChannels.settingsGet);
    expect(s.recentFolders).toEqual([]);
  });

  it("settings:add-recent saves absolute folder paths", async () => {
    const folder = join(tempDir, "videos");
    mkdirSync(folder, { recursive: true });
    const s = await call<SettingsSnapshot>(
      IpcChannels.settingsAddRecent,
      folder,
    );
    expect(s.recentFolders[0]).toBe(folder);
  });

  it("settings:add-recent rejects relative paths", async () => {
    await expect(
      call(IpcChannels.settingsAddRecent, "relative"),
    ).rejects.toThrow(/absolute/);
  });
});

describe("fs:list-videos", () => {
  it("lists video files and detects existing transcripts", async () => {
    const folder = join(tempDir, "videos");
    mkdirSync(folder, { recursive: true });
    const a = join(folder, "a.mp4");
    const b = join(folder, "b.mov");
    const notVideo = join(folder, "notes.txt");
    writeFileSync(a, "dummy");
    writeFileSync(b, "dummy");
    writeFileSync(notVideo, "dummy");
    // transcript for a only
    writeFileSync(`${a}.transcript.json`, JSON.stringify(makeTranscript()));

    const videos = await call<VideoEntry[]>(IpcChannels.fsListVideos, folder);
    expect(videos.map((v) => v.videoPath).sort()).toEqual([a, b].sort());
    const aEntry = videos.find((v) => v.videoPath === a);
    const bEntry = videos.find((v) => v.videoPath === b);
    expect(aEntry?.hasTranscript).toBe(true);
    expect(bEntry?.hasTranscript).toBe(false);
  });

  it("rejects relative folders", async () => {
    await expect(call(IpcChannels.fsListVideos, "videos")).rejects.toThrow(
      /absolute/,
    );
  });
});

describe("fs:read-transcript / fs:write-transcript", () => {
  it("reads and validates a transcript via Zod", async () => {
    const p = join(tempDir, "ok.transcript.json");
    writeFileSync(p, JSON.stringify(makeTranscript()));
    const r = await call<ReadTranscriptResult>(
      IpcChannels.fsReadTranscript,
      p,
    );
    expect(r.transcript.segments.length).toBe(1);
  });

  it("rejects an invalid transcript on read", async () => {
    const p = join(tempDir, "bad.transcript.json");
    writeFileSync(p, JSON.stringify({ version: "1.1" })); // missing fields
    await expect(call(IpcChannels.fsReadTranscript, p)).rejects.toThrow(
      /schema/i,
    );
  });

  it("writes only after Zod validation", async () => {
    const p = join(tempDir, "out.transcript.json");
    await call(IpcChannels.fsWriteTranscript, {
      transcriptPath: p,
      transcript: makeTranscript(),
    });
    expect(existsSync(p)).toBe(true);
    await expect(
      call(IpcChannels.fsWriteTranscript, {
        transcriptPath: p,
        transcript: { version: "wrong" },
      }),
    ).rejects.toThrow(/invalid/i);
  });
});

describe("fcpxml:build", () => {
  it("rejects relative output paths", async () => {
    await expect(
      call(IpcChannels.fcpxmlBuild, {
        transcriptPaths: ["/tmp/x.transcript.json"],
        outputPath: "relative.fcpxml",
      }),
    ).rejects.toThrow(/absolute/);
  });

  it("rejects empty transcript list", async () => {
    await expect(
      call(IpcChannels.fcpxmlBuild, {
        transcriptPaths: [],
        outputPath: "/tmp/out.fcpxml",
      }),
    ).rejects.toThrow(/non-empty/);
  });

  it("builds fcpxml end-to-end from a valid transcript", async () => {
    const transcript = makeTranscript({
      source_video: join(tempDir, "video.mp4"),
    });
    const transcriptPath = join(tempDir, "v.transcript.json");
    writeFileSync(transcriptPath, JSON.stringify(transcript));
    const outputPath = join(tempDir, "out.fcpxml");
    const r = await call<FcpxmlBuildResult>(IpcChannels.fcpxmlBuild, {
      transcriptPaths: [transcriptPath],
      outputPath,
    });
    expect(r.outputPath).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);
  });
});

describe("transcribe:cancel", () => {
  it("is a no-op when nothing is running", async () => {
    await expect(
      call(IpcChannels.transcribeCancel, "/tmp/notrunning.mp4"),
    ).resolves.toBeUndefined();
  });
});

describe("dialog wrappers", () => {
  it("dialog:open-folder returns null when canceled", async () => {
    const result = await call<string | null>(IpcChannels.dialogOpenFolder);
    expect(result).toBeNull();
  });

  it("dialog:open-folder returns the selected path", async () => {
    const electron = await import("electron");
    (electron.dialog.showOpenDialog as unknown as Mock).mockResolvedValueOnce({
      canceled: false,
      filePaths: ["/Users/foo/videos"],
    });
    const result = await call<string | null>(IpcChannels.dialogOpenFolder);
    expect(result).toBe("/Users/foo/videos");
  });
});

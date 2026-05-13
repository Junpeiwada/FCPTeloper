/**
 * App ルートコンポーネント (フェーズ 4b)
 *
 * 仕様: 仕様書 §7 / 実装計画 フェーズ4b「Renderer」
 *
 * レイアウト:
 *   +----------------------------------------------------------+
 *   | AppBar: フォルダ選択 / 文字起こし / FCPXML 出力           |
 *   +--------------------+-------------------------------------+
 *   | VideoList (left)   | VideoPlayer (top right)             |
 *   |                    | SegmentList   (bottom right)         |
 *   +--------------------+-------------------------------------+
 *
 * ロジックは全て main プロセス側 (純粋関数 + IPC handler) で完結する。
 * Renderer は状態管理と表示のみ。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppBar,
  Box,
  Button,
  CircularProgress,
  Snackbar,
  Toolbar,
  Typography,
} from "@mui/material";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import RecordVoiceOverIcon from "@mui/icons-material/RecordVoiceOver";
import MovieFilterIcon from "@mui/icons-material/MovieFilter";
import StopIcon from "@mui/icons-material/Stop";

import type {
  TranscribeProgressEvent,
  VideoEntry,
} from "../shared/ipc-api.js";
import type { Transcript } from "../shared/transcript-schema.js";

import VideoList from "./components/VideoList.js";
import VideoPlayer from "./components/VideoPlayer.js";
import SegmentList from "./components/SegmentList.js";

interface NotificationState {
  open: boolean;
  message: string;
  severity?: "info" | "error";
}

export default function App() {
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [videos, setVideos] = useState<VideoEntry[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<VideoEntry | null>(null);
  /** 文字起こしキューに入れる動画パスの集合 (デフォルト全 ON) */
  const [checkedVideos, setCheckedVideos] = useState<Set<string>>(new Set());
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  /** いま処理中の 1 本 (キュー走行中のみ非 null) */
  const [transcribingVideo, setTranscribingVideo] = useState<string | null>(
    null,
  );
  /** キュー全体を回している間 true */
  const [queueRunning, setQueueRunning] = useState(false);
  /** キャンセル指示 (ユーザーが「中止」を押したらキュー全体を抜ける) */
  const cancelQueueRef = useRef(false);
  const [progressLog, setProgressLog] = useState<string>("");
  const [notification, setNotification] = useState<NotificationState>({
    open: false,
    message: "",
  });

  // Player 制御
  const playerRef = useRef<HTMLVideoElement | null>(null);
  /** 編集された未保存の transcript (明示保存ボタンで永続化する) */
  const [dirtyTranscript, setDirtyTranscript] = useState<Transcript | null>(
    null,
  );
  /** dirtyTranscript の保存先パス (selectedVideo と紐付ける) */
  const dirtyPathRef = useRef<string | null>(null);

  /**
   * 初回マウント時のみ走らせる初期化処理。
   * - 設定ロード + 最近開いたフォルダの自動オープン
   * - 文字起こし進捗イベントの購読
   *
   * 依存配列を空にしているのは、これがアプリ起動時の 1 回だけ走るべき副作用だから。
   * openFolder/notify を依存に入れると初回フォルダ自動オープンが繰り返し発火しうる。
   */
  useEffect(() => {
    void (async () => {
      try {
        const s = await window.fcpteloper.getSettings();
        setRecentFolders(s.recentFolders);
        if (s.recentFolders.length > 0) {
          await openFolder(s.recentFolders[0], /*silent*/ true);
        }
      } catch (err) {
        notify(`初期化失敗: ${(err as Error).message}`, "error");
      }
    })();

    const unsubscribe = window.fcpteloper.onTranscribeProgress(
      (ev: TranscribeProgressEvent) => {
        setProgressLog((prev) => {
          const next = `${prev}${ev.line}\n`;
          // 末尾 5000 文字だけ保持 (UTF-16 code units ベース、日本語ログ実用上問題なし)
          return next.length > 5000 ? next.slice(-5000) : next;
        });
      },
    );
    return unsubscribe;
    // 初回マウントのみ実行する意図。openFolder/notify を依存に入れると
    // 「最近フォルダの自動オープン」が再生成のたびに発火するため意図的に除外。
  }, []);

  const notify = useCallback(
    (message: string, severity: "info" | "error" = "info") => {
      setNotification({ open: true, message, severity });
    },
    [],
  );

  /** フォルダを開いて動画一覧をロード */
  const openFolder = useCallback(
    async (folder: string, silent = false) => {
      try {
        const list = await window.fcpteloper.listVideos(folder);
        setCurrentFolder(folder);
        setVideos(list);
        setSelectedVideo(list[0] ?? null);
        // デフォルト全 ON
        setCheckedVideos(new Set(list.map((v) => v.videoPath)));
        const s = await window.fcpteloper.addRecentFolder(folder);
        setRecentFolders(s.recentFolders);
        if (!silent) notify(`${list.length} 件の動画を読み込みました`);
      } catch (err) {
        notify(`フォルダを開けません: ${(err as Error).message}`, "error");
      }
    },
    [notify],
  );

  /** ツールバー: フォルダ選択 */
  const handleSelectFolder = useCallback(async () => {
    const folder = await window.fcpteloper.openFolderDialog(
      currentFolder ?? undefined,
    );
    if (folder) await openFolder(folder);
  }, [currentFolder, openFolder]);

  /**
   * 未保存の transcript (`dirtyTranscript`) を明示保存する。
   * 「保存」ボタンや「保存して切替」のフローから呼ぶ。
   */
  const saveDirty = useCallback(async (): Promise<boolean> => {
    const dirty = dirtyTranscript;
    const path = dirtyPathRef.current;
    if (!dirty || !path) return true;
    try {
      await window.fcpteloper.writeTranscript({
        transcriptPath: path,
        transcript: dirty,
      });
      setDirtyTranscript(null);
      dirtyPathRef.current = null;
      return true;
    } catch (err) {
      notify(`保存失敗: ${(err as Error).message}`, "error");
      return false;
    }
  }, [dirtyTranscript, notify]);

  /** 未保存変更を破棄する */
  const discardDirty = useCallback(() => {
    setDirtyTranscript(null);
    dirtyPathRef.current = null;
  }, []);

  /** Cmd+S / Ctrl+S で transcript を保存 */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (dirtyTranscript) void saveDirty();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dirtyTranscript, saveDirty]);

  /**
   * 動画切替時、未保存があれば確認 (window.confirm)。
   * - OK = 破棄して切替
   * - キャンセル = 切替中止
   * 保存したい場合は事前に「保存」ボタンを押してから切り替える運用。
   */
  const confirmSelectVideo = useCallback(
    (next: VideoEntry) => {
      if (dirtyTranscript) {
        const ok = window.confirm(
          "未保存の変更があります。破棄して別の動画に切り替えますか?",
        );
        if (!ok) return;
      }
      setSelectedVideo(next);
    },
    [dirtyTranscript],
  );

  /** 選択動画の transcript を読み込む (存在すれば) */
  useEffect(() => {
    setTranscript(null);
    // 別動画に切り替わった = 未保存編集も別物の扱い。表示上はクリア。
    // 「保存しますか?」のガードは別ハンドラで前段に挟む。
    discardDirty();
    if (!selectedVideo) return;
    if (!selectedVideo.hasTranscript) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await window.fcpteloper.readTranscript(
          selectedVideo.transcriptPath,
        );
        if (!cancelled) setTranscript(r.transcript);
      } catch (err) {
        if (!cancelled) {
          notify(
            `transcript 読み込み失敗: ${(err as Error).message}`,
            "error",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedVideo, notify, discardDirty]);

  /** チェック状態の更新 */
  const handleToggleVideo = useCallback((videoPath: string) => {
    setCheckedVideos((prev) => {
      const next = new Set(prev);
      if (next.has(videoPath)) next.delete(videoPath);
      else next.add(videoPath);
      return next;
    });
  }, []);

  const handleToggleAll = useCallback(
    (on: boolean) => {
      setCheckedVideos(on ? new Set(videos.map((v) => v.videoPath)) : new Set());
    },
    [videos],
  );

  /**
   * 文字起こし実行 (キュー処理)。
   * チェックされた全動画を順次処理する。transcript 有無に関わらず再生成する。
   * 「中止」を押すとキュー全体を抜ける。処理中の 1 本も SIGTERM→SIGKILL される。
   */
  const handleTranscribe = useCallback(async () => {
    const targets = videos.filter((v) => checkedVideos.has(v.videoPath));
    if (targets.length === 0) {
      notify("チェックされた動画がありません", "error");
      return;
    }
    cancelQueueRef.current = false;
    setQueueRunning(true);
    setProgressLog("");

    let ok = 0;
    const failed: string[] = [];
    for (const v of targets) {
      if (cancelQueueRef.current) break;
      setTranscribingVideo(v.videoPath);
      try {
        await window.fcpteloper.startTranscribe({ videoPath: v.videoPath });
        ok++;
        // 1本完了したら即時リスト更新
        if (currentFolder) {
          const list = await window.fcpteloper.listVideos(currentFolder);
          setVideos(list);
          if (selectedVideo) {
            const updated = list.find(
              (x) => x.videoPath === selectedVideo.videoPath,
            );
            if (updated) setSelectedVideo(updated);
          }
        }
      } catch (err) {
        const name = v.videoPath.split("/").pop() ?? v.videoPath;
        failed.push(name);
        // キュー全体は止めず、次へ進む。ログだけ残す
        await window.fcpteloper.log("transcribe_failed", {
          videoPath: v.videoPath,
          message: (err as Error).message,
        });
      } finally {
        setTranscribingVideo(null);
      }
    }

    setQueueRunning(false);
    // 一覧の hasTranscript を更新
    if (currentFolder) {
      try {
        const list = await window.fcpteloper.listVideos(currentFolder);
        setVideos(list);
        // 現在の選択動画が一覧から消えていなければ最新情報に差し替え
        if (selectedVideo) {
          const updated = list.find(
            (x) => x.videoPath === selectedVideo.videoPath,
          );
          if (updated) setSelectedVideo(updated);
        }
      } catch (err) {
        notify(`一覧再読込失敗: ${(err as Error).message}`, "error");
      }
    }

    if (cancelQueueRef.current) {
      notify(`中止 (完了 ${ok} / 失敗 ${failed.length})`);
    } else if (failed.length > 0) {
      notify(
        `完了 ${ok} / 失敗 ${failed.length} (${failed.slice(0, 3).join(", ")}${
          failed.length > 3 ? "…" : ""
        })`,
        "error",
      );
    } else {
      notify(`文字起こし完了 (${ok} 件)`);
    }
  }, [videos, checkedVideos, currentFolder, selectedVideo, notify]);

  const handleCancelTranscribe = useCallback(async () => {
    cancelQueueRef.current = true;
    if (transcribingVideo) {
      await window.fcpteloper.cancelTranscribe(transcribingVideo);
    }
  }, [transcribingVideo]);

  /** FCPXML 出力 */
  const handleBuildFcpxml = useCallback(async () => {
    // 未保存編集がある場合は確認 (FCPXML は保存済み JSON を読むため、未保存分は反映されない)
    if (dirtyTranscript) {
      const ok = window.confirm(
        "未保存の変更があります。先に保存してから FCPXML 出力しますか?\n" +
          "OK = 保存して続行 / キャンセル = 未保存分を無視して出力",
      );
      if (ok) {
        const saved = await saveDirty();
        if (!saved) return;
      }
    }
    // チェック ON の動画を全て対象にする (transcript の有無は問わない)。
    // transcript がある動画はテロップを重ね、無い動画は素の動画クリップとして並べる。
    const targets = videos.filter((v) => checkedVideos.has(v.videoPath));
    if (targets.length === 0) {
      notify(
        "チェックされた動画がありません (動画一覧でチェックを入れてください)",
        "error",
      );
      return;
    }
    const items = targets.map((v) => ({
      videoPath: v.videoPath,
      transcriptPath: v.hasTranscript ? v.transcriptPath : undefined,
    }));
    const defaultName = currentFolder
      ? `${currentFolder.split("/").pop() ?? "fcpteloper"}.fcpxml`
      : "fcpteloper.fcpxml";
    const out = await window.fcpteloper.saveFileDialog({
      defaultPath: defaultName,
      filters: [{ name: "FCPXML", extensions: ["fcpxml"] }],
    });
    if (!out) return;
    try {
      const r = await window.fcpteloper.buildFcpxml({
        items,
        outputPath: out,
      });
      notify(`FCPXML を書き出しました: ${r.outputPath}`);
    } catch (err) {
      notify(`FCPXML 生成失敗: ${(err as Error).message}`, "error");
    }
  }, [videos, checkedVideos, currentFolder, notify, dirtyTranscript, saveDirty]);

  /**
   * transcript 編集 (use / telop_text) を未保存バッファに積むだけ。
   * 永続化は明示的に「保存」ボタンを押したときのみ行う。
   */
  const handleTranscriptChange = useCallback(
    (next: Transcript) => {
      setTranscript(next);
      if (!selectedVideo) return;
      setDirtyTranscript(next);
      dirtyPathRef.current = selectedVideo.transcriptPath;
    },
    [selectedVideo],
  );

  /**
   * セグメントクリックで該当時刻にシークして再生する。
   *
   * 注意:
   *   - metadata が未ロード (`readyState < HAVE_METADATA`) のままだと `currentTime` 設定が無視される
   *   - `currentTime` 設定直後に `play()` を呼ぶと seek を待たずに再生が始まり、シーク失敗扱いになることがある
   *   ので、`loadedmetadata` と `seeked` を待ち合わせてから再生する
   */
  const handleSeek = useCallback((seconds: number) => {
    const v = playerRef.current;
    if (!v) return;
    const doSeek = () => {
      const onSeeked = () => {
        v.removeEventListener("seeked", onSeeked);
        void v.play().catch(() => undefined);
      };
      v.addEventListener("seeked", onSeeked);
      v.currentTime = seconds;
    };
    // HAVE_METADATA = 1。これ未満だと currentTime 代入が反映されない
    if (v.readyState >= 1) {
      doSeek();
    } else {
      const onLoaded = () => {
        v.removeEventListener("loadedmetadata", onLoaded);
        doSeek();
      };
      v.addEventListener("loadedmetadata", onLoaded);
      // ロードを促す
      v.load();
    }
  }, []);

  const canTranscribe = !queueRunning && checkedVideos.size > 0;
  const transcribeLabel = queueRunning
    ? `文字起こし中… (${transcribingVideo ? transcribingVideo.split("/").pop() : ""})`
    : `文字起こし (${checkedVideos.size})`;
  const canBuildFcpxml = useMemo(
    // チェック済みの動画が 1 件でもあれば出力可能 (transcript 有無は問わない)
    () => videos.some((v) => checkedVideos.has(v.videoPath)),
    [videos, checkedVideos],
  );

  return (
    <Box
      sx={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar variant="dense" sx={{ gap: 1 }}>
          <Typography variant="h6" sx={{ mr: 2 }}>
            FCPTeloper
          </Typography>
          <Button
            size="small"
            variant="outlined"
            startIcon={<FolderOpenIcon />}
            onClick={handleSelectFolder}
          >
            フォルダを開く
          </Button>
          <Button
            size="small"
            variant="contained"
            color="primary"
            startIcon={
              queueRunning ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <RecordVoiceOverIcon />
              )
            }
            onClick={handleTranscribe}
            disabled={!canTranscribe}
          >
            {transcribeLabel}
          </Button>
          {queueRunning && (
            <Button
              size="small"
              variant="outlined"
              color="warning"
              startIcon={<StopIcon />}
              onClick={handleCancelTranscribe}
            >
              中止
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button
            size="small"
            variant="contained"
            color="secondary"
            startIcon={<MovieFilterIcon />}
            onClick={handleBuildFcpxml}
            disabled={!canBuildFcpxml}
          >
            FCPXML 出力
          </Button>
        </Toolbar>
        {currentFolder && (
          <Box sx={{ px: 2, pb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              {currentFolder}
            </Typography>
          </Box>
        )}
      </AppBar>

      <Box sx={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <Box
          sx={{
            width: 280,
            borderRight: 1,
            borderColor: "divider",
            overflow: "auto",
          }}
        >
          <VideoList
            videos={videos}
            selected={selectedVideo}
            onSelect={confirmSelectVideo}
            checked={checkedVideos}
            onToggle={handleToggleVideo}
            onToggleAll={handleToggleAll}
            transcribingVideo={transcribingVideo}
          />
        </Box>
        <Box
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <Box
            sx={{
              p: 1,
              borderBottom: 1,
              borderColor: "divider",
              flexShrink: 0,
            }}
          >
            <VideoPlayer
              ref={playerRef}
              videoPath={selectedVideo?.videoPath ?? null}
            />
          </Box>
          {transcript && (
            <Box
              sx={{
                borderBottom: 1,
                borderColor: "divider",
                background: dirtyTranscript ? "warning.lighter" : "grey.50",
                px: 1.5,
                py: 0.75,
                display: "flex",
                alignItems: "center",
                gap: 1,
                flexShrink: 0,
              }}
            >
              <Typography variant="caption" sx={{ flex: 1 }}>
                {dirtyTranscript
                  ? "未保存の変更があります"
                  : "保存済み"}
              </Typography>
              <Button
                size="small"
                variant="text"
                onClick={discardDirty}
                disabled={!dirtyTranscript}
              >
                破棄
              </Button>
              <Button
                size="small"
                variant="contained"
                color="primary"
                onClick={() => void saveDirty()}
                disabled={!dirtyTranscript}
              >
                保存
              </Button>
            </Box>
          )}
          <Box sx={{ flex: 1, overflow: "auto" }}>
            {transcript ? (
              <SegmentList
                transcript={transcript}
                onSeek={handleSeek}
                onChange={handleTranscriptChange}
              />
            ) : (
              <Box
                sx={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "text.secondary",
                }}
              >
                <Typography variant="body2">
                  {selectedVideo
                    ? "transcript が未生成です。ツールバーから文字起こしを実行してください。"
                    : "左のリストから動画を選択してください。"}
                </Typography>
              </Box>
            )}
          </Box>
          {queueRunning && (
            <Box
              sx={{
                borderTop: 1,
                borderColor: "divider",
                p: 1,
                maxHeight: 120,
                overflow: "auto",
                fontFamily: "Menlo, monospace",
                fontSize: 11,
                background: "#1e1e1e",
                color: "#d4d4d4",
                whiteSpace: "pre-wrap",
              }}
            >
              {progressLog || "(進捗待機中...)"}
            </Box>
          )}
        </Box>
      </Box>

      <Snackbar
        open={notification.open}
        autoHideDuration={4000}
        onClose={() => setNotification((n) => ({ ...n, open: false }))}
        message={notification.message}
      />

      {recentFolders.length > 0 && (
        <Box sx={{ display: "none" }} aria-hidden>
          {/* 最近フォルダはフェーズ4bでは内部状態のみ保持。表示UIはフェーズ6 */}
        </Box>
      )}
    </Box>
  );
}

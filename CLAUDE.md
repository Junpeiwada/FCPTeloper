# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

動画から Whisper で文字起こし → pyannote で話者分離 → FCPXML テロップを出力する Electron + Python アプリ。

## セットアップ

→ [Docs/SETUP.md](Docs/SETUP.md)

**文字起こしが「完了 0 / 失敗 N」になる場合は `python/venv/` が未作成の可能性が高い。**  
`bash python/setup.sh` を先に実行すること。

## 開発コマンド

```bash
npm run dev              # 開発モード (Electron Forge + Vite HMR)
npm run typecheck        # TypeScript 型チェック
npm run lint             # ESLint
npm test                 # Vitest (一度実行)
npm run test:watch       # Vitest (Watch モード)

# CLI スクリプト (bin/)
npm run transcript:generate  # Python 文字起こし直接実行
npm run transcript:validate  # Transcript JSON をスキーマ検証
npm run video:probe           # 動画メタデータ表示
npm run fcpxml:build          # CLI から FCPXML 生成
npm run logs:tail             # アプリログ tail
```

## アーキテクチャ概要

### プロセス構成

```
Electron Main (Node.js)
  ├── ipc.ts          — IPC ハンドラ登録 (registerIpcHandlers)
  ├── transcribe.ts   — Python サブプロセス起動・キャンセル管理
  ├── fcpxml_write.ts — Transcript JSON → FCPXML 生成
  ├── ffprobe.ts      — ffprobe で動画メタデータ取得
  ├── fps.ts          — fps 有理数変換・FCP 時間文字列生成
  ├── sort.ts         — 撮影日時パース・動画並び順キー算出
  ├── media-allowlist.ts — media:// プロトコルの許可フォルダ管理
  └── log.ts          — 構造化 JSON ログ (日次ローテーション)

Renderer (React + MUI)
  └── App.tsx         — 単一コンポーネント (VideoList / VideoPlayer / SegmentList)

Preload
  └── preload.ts      — contextBridge で window.fcpteloper を公開

Shared
  ├── transcript-schema.ts — Zod スキーマ v1.1 (Segment / Transcript)
  ├── ipc-api.ts           — IPC チャネル定数と Payload/Result 型定義
  ├── settings.ts          — アプリ設定スキーマ (recentFolders)
  └── media-url.ts         — /abs/path → media://local/abs/path 変換

Python
  └── transcribe_to_json.py — ffmpeg → Whisper → pyannote → JSON 出力
```

### データフロー

```
動画ファイル
  → ffprobe (撮影日時・fps・duration)
  → transcribe_to_json.py (Transcript JSON v1.1)
  → SegmentList で telop_text 編集
  → fcpxml_write.ts (FCPXML)
  → Final Cut Pro に読み込む
```

### IPC チャネル一覧

| チャネル | 方向 | 用途 |
|---------|------|------|
| `fs:list-videos` | invoke | フォルダ内の動画一覧取得 |
| `fs:read-transcript` | invoke | Transcript JSON 読み込み |
| `fs:write-transcript` | invoke | Transcript JSON 保存 |
| `transcribe:start` | invoke | Python 文字起こし開始 |
| `transcribe:cancel` | invoke | 文字起こしキャンセル |
| `transcribe:progress` | on (event) | 進捗ログ行をリアルタイム送信 |
| `fcpxml:build` | invoke | FCPXML ファイル生成 |
| `dialog:open-folder` | invoke | フォルダ選択ダイアログ |
| `dialog:save-file` | invoke | ファイル保存ダイアログ |
| `settings:get` | invoke | 設定取得 |
| `settings:add-recent` | invoke | 最近のフォルダに追加 |

### Transcript JSON スキーマ (v1.1)

`src/shared/transcript-schema.ts` の Zod 定義が正規。主要フィールド:
- `source_video`: 動画の絶対パス
- `recorded_at`: ISO8601 撮影日時 (FCPXML 並び順の基準)
- `fps`: フレームレート (有理数変換は `fps.ts` の `normalizeFps`)
- `segments[].text`: ASR 生テキスト (**編集禁止**)
- `segments[].telop_text`: UI 編集用テロップ (null なら `text` を使用)
- `segments[].use`: FCPXML に含めるか

### FCPXML 生成の設計

`fcpxml_write.ts` の `buildFcpxmlFromTranscripts`:
- 動画は `<asset>` で外部参照 (file:// URL、コピーしない)
- `use=true` なセグメントを spine 上に直列配置
- 各セグメントに Basic Title をテロップとして重ね合わせ
- テロップスタイルは `TELOP_STYLE` 定数で一元管理 (fontSize=100, 白色)
- NTSC fps (29.97/59.94) は有理数 `{30000, 1001}` / `{60000, 1001}` で表現

### media:// プロトコル

`media-allowlist.ts` がユーザー選択フォルダ配下の `.mp4/.mov/.m4v` のみを許可。  
フォルダ選択時に `allowFolder()` を呼ばないと VideoPlayer が再生できない。

## テスト構成

テストは `src/main/*.test.ts` と `src/shared/*.test.ts` に配置。  
特定ファイルのみ実行: `npx vitest run src/main/fps.test.ts`

## Python 側の注意事項

- Whisper モデルキャッシュ: `python/models/whisper/`
- pyannote モデルキャッシュ: `python/models/pyannote/`
- `transcribeVideo()` は venv 存在時は `python/venv/bin/python3`、なければ system の `python3` にフォールバック
- 環境変数 `FCPTELOPER_SETTINGS_DIR` / `FCPTELOPER_LOG_DIR` はテスト用の上書きパス

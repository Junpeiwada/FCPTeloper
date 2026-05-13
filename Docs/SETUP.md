# セットアップガイド

## 前提条件

| ツール | バージョン | 確認コマンド |
|---|---|---|
| Node.js | 18 以上 | `node -v` |
| npm | 9 以上 | `npm -v` |
| **Python 3.12** | 3.12.x のみ | `python3.12 --version` |
| ffmpeg / ffprobe | 最新安定版 | `ffmpeg -version` |

> **Python 3.12 が必須の理由**: torch 2.2.2 の wheel が Python 3.13 では提供されていないため。  
> インストール: `brew install python@3.12`

---

## 手順

```bash
# 1. Node.js 依存インストール
npm install

# 2. Python venv + パッケージインストール（python3.12 が必要）
bash python/setup.sh

# 3. （任意）HF_TOKEN を .env に設定 ─ 話者分離を使う場合のみ
echo "HF_TOKEN=hf_xxxxxxxxxxxx" > .env

# 4. 開発サーバ起動
npm run dev
```

---

## Whisper モデル（初回文字起こし時に自動ダウンロード）

| モデル | サイズ | 指定方法 |
|---|---|---|
| `large-v3`（デフォルト） | ≈ 3 GB | `--model large-v3` |
| `medium` | ≈ 1.5 GB | `--model medium` |
| `small` | ≈ 460 MB | `--model small` |

ダウンロード先: `python/models/whisper/`（初回のみ時間がかかる）

---

## 話者分離（オプション）

pyannote を使う場合は HuggingFace トークンが必要。未設定でも `speaker: null` で処理は継続する。

```
HF_TOKEN=hf_xxxxxxxxxxxx   # .env に記載
```

---

## よくあるエラー

### 文字起こしが「完了 0 / 失敗 N」になる

| 原因 | 対処 |
|---|---|
| `python/venv/` が未作成 | `bash python/setup.sh` を実行 |
| python3.12 がない | `brew install python@3.12` → 再度 `bash python/setup.sh` |
| モデルDL中にネットワークエラー | 再実行（`python/models/whisper/` の中途半端なファイルは削除してよい） |

#!/usr/bin/env python3
"""
FCPTeloper 文字起こしラッパー (フェーズ2)

仕様書 §2 / §6 / §8.1 に準拠した中間 Transcript JSON を出力する。

設計方針:
  - AISandbox/VideoToText のコードは触らない (仕様書 §4.1)。本ファイル単独で
    Whisper + pyannote を呼ぶ。
  - Whisper の `language` 引数は外して自動検出 (仕様書 §2)。
  - `creation_time` は ffprobe で取得し、なければ macOS の `mdls` にフォールバック、
    両方失敗時は `recorded_at: null`, `recorded_at_source: "unknown"` で警告のみ。

使い方:
    python python/transcribe_to_json.py <video.mp4> -o <out.json> [--model large-v3]

出力:
    -o で指定した JSON ファイル (仕様書 §6 スキーマ)。stdout には進捗ログを出す。
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# ──────────────────────────────────────────────────────────────────────
# 環境セットアップ
# ──────────────────────────────────────────────────────────────────────

# プロジェクトルート (.env を読みに行く先)
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# python/models/ にモデルキャッシュを置く (VideoToText/ は触らない)
MODELS_DIR = Path(__file__).resolve().parent / "models"
WHISPER_MODEL_DIR = MODELS_DIR / "whisper"
PYANNOTE_MODEL_DIR = MODELS_DIR / "pyannote"


def _load_env() -> None:
    """FCPTeloper/.env を読み込む。python-dotenv が無くてもエラーにしない。"""
    env_path = PROJECT_ROOT / ".env"
    if not env_path.exists():
        return
    try:
        from dotenv import load_dotenv  # type: ignore[import-not-found]

        load_dotenv(env_path)
    except ImportError:
        # python-dotenv が無い場合は手動で読む
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


def _ensure_dirs() -> None:
    WHISPER_MODEL_DIR.mkdir(parents=True, exist_ok=True)
    PYANNOTE_MODEL_DIR.mkdir(parents=True, exist_ok=True)


# ──────────────────────────────────────────────────────────────────────
# 動画メタデータ取得 (仕様書 §8.1)
# ──────────────────────────────────────────────────────────────────────


def _ffprobe_field(
    video_path: str, entries: str, select_streams: Optional[str] = None
) -> Optional[str]:
    """
    ffprobe で指定フィールドを取得 (なければ None)。
    select_streams を渡すと特定ストリームに絞れる (例: "v:0" でビデオ第1ストリームのみ)。
    複数行が返るケースに備え、最初の非空行を返す。
    """
    cmd = ["ffprobe", "-v", "quiet"]
    if select_streams:
        cmd += ["-select_streams", select_streams]
    cmd += ["-show_entries", entries, "-of", "default=nw=1:nk=1", video_path]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            return None
        for line in result.stdout.splitlines():
            line = line.strip()
            if line:
                return line
        return None
    except FileNotFoundError:
        print("[transcribe_to_json] ERROR: ffprobe が見つかりません", file=sys.stderr)
        sys.exit(1)


def get_video_creation_time(video_path: str) -> tuple[Optional[str], str]:
    """
    撮影日時を取得して (ISO8601 文字列, source) を返す。
    source は仕様書 §6 の `recorded_at_source` に対応:
      "mp4_creation_time" / "finder_creation_date" / "unknown"
    """
    # 優先: MP4 内部 creation_time (mvhd)
    ct = _ffprobe_field(video_path, "format_tags=creation_time")
    if ct:
        return ct, "mp4_creation_time"

    # フォールバック: macOS Finder 作成日時 (kMDItemContentCreationDate)
    if sys.platform == "darwin":
        try:
            result = subprocess.run(
                ["mdls", "-name", "kMDItemContentCreationDate", "-raw", video_path],
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode == 0:
                raw = result.stdout.strip()
                # 例: "2025-10-01 11:07:00 +0000" / "(null)"
                if raw and raw != "(null)":
                    # ISO8601 に正規化
                    try:
                        dt = datetime.strptime(raw, "%Y-%m-%d %H:%M:%S %z")
                        return dt.isoformat(), "finder_creation_date"
                    except ValueError:
                        # フォーマットが違ったらそのまま返す (パーサーは TS 側で吸収)
                        return raw, "finder_creation_date"
        except FileNotFoundError:
            pass

    return None, "unknown"


def get_video_duration_and_fps(video_path: str) -> tuple[float, float]:
    """動画の長さ (秒) と fps を返す。"""
    dur = _ffprobe_field(video_path, "format=duration")
    duration = float(dur) if dur else 0.0

    # fps: ビデオ第1ストリームの r_frame_rate を取得 (例: "30/1" / "60000/1001")
    fps_raw = _ffprobe_field(video_path, "stream=r_frame_rate", select_streams="v:0")
    fps = 0.0
    if fps_raw and "/" in fps_raw:
        num, den = fps_raw.split("/", 1)
        try:
            n = float(num)
            d = float(den)
            if d != 0:
                fps = n / d
        except ValueError:
            fps = 0.0
    elif fps_raw:
        try:
            fps = float(fps_raw)
        except ValueError:
            fps = 0.0

    return duration, fps


# ──────────────────────────────────────────────────────────────────────
# 音声抽出 → Whisper → pyannote
# ──────────────────────────────────────────────────────────────────────


def extract_audio(video_path: str, audio_path: str) -> None:
    """動画から 16kHz mono PCM を抽出。"""
    print(f"[transcribe_to_json] 音声抽出: {video_path} -> {audio_path}", file=sys.stderr)
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-acodec",
        "pcm_s16le",
        "-ac",
        "1",
        "-ar",
        "16000",
        audio_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        print(f"[transcribe_to_json] ffmpeg エラー: {result.stderr}", file=sys.stderr)
        sys.exit(1)


def transcribe_whisper(audio_path: str, model_size: str) -> dict[str, Any]:
    """Whisper で文字起こし。言語自動検出 (language 指定なし)。"""
    import torch
    import whisper

    device = "cuda" if torch.cuda.is_available() else ("mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else "cpu")
    print(f"[transcribe_to_json] Whisper: model={model_size} device={device}", file=sys.stderr)

    # MPS は Whisper が一部未対応なので CPU フォールバック
    if device == "mps":
        device = "cpu"
        print("[transcribe_to_json] MPS は未対応、CPU で実行", file=sys.stderr)

    model = whisper.load_model(
        model_size,
        device=device,
        download_root=str(WHISPER_MODEL_DIR),
    )

    print("[transcribe_to_json] 文字起こし中...", file=sys.stderr)
    # language を指定しない = 自動検出 (仕様書 §2)
    # word_timestamps は使わない (セグメント単位で十分)
    result = model.transcribe(
        audio_path,
        verbose=False,
        word_timestamps=False,
    )
    print(
        f"[transcribe_to_json] 完了: {len(result.get('segments', []))} セグメント",
        file=sys.stderr,
    )
    return result


def detect_segment_language(
    whisper_result: dict[str, Any], segment: dict[str, Any]
) -> Optional[str]:
    """
    セグメント単位の言語を返す。
    Whisper の標準出力には各セグメントの language が出ないので、まずセグメント自体に
    `language` キーがあればそれ、なければ全体検出言語にフォールバック。
    """
    seg_lang = segment.get("language")
    if seg_lang:
        return seg_lang
    overall = whisper_result.get("language")
    return overall if overall else None


def diarize_pyannote(audio_path: str) -> Optional[Any]:
    """pyannote で話者分離。HF_TOKEN 未設定なら None を返す (仕様許容)。"""
    hf_token = os.environ.get("HF_TOKEN")
    if not hf_token:
        print(
            "[transcribe_to_json] HF_TOKEN 未設定、話者分離をスキップ (speaker=null)",
            file=sys.stderr,
        )
        return None

    try:
        import torch
        from pyannote.audio import Pipeline

        os.environ["HF_HOME"] = str(PYANNOTE_MODEL_DIR)
        # pyannote.audio 3.4.0 は use_auth_token を使う。
        # 内部の hf_hub_download も同じ引数を受けるため、huggingface_hub は 0.35.x 系に
        # ダウングレードしておく必要がある (requirements.txt 参照)。
        print("[transcribe_to_json] 話者分離中 (pyannote-3.1)...", file=sys.stderr)
        os.environ.setdefault("HF_TOKEN", hf_token)
        os.environ.setdefault("HUGGINGFACE_HUB_TOKEN", hf_token)
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=hf_token,
        )
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        pipeline = pipeline.to(device)
        diarization = pipeline(audio_path)
        print("[transcribe_to_json] 話者分離完了", file=sys.stderr)
        return diarization
    except Exception as e:
        print(
            f"[transcribe_to_json] WARN: 話者分離エラー、speaker=null で継続: {e}",
            file=sys.stderr,
        )
        return None


def speaker_at_time(diarization: Any, start: float, end: float) -> Optional[str]:
    """指定時間帯の中点で話者を取得。diarization が None なら None。"""
    if diarization is None:
        return None
    mid = (start + end) / 2.0
    for turn, _, label in diarization.itertracks(yield_label=True):
        if turn.start <= mid <= turn.end:
            return str(label)
    return None


# ──────────────────────────────────────────────────────────────────────
# JSON 構築
# ──────────────────────────────────────────────────────────────────────


def _whisper_version() -> str:
    """インストールされている Whisper のバージョン文字列を取得。"""
    try:
        import importlib.metadata as md

        return md.version("openai-whisper")
    except Exception:
        return "unknown"


def build_transcript_json(
    video_path: str,
    whisper_result: dict[str, Any],
    diarization: Any,
    model_size: str,
    recorded_at: Optional[str],
    recorded_at_source: str,
    duration: float,
    fps: float,
) -> dict[str, Any]:
    segments_out = []
    for i, seg in enumerate(whisper_result.get("segments", [])):
        start = round(float(seg.get("start", 0.0)), 2)
        end = round(float(seg.get("end", 0.0)), 2)
        text = (seg.get("text") or "").strip()
        lang = detect_segment_language(whisper_result, seg)
        speaker = speaker_at_time(diarization, start, end)
        segments_out.append(
            {
                "id": i,
                "start": start,
                "end": end,
                "text": text,
                "language": lang,
                "speaker": speaker,
                "use": True,
                "telop_text": None,
                "ai_edited": False,
            }
        )

    return {
        "version": "1.1",
        "source_video": str(Path(video_path).resolve()),
        "video_duration_sec": round(duration, 3),
        "recorded_at": recorded_at,
        "recorded_at_source": recorded_at_source,
        "asr_engine": f"whisper-{model_size}",
        "asr_engine_version": _whisper_version(),
        "fps": fps,
        "created_at": datetime.now(timezone.utc).astimezone().isoformat(),
        "segments": segments_out,
        "ai_suggestions": [],
    }


# ──────────────────────────────────────────────────────────────────────
# エントリポイント
# ──────────────────────────────────────────────────────────────────────


def main() -> int:
    _load_env()
    _ensure_dirs()

    parser = argparse.ArgumentParser(
        description="動画を文字起こしして仕様書 §6 の中間 JSON を出力する"
    )
    parser.add_argument("video_path", help="入力動画ファイルのパス")
    parser.add_argument("-o", "--output", required=True, help="出力 JSON ファイル")
    parser.add_argument(
        "-m",
        "--model",
        default="large-v3",
        help="Whisper モデルサイズ (デフォルト: large-v3)",
    )
    parser.add_argument(
        "--keep-audio",
        action="store_true",
        help="抽出した一時音声を残す (デバッグ用)",
    )
    args = parser.parse_args()

    video_path = args.video_path
    if not Path(video_path).exists():
        print(f"[transcribe_to_json] ERROR: 動画が見つかりません: {video_path}", file=sys.stderr)
        return 1

    # メタデータ取得
    recorded_at, source = get_video_creation_time(video_path)
    if source == "unknown":
        print(
            "[transcribe_to_json] WARN: creation_time / Finder 作成日時 ともに取得不能、"
            "recorded_at=null で継続 (仕様 §11 unknown フォールバック)",
            file=sys.stderr,
        )
    duration, fps = get_video_duration_and_fps(video_path)

    # 一時音声ファイル
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp_audio = f.name

    try:
        extract_audio(video_path, tmp_audio)
        whisper_result = transcribe_whisper(tmp_audio, args.model)
        diarization = diarize_pyannote(tmp_audio)

        transcript = build_transcript_json(
            video_path=video_path,
            whisper_result=whisper_result,
            diarization=diarization,
            model_size=args.model,
            recorded_at=recorded_at,
            recorded_at_source=source,
            duration=duration,
            fps=fps,
        )

        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(transcript, f, ensure_ascii=False, indent=2)
        print(f"[transcribe_to_json] 出力完了: {out_path}", file=sys.stderr)
    finally:
        if not args.keep_audio and Path(tmp_audio).exists():
            try:
                os.remove(tmp_audio)
            except OSError:
                pass

    return 0


if __name__ == "__main__":
    sys.exit(main())

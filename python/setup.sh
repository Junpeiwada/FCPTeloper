#!/bin/bash
# FCPTeloper Python venv セットアップ
# 仕様書 §4.1 / 実装計画 フェーズ2 の Python 環境を構築する。
#
# 使い方:
#   bash python/setup.sh
#
# 出力先: FCPTeloper/python/venv/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${SCRIPT_DIR}/venv"

# PyTorch は 2026 年現在 Python 3.13 用ホイールを提供していないため、
# 3.12 を明示する。3.12 が無ければエラー終了。
PY_BIN="${PYTHON_BIN:-}"
if [ -z "${PY_BIN}" ]; then
  if command -v python3.12 >/dev/null 2>&1; then
    PY_BIN="$(command -v python3.12)"
  else
    echo "[setup] ERROR: python3.12 が見つかりません。Homebrew 等で入れてください:" >&2
    echo "        brew install python@3.12" >&2
    echo "        または環境変数 PYTHON_BIN で明示" >&2
    exit 1
  fi
fi
echo "[setup] 使用する Python: ${PY_BIN} ($(${PY_BIN} --version))"

if [ -d "${VENV_DIR}" ]; then
  # 既存 venv の Python バージョンが 3.13 だと torch インストール失敗で残骸が残るので作り直す
  EXISTING_VER="$(${VENV_DIR}/bin/python --version 2>&1 | awk '{print $2}' | cut -d. -f1,2)"
  WANTED_VER="$(${PY_BIN} --version 2>&1 | awk '{print $2}' | cut -d. -f1,2)"
  if [ "${EXISTING_VER}" != "${WANTED_VER}" ]; then
    echo "[setup] 既存 venv (${EXISTING_VER}) を ${WANTED_VER} で作り直し"
    rm -rf "${VENV_DIR}"
    "${PY_BIN}" -m venv "${VENV_DIR}"
  else
    echo "[setup] venv は既に存在: ${VENV_DIR} (${EXISTING_VER})"
  fi
else
  echo "[setup] venv を作成: ${VENV_DIR}"
  "${PY_BIN}" -m venv "${VENV_DIR}"
fi

# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"

echo "[setup] pip を最新化"
pip install --upgrade pip

echo "[setup] 依存をインストール"
pip install -r "${SCRIPT_DIR}/requirements.txt"

echo "[setup] 完了"
echo "  Python: $(which python)"
echo "  Python version: $(python --version)"

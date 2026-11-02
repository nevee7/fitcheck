#!/usr/bin/env bash
# Start Fitcheck on http://127.0.0.1:8000
# Extra arguments are passed to uvicorn, e.g. ./run.sh --reload
set -euo pipefail
cd "$(dirname "$0")"

# Keep this app's environment separate from any pre-existing .venv in the folder.
export UV_PROJECT_ENVIRONMENT="${UV_PROJECT_ENVIRONMENT:-.venv-app}"

uv sync --quiet
exec uv run uvicorn app.main:app \
  --host 127.0.0.1 \
  --port "${PORT:-8000}" \
  "$@"

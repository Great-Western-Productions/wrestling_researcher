#!/usr/bin/env bash
# Double-click runner: applies the titles/reigns schema migration and
# ingests the WWA World Heavyweight Championship lineage.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
fi

PYTHON="${PYTHON:-./.venv-dev/bin/python}"
if [[ ! -x "$PYTHON" ]]; then
    PYTHON="${PYTHON:-./.venv/bin/python}"
fi
if [[ ! -x "$PYTHON" ]]; then
    PYTHON="$(command -v python3)"
fi

echo "==> Using Python: $PYTHON"
echo
echo "==> 1/2 schema migration"
"$PYTHON" bibliography/migrate_titles_reigns.py
echo
echo "==> 2/2 ingest WWA World Heavyweight Championship"
"$PYTHON" bibliography/ingest_wwa_world_title.py
echo
echo "Done. Press Return to close."
read -r _

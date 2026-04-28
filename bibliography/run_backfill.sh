#!/usr/bin/env bash
# Wrestling Magazine Backfill — driver script
# Runs the dry-run, prompts for confirmation, then executes the real
# downloads, cleans up duplicate copies, and rebuilds the catalog CSV.
#
# Safe to re-run: each step skips work that's already done.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# --- Pretty output ----------------------------------------------------------
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'; C_BOLD=$'\033[1m'
else
  C_RESET=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""
fi
say()  { printf '%s==> %s%s\n' "$C_BLUE$C_BOLD" "$*" "$C_RESET"; }
ok()   { printf '%s ✓ %s%s\n' "$C_GREEN" "$*" "$C_RESET"; }
warn() { printf '%s ! %s%s\n' "$C_YELLOW" "$*" "$C_RESET"; }
err()  { printf '%s ✗ %s%s\n' "$C_RED" "$*" "$C_RESET" >&2; }
die()  { err "$*"; exit 1; }

on_err() {
  local exit_code=$?
  err "Failed at line $1 (exit $exit_code). See messages above."
  err "Logs: $SCRIPT_DIR/download_log.csv  $SCRIPT_DIR/cleanup_log.csv"
  exit "$exit_code"
}
trap 'on_err $LINENO' ERR

# --- Args -------------------------------------------------------------------
ASSUME_YES=0
SKIP_DRY=0
SKIP_DOWNLOAD=0
SKIP_CLEANUP=0
SKIP_CATALOG=0
INCLUDE_SEASONAL=0
LIMIT=""
YEAR=""
MAG=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  -y, --yes              Don't prompt before destructive steps
      --skip-dry         Skip the dry run preview
      --skip-download    Skip the download step
      --skip-cleanup     Skip the duplicate-cleanup step
      --skip-catalog     Skip rebuilding the catalog CSV
      --seasonal         Include seasonal/annual issues
      --limit N          Cap downloads in this run
      --year YYYY        Only download this year
      --mag NAME         Only download this magazine (substring match)
  -h, --help             Show this help

Examples:
  $(basename "$0") --year 1980 --limit 5
  $(basename "$0") -y --mag "Pro Wrestling Illustrated"
  $(basename "$0") --skip-cleanup --skip-catalog
EOF
}

while (($#)); do
  case $1 in
    -y|--yes)         ASSUME_YES=1 ;;
    --skip-dry)       SKIP_DRY=1 ;;
    --skip-download)  SKIP_DOWNLOAD=1 ;;
    --skip-cleanup)   SKIP_CLEANUP=1 ;;
    --skip-catalog)   SKIP_CATALOG=1 ;;
    --seasonal)       INCLUDE_SEASONAL=1 ;;
    --limit)          LIMIT="${2:-}"; shift ;;
    --year)           YEAR="${2:-}"; shift ;;
    --mag)            MAG="${2:-}"; shift ;;
    -h|--help)        usage; exit 0 ;;
    *) die "Unknown arg: $1 (try --help)" ;;
  esac
  shift
done

confirm() {
  (( ASSUME_YES )) && return 0
  local prompt="${1:-Continue?} [y/N] "
  local reply
  read -r -p "$prompt" reply || return 1
  [[ $reply =~ ^[Yy]$ ]]
}

# --- Preflight --------------------------------------------------------------
say "Preflight"

if ! command -v python3 >/dev/null 2>&1; then
  die "python3 not found. Install Python 3 (e.g. via Homebrew: brew install python)"
fi
ok "python3: $(python3 --version 2>&1)"

# Need requests; install if missing
if ! python3 -c "import requests" 2>/dev/null; then
  warn "Python 'requests' not installed — installing now"
  if ! python3 -m pip install --user requests; then
    die "pip install requests failed. Try: pip3 install --user requests"
  fi
  ok "requests installed"
else
  ok "Python 'requests' available"
fi

# Verify Drive folder is reachable (i.e., Google Drive desktop sync is up)
DRIVE_ROOT="$HOME/Library/CloudStorage/GoogleDrive-josh@greatwesternproductions.com/My Drive/BACKGROUND_RESEARCH/Magazines"
if [[ ! -d "$DRIVE_ROOT" ]]; then
  err "Drive folder not found:"
  err "  $DRIVE_ROOT"
  die "Make sure Google Drive for desktop is running and synced."
fi
ok "Drive root reachable"

# Verify all helper scripts are present
for s in download_wrestling_magazines.py cleanup_duplicates.py build_catalog.py; do
  [[ -f "$SCRIPT_DIR/$s" ]] || die "Missing helper script: $s"
done
ok "Helper scripts present"

# Network check (archive.org)
if ! curl --silent --show-error --fail --max-time 10 -o /dev/null https://archive.org/about/; then
  die "Can't reach archive.org. Check your internet."
fi
ok "archive.org reachable"

# --- Build flag arrays ------------------------------------------------------
DL_FLAGS=()
[[ -n $YEAR ]] && DL_FLAGS+=(--year "$YEAR")
[[ -n $MAG ]] && DL_FLAGS+=(--mag "$MAG")
[[ -n $LIMIT ]] && DL_FLAGS+=(--limit "$LIMIT")
(( INCLUDE_SEASONAL )) && DL_FLAGS+=(--seasonal)

# --- Step 1: dry run --------------------------------------------------------
if (( ! SKIP_DRY )); then
  say "Step 1/4 — Dry run (no files will be downloaded)"
  python3 download_wrestling_magazines.py --dry-run ${DL_FLAGS[@]+"${DL_FLAGS[@]}"}
  ok "Dry run complete. Plan logged to download_log.csv"
fi

# --- Step 2: download -------------------------------------------------------
if (( ! SKIP_DOWNLOAD )); then
  echo
  warn "Step 2/4 will download missing PDFs (potentially many GB)."
  if ! confirm "Proceed with the real download?"; then
    warn "Skipping download step."
  else
    say "Step 2/4 — Downloading"
    python3 download_wrestling_magazines.py ${DL_FLAGS[@]+"${DL_FLAGS[@]}"}
    ok "Download complete. See download_log.csv"
  fi
fi

# --- Step 3: dedupe ---------------------------------------------------------
if (( ! SKIP_CLEANUP )); then
  echo
  say "Step 3/4 — Cleaning up duplicate '(1).pdf' files (preview first)"
  python3 cleanup_duplicates.py --dry-run
  echo
  if confirm "Delete the duplicates listed above?"; then
    python3 cleanup_duplicates.py
    ok "Cleanup complete. See cleanup_log.csv"
  else
    warn "Skipping cleanup."
  fi
fi

# --- Step 4: catalog --------------------------------------------------------
if (( ! SKIP_CATALOG )); then
  echo
  say "Step 4/4 — Rebuilding catalog CSV"
  python3 build_catalog.py
  if [[ -f "$SCRIPT_DIR/catalog_full.csv" ]]; then
    ok "Catalog CSV: $SCRIPT_DIR/catalog_full.csv"
    echo "   Open the Periodical Catalog sheet → add a new tab → File → Import → Upload."
  fi
fi

echo
ok "All requested steps complete."
echo "   Optional next step: describe covers via the Anthropic API."
echo "   See README_BACKFILL.md → 'Describing covers'."

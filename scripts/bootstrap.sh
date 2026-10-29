#!/usr/bin/env bash
# From a fresh git checkout to a running, populated local install, in one command:
#
#   pnpm bootstrap
#
# 1. checks the tools, 2. installs Node packages, 3. downloads katha-dev-bundle.zip from Google Drive (the .env
# files and the demo videos, which are too large for git), 4. unpacks it into place, 5. runs `pnpm seed`.
#
# The bundle is found, in order, at: ./katha-dev-bundle.zip (put it there if you downloaded it yourself), the Drive
# file named in seed/bundle.json, or the Drive link in $KATHA_BUNDLE_URL. Existing .env files are never overwritten.
# Options are passed on to the seed step, e.g. `pnpm bootstrap -- --no-series`.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
BUNDLE="$ROOT/katha-dev-bundle.zip"
META="$ROOT/seed/bundle.json"

step() { printf '\n==> %s\n' "$*"; }
need() { command -v "$1" >/dev/null || { echo "missing tool: $1 ($2)" >&2; missing=1; }; }

step "Checking tools"
missing=0
need node "https://nodejs.org, version 22 or newer"
need pnpm "run: corepack enable"
need uv "https://docs.astral.sh/uv/"
need docker "Docker Desktop must be installed and running"
need ffmpeg "brew install ffmpeg (or your package manager)"
need unzip "your package manager"
[ "$missing" = 0 ] || exit 1
docker info >/dev/null 2>&1 || { echo "Docker is installed but not running. Start Docker Desktop and run this again." >&2; exit 1; }

step "Installing Node packages"
corepack enable >/dev/null 2>&1 || true
pnpm install

json_get() { python3 -c "import json,sys;print(json.load(open('$META')).get('$1',''))"; }
sha() { if command -v shasum >/dev/null; then shasum -a 256 "$1" | cut -d' ' -f1; else sha256sum "$1" | cut -d' ' -f1; fi; }

have_videos() { find "$ROOT/seed/ai-series" -name video.mp4 -print -quit 2>/dev/null | grep -q .; }

if have_videos && [ -f "$ROOT/services/api/.env" ]; then
  step "Bundle already unpacked (env files and videos are in place)"
else
  if [ ! -f "$BUNDLE" ]; then
    step "Downloading the bundle from Google Drive (about 430 MB)"
    fid="$(json_get drive_file_id)"
    if [ -n "${KATHA_BUNDLE_URL:-}" ]; then
      uvx gdown --fuzzy "$KATHA_BUNDLE_URL" -O "$BUNDLE"
    elif [ -n "$fid" ]; then
      uvx gdown --id "$fid" -O "$BUNDLE"
    else
      cat >&2 <<MSG
No download source is configured. Either:
  - ask the project owner for the Drive link and run:  KATHA_BUNDLE_URL=<link> pnpm bootstrap
  - or download katha-dev-bundle.zip yourself, save it in $ROOT, and run: pnpm bootstrap
MSG
      exit 1
    fi
  fi
  step "Verifying the download"
  want="$(json_get sha256)"
  got="$(sha "$BUNDLE")"
  if [ -n "$want" ] && [ "$want" != "$got" ]; then
    echo "The downloaded file does not match the expected checksum. Delete $BUNDLE and try again, or ask the owner for a new link (the bundle may have been updated: check seed/bundle.json)." >&2
    exit 1
  fi
  step "Unpacking (existing files are kept)"
  unzip -n -q "$BUNDLE" -d "$ROOT"
fi

[ -f "$ROOT/services/api/.env" ] || { echo "services/api/.env is still missing; falling back to the template."; cp "$ROOT/.env.example" "$ROOT/services/api/.env"; }

step "Seeding"
bash "$ROOT/scripts/seed-all.sh" "$@"

cat <<MSG

Setup finished. Start the apps in three terminals:
  pnpm api:dev
  pnpm --filter web dev        # http://localhost:3000
  pnpm --filter admin dev      # http://localhost:3001  (admin@katha.local / katha-local-admin)
MSG

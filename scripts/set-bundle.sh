#!/usr/bin/env bash
# For the project owner: record where the bundle lives after uploading it to Google Drive.
#
#   scripts/set-bundle.sh <drive share link> [path to katha-dev-bundle.zip]
#
# Share the file as "Anyone with the link can view", then paste the link. This writes seed/bundle.json (the Drive
# file id and the checksum) so `pnpm bootstrap` can download and verify it. Commit that file.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
link="${1:?usage: set-bundle.sh <drive share link> [bundle zip]}"
zip="${2:-$HOME/Desktop/katha-dev-bundle.zip}"
id="$(printf '%s' "$link" | sed -nE 's#.*/d/([A-Za-z0-9_-]+).*#\1#p; s#.*[?&]id=([A-Za-z0-9_-]+).*#\1#p' | head -1)"
[ -n "$id" ] || { echo "could not find a Drive file id in that link" >&2; exit 1; }
sum="$( (shasum -a 256 "$zip" 2>/dev/null || sha256sum "$zip") | cut -d' ' -f1)"
python3 - "$ROOT/seed/bundle.json" "$id" "$sum" <<'PY'
import json, sys
p, fid, sha = sys.argv[1:]
d = json.load(open(p)); d["drive_file_id"] = fid; d["sha256"] = sha
json.dump(d, open(p, "w"), indent=2); open(p, "a").write("\n")
print("seed/bundle.json updated:", fid, sha[:12] + "...")
PY

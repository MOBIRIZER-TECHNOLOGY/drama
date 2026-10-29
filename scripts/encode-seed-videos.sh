#!/usr/bin/env bash
# Make the light development copies of the demo episodes (about 20 MB each instead of the 145 MB masters).
#
#   scripts/encode-seed-videos.sh <masters-root> [out-root]
#
# <masters-root> mirrors seed/ai-series: <slug>/episode-NN/video.mp4 (the delivered masters, 4.6 GB in all).
# [out-root] defaults to seed/ai-series, where the importer looks for the videos. Safe to re-run: finished files are skipped.
set -euo pipefail

src="${1:?usage: encode-seed-videos.sh <masters-root> [out-root]}"
out="${2:-$(cd "$(dirname "$0")/.." && pwd)/seed/ai-series}"
command -v ffmpeg >/dev/null || { echo "ffmpeg is required"; exit 1; }

count=0
while IFS= read -r f; do
  rel="${f#"$src"/}"
  dest="$out/$rel"
  if [ -s "$dest" ]; then continue; fi
  mkdir -p "$(dirname "$dest")"
  # 720x1280 H.264 at about 2.5 Mbps: the worker still builds the 720p/480p/360p ladder from this.
  ffmpeg -nostdin -loglevel error -y -i "$f" \
    -c:v libx264 -preset veryfast -crf 24 -maxrate 3M -bufsize 6M -pix_fmt yuv420p -r 24 \
    -c:a aac -b:a 128k -ar 48000 -movflags +faststart -f mp4 "$dest.part"
  mv "$dest.part" "$dest"
  count=$((count + 1))
  echo "encoded $rel"
done < <(find "$src" -name video.mp4 | sort)
echo "done: $count encoded"

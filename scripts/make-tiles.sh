#!/usr/bin/env bash
# Build the deep-zoom tile pyramid from a square high-res scan.
#   bash scripts/make-tiles.sh [source.jpg]
# Output: assets/base.webp (2048px), assets/timeline-thumb.jpg (360px),
#         assets/tiles/<size>/<col>_<row>.webp (1024px tiles)
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:-assets/timeline.jpg}"
TILE=1024
FULL=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$SRC")
echo "source: $SRC (${FULL}px)"

ffmpeg -loglevel error -y -i "$SRC" -vf "scale=2048:2048:flags=lanczos" -c:v libwebp -quality 82 assets/base.webp
ffmpeg -loglevel error -y -i "$SRC" -vf "scale=360:360:flags=lanczos" -q:v 3 assets/timeline-thumb.jpg

for SIZE in $((FULL / 4)) $((FULL / 2)) $FULL; do
  N=$(( (SIZE + TILE - 1) / TILE ))
  OUT="assets/tiles/$SIZE"
  mkdir -p "$OUT" "$OUT/.tmp"
  echo "level $SIZE: ${N}x${N} tiles"
  ffmpeg -loglevel error -y -i "$SRC" \
    -vf "scale=$SIZE:$SIZE:flags=lanczos,pad=$((N * TILE)):$((N * TILE)):0:0:white,untile=${N}x${N}" \
    -c:v libwebp -quality 80 -start_number 0 "$OUT/.tmp/%04d.webp"
  for f in "$OUT"/.tmp/*.webp; do
    i=$((10#$(basename "$f" .webp)))
    mv "$f" "$OUT/$((i % N))_$((i / N)).webp"
  done
  rmdir "$OUT/.tmp"
done
echo "done"

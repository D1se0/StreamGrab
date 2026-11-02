#!/usr/bin/env bash
# 1-hour HLS (fMP4, video+audio muxed) at low resolution: ~108k video samples. Used to catch scale bugs (stack overflow, memory).
set -euo pipefail
OUT="$(cd "$(dirname "$0")" && pwd)/fixtures/hls_long"; rm -rf "$OUT"; mkdir -p "$OUT"
ffmpeg -v error -y -f lavfi -i testsrc2=size=160x90:rate=30:duration=3600 -f lavfi -i sine=frequency=330:sample_rate=44100:duration=3600 \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p -g 150 -keyint_min 150 -sc_threshold 0 -bf 2 -b:v 150k -c:a aac -b:a 48k -ac 1 \
  -f hls -hls_time 10 -hls_playlist_type vod -hls_segment_type fmp4 -hls_fmp4_init_filename init.mp4 -hls_segment_filename "$OUT/s_%04d.m4s" "$OUT/index.m3u8"
ls "$OUT" | wc -l

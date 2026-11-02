#!/usr/bin/env bash
# Generates deterministic test streams with ffmpeg (needs libx264 + aac).
set -euo pipefail
OUT="$(cd "$(dirname "$0")" && pwd)/fixtures"; rm -rf "$OUT"; mkdir -p "$OUT"/{hls_ts,hls_enc,hls_fmp4,dash,progressive}
SRC="-f lavfi -i testsrc2=size=640x360:rate=25:duration=12 -f lavfi -i sine=frequency=440:sample_rate=44100:duration=12"
ENC="-c:v libx264 -preset ultrafast -pix_fmt yuv420p -g 50 -keyint_min 50 -sc_threshold 0 -bf 2 -c:a aac -b:a 96k -ac 2"
# 0) progressive + reference
ffmpeg -v error -y $SRC $ENC -movflags +faststart "$OUT/progressive/ref.mp4"
# 1) HLS MPEG-TS, 2 renditions + master (video+audio muxed in TS)
ffmpeg -v error -y -i "$OUT/progressive/ref.mp4" -c copy -f hls -hls_time 4 -hls_playlist_type vod -hls_segment_filename "$OUT/hls_ts/hi_%03d.ts" "$OUT/hls_ts/hi.m3u8"
ffmpeg -v error -y -i "$OUT/progressive/ref.mp4" -vf scale=320:180 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -g 50 -sc_threshold 0 -b:v 200k -c:a aac -b:a 64k -f hls -hls_time 4 -hls_playlist_type vod -hls_segment_filename "$OUT/hls_ts/lo_%03d.ts" "$OUT/hls_ts/lo.m3u8"
cat > "$OUT/hls_ts/master.m3u8" <<M
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=320x180,CODECS="avc1.42c01e,mp4a.40.2"
lo.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2"
hi.m3u8
M
# 2) HLS AES-128 encrypted TS
openssl rand 16 > "$OUT/hls_enc/key.bin"
echo "key.bin" > "$OUT/hls_enc/keyinfo"; echo "$OUT/hls_enc/key.bin" >> "$OUT/hls_enc/keyinfo"; echo "$(openssl rand -hex 16)" >> "$OUT/hls_enc/keyinfo"
ffmpeg -v error -y -i "$OUT/progressive/ref.mp4" -c copy -f hls -hls_time 4 -hls_playlist_type vod -hls_key_info_file "$OUT/hls_enc/keyinfo" -hls_segment_filename "$OUT/hls_enc/s_%03d.ts" "$OUT/hls_enc/index.m3u8"
# 3) HLS fMP4 with SEPARATE audio rendition (audio group)
ffmpeg -v error -y -i "$OUT/progressive/ref.mp4" -map 0:v -c copy -f hls -hls_time 4 -hls_playlist_type vod -hls_segment_type fmp4 -hls_fmp4_init_filename v_init.mp4 -hls_segment_filename "$OUT/hls_fmp4/v_%03d.m4s" "$OUT/hls_fmp4/v.m3u8"
ffmpeg -v error -y -i "$OUT/progressive/ref.mp4" -map 0:a -c copy -f hls -hls_time 4 -hls_playlist_type vod -hls_segment_type fmp4 -hls_fmp4_init_filename a_init.mp4 -hls_segment_filename "$OUT/hls_fmp4/a_%03d.m4s" "$OUT/hls_fmp4/a.m3u8"
cat > "$OUT/hls_fmp4/master.m3u8" <<M
#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="a.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2",AUDIO="aud"
v.m3u8
M
# 4) DASH (separate fMP4 audio/video, SegmentTemplate + timeline)
ffmpeg -v error -y -i "$OUT/progressive/ref.mp4" -map 0:v -map 0:a -c copy -f dash -seg_duration 4 -use_template 1 -use_timeline 1 -init_seg_name 'init-$RepresentationID$.m4s' -media_seg_name 'chunk-$RepresentationID$-$Number%05d$.m4s' "$OUT/dash/manifest.mpd"
echo fixtures ok; ls "$OUT"/*

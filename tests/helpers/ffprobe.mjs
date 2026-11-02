import { execFileSync } from 'node:child_process';
export function probe(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file]).toString());
  const v = j.streams.find((s) => s.codec_type === 'video'), a = j.streams.find((s) => s.codec_type === 'audio');
  return { v, a, duration: +j.format.duration, format: j.format.format_name, frames: v ? +v.nb_read_frames : 0 };
}
/** Fully decodes the file; returns ffmpeg's stderr (empty string == no decode errors). */
export function decodeErrors(file) {
  try { execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }); return ''; }
  catch (e) { return String(e.stderr || e.message); }
}

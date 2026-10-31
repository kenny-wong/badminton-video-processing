// What a video file is: length, picture size, frame rate, and above all when
// recording started, which is how a video is matched to a match. Reads
// ffprobe's JSON (lib/ffmpeg.js runs it); no I/O here, so it is unit tested in
// tests/media.test.js.

import { londonTime } from './uk-time.js';

export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v'];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** "30000/1001" -> 29.97 */
export function rate(text) {
  const [n, d] = String(text ?? '').split('/').map(Number);
  return n > 0 && d > 0 ? Math.round((n / d) * 1000) / 1000 : null;
}

/**
 * When recording started, as ms since 1970, and where that came from:
 * - 'apple': iPhones' com.apple.quicktime.creationdate, local time with offset, the start.
 * - 'filename': phone names like VID_20261024_091233, 20261024_091233 (UK
 *   wall-clock) or PXL_20261024_081233123 (Pixel, UTC), the start.
 * - 'creation_time': the MP4's own UTC time (most phones write the start).
 * - 'modified': the file's last change, less its length (often the end of recording).
 */
export function recordedAt(probe, fileName, modifiedMs, duration) {
  const tags = { ...probe?.format?.tags };
  const apple = tags['com.apple.quicktime.creationdate'];
  if (apple) {
    const t = Date.parse(String(apple).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    if (Number.isFinite(t)) return { at: t, source: 'apple' };
  }
  const base = String(fileName ?? '').split(/[\\/]/).pop();
  const pixel = /^PXL_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(base);
  if (pixel) {
    const [, y, mo, d, h, mi, s] = pixel.map(Number);
    return { at: Date.UTC(y, mo - 1, d, h, mi, s), source: 'filename' };
  }
  const local = /(?:^|[^\d])(20\d{2})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})(?!\d)/.exec(base);
  if (local) {
    const [, y, mo, d, h, mi, s] = local;
    const at = londonTime(`${y}-${mo}-${d}`, `${h}:${mi}`) + Number(s) * 1000;
    if (Number.isFinite(at)) return { at, source: 'filename' };
  }
  const created = Date.parse(tags.creation_time ?? '');
  if (Number.isFinite(created) && created > Date.UTC(2005, 0, 1)) return { at: created, source: 'creation_time' };
  if (Number.isFinite(modifiedMs)) return { at: modifiedMs - (duration ?? 0) * 1000, source: 'modified' };
  return { at: null, source: null };
}

/**
 * The parts of ffprobe's JSON the app needs. Width and height are as shown
 * (a phone video stored sideways with a 90° rotation is reported upright).
 */
export function describe(probe, fileName, modifiedMs) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const video = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const audio = streams.find((s) => s.codec_type === 'audio');
  const duration = num(probe?.format?.duration) ?? num(video?.duration);
  const rotation = Number(video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video?.tags?.rotate ?? 0) || 0;
  const sideways = Math.abs(rotation) % 180 === 90;
  const w = num(video?.width);
  const h = num(video?.height);
  const { at, source } = recordedAt(probe, fileName, modifiedMs, duration);
  return {
    duration,
    width: sideways ? h : w,
    height: sideways ? w : h,
    fps: rate(video?.avg_frame_rate) ?? rate(video?.r_frame_rate),
    codec: video?.codec_name ?? null,
    hdr: ['arib-std-b67', 'smpte2084'].includes(video?.color_transfer),
    hasAudio: Boolean(audio),
    rotation,
    recordedAt: at,
    recordedSource: source,
  };
}

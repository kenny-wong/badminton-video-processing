// Shuttle hits in the sound track. A shuttle hit is a short, sharp click,
// much louder in the high frequencies than the hall's hum and chatter, so the
// audio is high-passed (by FFmpeg, in lib/analyse.js) and reduced to one
// loudness value per 10 ms frame. Hits are sudden jumps above the recent level
// (shown on the editor's sound strip and counted as shots). No I/O here, so it is unit tested
// in tests/hits.test.js.

export const FRAME_SECONDS = 0.01;

/** Loudness in dB of each frame of `size` samples (16-bit PCM values, -32768..32767). */
export function frameLevels(samples, size = 160) {
  const n = Math.floor(samples.length / size);
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    for (let i = f * size; i < (f + 1) * size; i++) sum += samples[i] * samples[i];
    out[f] = 10 * Math.log10(sum / size + 1);
  }
  return out;
}

function percentile(values, p) {
  const sorted = Float32Array.from(values).sort();
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
}

/**
 * Times (seconds) of likely hits: frames at least `jump` dB above the average of
 * the half second before, `floor` dB above the hall's usual level (median), the
 * loudest within ±50 ms, dying away by `decay` dB within 40-100 ms (a click,
 * not a whistle or applause starting), and at least `minGap` seconds after the
 * last hit.
 * Higher `sensitivity` (1-10) lowers the jump needed.
 */
export function findHits(levels, { sensitivity = 5, minGap = 0.2, decay = 6 } = {}) {
  const jump = 16 - sensitivity; // 5 -> 11 dB
  const floor = 12 - sensitivity * 0.6;
  const median = percentile(levels, 0.5);
  const back = 50;
  const near = 5;
  const hits = [];
  let sum = 0;
  for (let i = 0; i < levels.length; i++) {
    if (i >= back) {
      const base = sum / back;
      const v = levels[i];
      if (v - base >= jump && v - median >= floor) {
        let peak = true;
        for (let j = Math.max(0, i - near); j <= Math.min(levels.length - 1, i + near); j++) {
          if (levels[j] > v) { peak = false; break; }
        }
        let after = Infinity;
        for (let j = i + 4; j <= Math.min(levels.length - 1, i + 10); j++) after = Math.min(after, levels[j]);
        const t = i * FRAME_SECONDS;
        if (peak && after <= v - decay && (!hits.length || t - hits.at(-1) >= minGap)) hits.push(t);
      }
      sum -= levels[i - back];
    }
    sum += levels[i];
  }
  return hits;
}


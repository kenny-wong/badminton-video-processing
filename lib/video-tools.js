// The Tools page: joining videos end to end, and cutting one into up to three.
// Both copy the picture and sound as they are (FFmpeg -c copy: no
// re-encoding, nothing lost), keep the phone's own metadata boxes
// (lib/mp4.js), and give the new file timestamps worked out from the
// original's (public/shared/video-files.js). New files go next to the
// original and into the library. The originals are never changed; when asked,
// they go to the Recycle Bin once the new files are made and nothing was
// lost, except one linked to a match.
//
// A lossless cut has to start on a key frame (phones write one about every
// second), so a part starts at the last key frame at or before its chosen
// start, and its times are worked out from there.

import { spawn } from 'node:child_process';
import { mkdtemp, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { probe, run } from './ffmpeg.js';
import { describe } from './media.js';
import { carryMetadataFile } from './mp4.js';
import { fileTimes, setFileTimes } from './filetimes.js';
import { saveVideo } from './videos.js';
import { videoFromRow } from './db.js';
import { toRecycleBin } from './recycle.js';
import { cleanParts, mergedName, mergeTime, snapStart, splitName, splitTime } from '../public/shared/video-files.js';

const stopped = () => Object.assign(new Error('Stopped'), { code: 'stopped' });
const bad = (message, code = 'badInput') => Object.assign(new Error(message), { code, status: 400 });

function ffprobeText(tools, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(tools.ffprobe, ['-v', 'error', ...args], { windowsHide: true });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `ffprobe exited ${code}`))));
  });
}

const keyCache = new Map(); // path -> { mtime, keys }

/** The times (s) of the video's key frames: where a lossless cut can start. */
export async function keyframes(tools, path) {
  const { mtimeMs } = await stat(path);
  const hit = keyCache.get(path);
  if (hit && hit.mtime === mtimeMs) return hit.keys;
  const text = await ffprobeText(tools, ['-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', path]);
  const keys = [];
  for (const line of text.split(/\r?\n/)) {
    const [t, flags] = line.split(',');
    if (flags?.includes('K') && Number.isFinite(Number(t))) keys.push(Math.round(Number(t) * 1e6) / 1e6);
  }
  keys.sort((a, b) => a - b);
  keyCache.set(path, { mtime: mtimeMs, keys });
  return keys;
}

/** Packets per stream (every video frame and piece of sound), read without decoding. */
export async function packetCounts(tools, path) {
  const text = await ffprobeText(tools, ['-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', path]);
  return text.split(/\r?\n/).filter(Boolean).map(Number);
}

const streamText = (s) => (s.codec_type === 'video'
  ? `${s.codec_name} ${s.width}×${s.height} ${s.pix_fmt ?? ''}`
  : s.codec_type === 'audio' ? `${s.codec_name} ${s.sample_rate} Hz ${s.channels} ch` : `${s.codec_type} ${s.codec_name ?? s.codec_tag_string ?? ''}`).trim();

/** Why ffprobe's view of these files says they can't be joined without re-encoding (same streams, in the same order). */
export function streamProblems(probes, names) {
  const problems = [];
  const first = probes[0]?.streams ?? [];
  probes.slice(1).forEach((p, i) => {
    const streams = p?.streams ?? [];
    const name = names[i + 1];
    if (streams.length !== first.length) {
      problems.push(`${name} has ${streams.length} streams, ${names[0]} has ${first.length}`);
      return;
    }
    streams.forEach((s, j) => {
      if (streamText(s) !== streamText(first[j])) problems.push(`${name}’s stream ${j + 1} is ${streamText(s)}, ${names[0]}’s is ${streamText(first[j])}`);
    });
  });
  return problems;
}

/** dir/name, or "name (2)" and so on when that's taken. */
export function freePath(dir, name) {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; ; i++) {
    const p = join(dir, i === 1 ? name : `${stem} (${i})${ext}`);
    if (!existsSync(p) && !existsSync(`${p}.partial`)) return p;
  }
}

async function checkSpace(dir, bytes) {
  try {
    const s = await statfs(dir);
    const free = s.bavail * s.bsize;
    if (free < bytes + 200e6) throw bad(`Not enough space on that drive: ${Math.round(bytes / 1e6)} MB needed, ${Math.round(free / 1e6)} MB free`, 'noSpace');
  } catch (err) {
    if (err.code === 'noSpace') throw err;
  }
}

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const muxer = (path) => (extname(path).toLowerCase() === '.mov' ? 'mov' : 'mp4');

// Every stream, else (when FFmpeg can't write some phone data track into an
// MP4) the picture, sound and subtitles only; `dropped` names what was left out.
async function copyStreams(tools, args, out, probeJson, opts) {
  const tail = ['-f', muxer(out), `${out}.partial`];
  try {
    await run(tools, [...args, '-map', '0', '-copy_unknown', ...tail], opts);
    return { dropped: [] };
  } catch (err) {
    if (err.code === 'stopped') throw err;
    const other = (probeJson.streams ?? []).filter((s) => !['video', 'audio', 'subtitle'].includes(s.codec_type));
    if (!other.length) throw err;
    await run(tools, [...args, '-map', '0:v', '-map', '0:a?', '-map', '0:s?', ...tail], opts);
    return { dropped: other.map((s) => `${s.codec_type} track ${s.index + 1} (${s.codec_tag_string || s.codec_name || 'unknown'})`) };
  }
}

// creation_time for the file and for each stream, worked out by `time(t, stream)`
// from the original's (stream is null for the file's own).
const creationOf = (tags) => Date.parse(tags?.creation_time ?? '');
function creationArgs(probeJson, time) {
  const args = [];
  const top = time(creationOf(probeJson.format?.tags), null);
  if (top !== null) args.push('-metadata', `creation_time=${iso(top)}`);
  (probeJson.streams ?? []).forEach((s, i) => {
    const t = time(creationOf(s.tags), i);
    if (t !== null) args.push(`-metadata:s:${i}`, `creation_time=${iso(t)}`);
  });
  return args;
}

const brandArgs = (probeJson) => (probeJson.format?.tags?.major_brand ? ['-brand', probeJson.format.tags.major_brand.trim()] : []);

async function finish(db, tools, path, { times, madeFrom }) {
  await rename(`${path}.partial`, path);
  const set = await setFileTimes(path, times);
  const id = await saveVideo(db, tools, path);
  // Reading the file for the library moved its last-accessed time (Windows keeps it up to date): put it back.
  await setFileTimes(path, { accessed: times.accessed, modified: times.modified });
  db.prepare('UPDATE videos SET made_from = ? WHERE id = ?').run(JSON.stringify(madeFrom), id);
  return { id, set };
}

function loadVideos(db, ids) {
  return ids.map((id) => {
    const v = videoFromRow(db.prepare('SELECT * FROM videos WHERE id = ?').get(id));
    if (!v) throw bad(`No video ${id}`, 'notFound');
    if (v.missing || !existsSync(v.path)) throw bad(`${v.name} isn’t in its folder any more`, 'missing');
    return v;
  });
}

/**
 * Moves the originals to the Recycle Bin (`remove`) and out of the library,
 * but only when nothing went wrong (`notes` is empty) and not one that is
 * linked to a match. Returns { removed: [{ id, name }], notes: [why some stayed] }.
 */
export async function removeOriginals(db, videos, notes, { remove = toRecycleBin, job } = {}) {
  if (notes.length) return { removed: [], notes: ['The original videos were kept because of the notes above.'] };
  const removed = [];
  const kept = [];
  for (const v of videos) {
    if (db.prepare('SELECT match_id FROM videos WHERE id = ?').get(v.id)?.match_id) {
      kept.push(`${v.name} was kept: it’s linked to a match (unlink it there, then remove it by hand)`);
      continue;
    }
    try {
      await remove(v.path);
      db.prepare('DELETE FROM videos WHERE id = ?').run(v.id);
      removed.push({ id: v.id, name: v.name });
      job?.log(`Moved ${v.path} to the Recycle Bin`);
    } catch (err) {
      kept.push(`${v.name} couldn’t be moved to the Recycle Bin: ${err.message}`);
    }
  }
  return { removed, notes: kept };
}

/**
 * Joins the videos, in the order given, into "<first> merged.<ext>" next to
 * the first. Metadata and start times come from the first video, end times
 * from the last. With `removeOriginal`, the videos go to the Recycle Bin
 * afterwards (see removeOriginals) and, once the first is gone, the merged
 * video takes its name. Returns { video, path, packets, removed, notes }.
 */
export async function mergeVideos(db, tools, { ids, removeOriginal = false, remove, signal, job }) {
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > 50) throw bad('Choose 2 to 50 videos');
  if (new Set(ids).size !== ids.length) throw bad('A video is in the list twice');
  const videos = loadVideos(db, ids);
  const times = [];
  for (const v of videos) times.push(await fileTimes(v.path)); // before anything reads them
  const probes = [];
  for (const v of videos) probes.push(await probe(tools, v.path));
  const problems = streamProblems(probes, videos.map((v) => v.name));
  if (problems.length) throw Object.assign(bad(`These videos can’t be joined without re-encoding: ${problems[0]}`, 'notCompatible'), { detail: problems.join('\n') });
  const first = videos[0];
  const last = videos.at(-1);
  const total = videos.reduce((sum, v, i) => sum + (Number(probes[i].format?.duration) || v.duration || 0), 0);
  const dir = dirname(first.path);
  await checkSpace(dir, videos.reduce((sum, v) => sum + v.size, 0));
  const out = freePath(dir, mergedName(first.name));
  const start = describe(probes[0], first.path, times[0].modified).recordedAt;
  const firstDuration = Number(probes[0].format?.duration) || first.duration || 0;
  const when = { start, duration: firstDuration, total };
  const lastProbe = probes.at(-1);

  const work = await mkdtemp(join(tmpdir(), 'badminton-video-merge-'));
  try {
    const list = join(work, 'list.txt');
    await writeFile(list, videos.map((v) => `file '${v.path.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
    job?.log(`Joining ${videos.map((v) => v.name).join(' + ')} into ${basename(out)}`);
    // creation_time of the merged file and its streams: the first video's start, or the last one's end.
    const time = (t, i) => (Number.isFinite(t) ? mergeTime(t, creationOf(i === null ? lastProbe.format?.tags : lastProbe.streams?.[i]?.tags), when) : null);
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-i', first.path,
      '-c', 'copy', '-map_metadata', '1',
      ...(probes[0].streams ?? []).flatMap((s, i) => [`-map_metadata:s:${i}`, `1:s:${i}`]),
      ...creationArgs(probes[0], time), ...brandArgs(probes[0])];
    const { dropped } = await copyStreams(tools, args, out, probes[0], {
      signal,
      onProgress: (s) => { if (job) { job.progress = Math.min(0.9, (s / total) * 0.9); job.message = `Joining: ${Math.round((s / total) * 100)}%`; } },
    });
    if (signal?.aborted) throw stopped();
    if (job) job.message = 'Keeping the phone’s details';
    const meta = await carryMetadataFile(first.path, `${out}.partial`);
    if (job) job.message = 'Checking every frame was copied';
    const counts = [];
    for (const v of videos) counts.push(await packetCounts(tools, v.path));
    const outCounts = await packetCounts(tools, `${out}.partial`);
    const notes = [];
    if (!dropped.length) {
      const expected = counts[0].map((_, i) => counts.reduce((sum, c) => sum + (c[i] ?? 0), 0));
      const short = expected.map((n, i) => [i, n - (outCounts[i] ?? 0)]).filter(([, d]) => d !== 0);
      if (short.length) notes.push(`Packet counts differ from the originals: ${short.map(([i, d]) => `stream ${i + 1} ${d > 0 ? `${d} fewer` : `${-d} more`}`).join(', ')}`);
    }
    if (dropped.length) notes.push(`FFmpeg couldn’t copy these into the new file: ${dropped.join(', ')}`);
    if (meta.skipped) notes.push(`The phone’s own metadata boxes weren’t copied: ${meta.skipped}`);
    const fileTimesOut = {
      created: mergeTime(times[0].created, times.at(-1).created, when),
      modified: mergeTime(times[0].modified, times.at(-1).modified, when),
      accessed: mergeTime(times[0].accessed, times.at(-1).accessed, when),
    };
    const madeFrom = { kind: 'merge', from: videos.map((v) => ({ id: v.id, name: v.name })) };
    const { id } = await finish(db, tools, out, { times: fileTimesOut, madeFrom });
    job?.log(`Saved ${out}`);
    let removed = [];
    let path = out;
    if (removeOriginal) {
      if (job) job.message = 'Moving the originals to the Recycle Bin';
      const r = await removeOriginals(db, videos, notes, { remove, job });
      removed = r.removed;
      notes.push(...r.notes);
      // With the first video in the bin, the merged one takes its name (the start time it holds is still right).
      const named = join(dir, first.name);
      if (removed.some((v) => v.id === first.id) && !existsSync(named)) {
        await rename(out, named);
        db.prepare('UPDATE videos SET path = ? WHERE id = ?').run(named, id);
        path = named;
        job?.log(`Renamed it ${first.name}`);
      }
    }
    return { video: videoFromRow(db.prepare('SELECT * FROM videos WHERE id = ?').get(id)), path, packets: outCounts, carried: meta.carried, removed, notes };
  } catch (err) {
    await rm(`${out}.partial`, { force: true }).catch(() => {});
    throw err;
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The parts as they will be cut: each part's start moved back to a key frame.
 * [{ n, start, end, from, length, name }]
 */
export function planSplit(video, keys, parts) {
  const { parts: clean, problems } = cleanParts(parts, video.duration);
  if (problems.length) throw bad(problems[0]);
  return clean.map((p) => {
    const from = snapStart(keys, p.start);
    return { ...p, from, length: p.end - from, name: splitName(video.name, from, p.n) };
  });
}

/**
 * Cuts the video into its parts, each saved next to it as
 * "<name with its own start time> part N.<ext>". With `removeOriginal`, the
 * video goes to the Recycle Bin afterwards (see removeOriginals), including
 * whatever lay outside the parts. Returns { parts, removed, notes }.
 */
export async function splitVideo(db, tools, { id, parts, removeOriginal = false, remove, signal, job }) {
  const [video] = loadVideos(db, [id]);
  const times = await fileTimes(video.path);
  const p = await probe(tools, video.path);
  const duration = Number(p.format?.duration) || video.duration || 0;
  const keys = await keyframes(tools, video.path);
  const plan = planSplit({ ...video, duration }, keys, parts);
  const dir = dirname(video.path);
  await checkSpace(dir, plan.reduce((sum, x) => sum + (x.length / duration) * video.size, 0));
  const start = describe(p, video.path, times.modified).recordedAt;
  const total = plan.reduce((sum, x) => sum + x.length, 0);
  const made = [];
  const notes = [];
  let done = 0;
  for (const part of plan) {
    if (signal?.aborted) throw stopped();
    const out = freePath(dir, part.name);
    const when = { start, duration, offset: part.from, length: part.length };
    const time = (t) => (Number.isFinite(t) ? splitTime(t, when) : null);
    job?.log(`Part ${part.n}: ${part.from.toFixed(3)} s to ${part.end.toFixed(3)} s → ${basename(out)}`);
    try {
      const args = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', part.from.toFixed(6), '-to', part.end.toFixed(6), '-i', video.path,
        '-c', 'copy', '-map_metadata', '0', ...creationArgs(p, time), ...brandArgs(p)];
      const { dropped } = await copyStreams(tools, args, out, p, {
        signal,
        onProgress: (s) => { if (job) { job.progress = Math.min(0.95, (done + Math.min(s, part.length)) / total); job.message = `Part ${part.n} of ${plan.length}`; } },
      });
      const meta = await carryMetadataFile(video.path, `${out}.partial`, { shiftDate: (t) => splitTime(t, when) });
      if (dropped.length) notes.push(`Part ${part.n}: FFmpeg couldn’t copy ${dropped.join(', ')}`);
      if (meta.skipped) notes.push(`Part ${part.n}: the phone’s own metadata boxes weren’t copied: ${meta.skipped}`);
      const madeFrom = { kind: 'split', from: [{ id: video.id, name: video.name }], part: part.n, offset: part.from, length: part.length };
      const { id: newId } = await finish(db, tools, out, {
        times: { created: time(times.created), modified: time(times.modified), accessed: time(times.accessed) },
        madeFrom,
      });
      made.push({ ...part, path: out, video: videoFromRow(db.prepare('SELECT * FROM videos WHERE id = ?').get(newId)) });
      job?.log(`Saved ${out}`);
    } catch (err) {
      await rm(`${out}.partial`, { force: true }).catch(() => {});
      throw err;
    }
    done += part.length;
  }
  let removed = [];
  if (removeOriginal) {
    if (job) job.message = 'Moving the original to the Recycle Bin';
    const r = await removeOriginals(db, [video], notes, { remove, job });
    removed = r.removed;
    notes.push(...r.notes);
  }
  return { parts: made, removed, notes };
}

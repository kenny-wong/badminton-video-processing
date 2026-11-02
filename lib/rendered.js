// A match's finished files: the whole rendered video, the ★ highlights and the
// rally clips (found in the tournament's Clips folder by the match's file name),
// each with the YouTube title and description to use for it (the match's
// comment, if any, at the end of each description, so changing it needs no new
// render).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describeOutput, sourceFor } from './pipeline.js';
import { outputPath, safeName, TITLE_MAX, withComment, withFullNames } from './naming.js';
import { nowIso } from './db.js';

/** "Lee v Ho | XD U15 …" + " · rally 5": the end is kept and the start shortened to fit YouTube's 100 characters. */
export function withSuffix(title, suffix, max = TITLE_MAX) {
  return title.length + suffix.length <= max ? `${title}${suffix}` : `${title.slice(0, Math.max(0, max - suffix.length - 1)).trimEnd()}…${suffix}`;
}

/** The render's .txt next to the video: { title, description }, or null. */
function described(path) {
  const txt = path.replace(/\.mp4$/i, '.txt');
  if (!existsSync(txt)) return null;
  const [title = '', ...rest] = readFileSync(txt, 'utf8').replace(/\r\n/g, '\n').split('\n');
  return { title: title.trim(), description: rest.join('\n').trim() };
}

/** "0900 XD U15 - Lee v Ho - rally 5 (upright).mp4" -> { rally: 5, upright: true } for this match's base name, else null. */
export function clipOf(fileName, base) {
  if (!fileName.startsWith(`${base} - rally `)) return null;
  const m = /^ - rally (\d+)( \(upright\))?\.mp4$/i.exec(fileName.slice(base.length));
  return m ? { rally: Number(m[1]), upright: Boolean(m[2]) } : null;
}

const fileInfo = (path) => {
  const s = statSync(path);
  return { size: s.size, mtime: s.mtime.toISOString() };
};

/**
 * Every finished file of the match, newest first: { key, kind, label, path,
 * title, description, size, mtime, rally?, upright? }. `key` names it in URLs
 * and requests: 'video', 'highlights' or 'clip:<file name>'.
 */
export function renderedFiles(loaded, settings, { people = null } = {}) {
  const { match, tournament } = loaded;
  const options = settings.description;
  const files = [];
  for (const [kind, path] of [['video', match.outputPath], ['highlights', match.highlightsPath]]) {
    if (!path || !existsSync(path)) continue;
    const fallback = describeOutput(loaded, null, { highlights: kind === 'highlights', people, options });
    files.push({
      key: kind, kind, label: kind === 'video' ? 'Whole match' : '★ Highlights', path,
      ...(described(path) ?? { title: fallback.title, description: fallback.description }), ...fileInfo(path),
    });
  }
  const name = outputPath({ tournament, match });
  const dir = join(settings.outputFolder, name[0], name[1], 'Clips');
  if (existsSync(dir)) {
    const base = safeName(name[2].replace(/\.mp4$/, ''), 100);
    const plain = describeOutput(loaded, null, { people, options });
    for (const f of readdirSync(dir)) {
      const clip = clipOf(f, base);
      if (!clip) continue;
      const path = join(dir, f);
      files.push({
        key: `clip:${f}`, kind: 'clip', label: `Rally ${clip.rally} clip${clip.upright ? ', upright' : ''}`, path, ...clip,
        title: withSuffix(plain.title, ` · rally ${clip.rally}`), description: plain.description, ...fileInfo(path),
      });
    }
  }
  return files.map((f) => ({ ...f, title: withFullNames(f.title, match), description: withComment(f.description, match.comment) }))
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

/**
 * The match's original video as it is, for uploading without rendering (key 'original'): the whole
 * match's title and description, its chapters at the video's own times. Null when it isn't there.
 */
export function originalFile(loaded, settings, { people = null } = {}) {
  const source = sourceFor(loaded);
  if (!source.ready || !existsSync(source.path)) return null;
  const d = describeOutput(loaded, [{ start: 0, end: source.duration, outStart: 0 }], { people, options: settings.description });
  return {
    key: 'original', kind: 'original', label: 'Original video (not rendered)', path: source.path,
    title: withFullNames(d.title, loaded.match), description: withComment(d.description, loaded.match.comment), ...fileInfo(source.path),
  };
}

/** The finished file with that key, or null. */
export const renderedFile = (loaded, settings, key, opts) => renderedFiles(loaded, settings, opts).find((f) => f.key === key) ?? null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Deletes a file, retrying for a few seconds while Windows still has it open (the editor's player lets go a moment after switching). */
async function removeFile(path, { tries = 10, wait = 300 } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await rm(path, { force: true });
    } catch (err) {
      if (i >= tries || !['EBUSY', 'EPERM'].includes(err.code)) throw err;
      await sleep(wait);
    }
  }
}

/**
 * Deletes one finished file (never the original video, which isn't in the list):
 * a rendered video goes with its .txt, and the match forgets it. Returns the
 * file deleted, or null when there's no such file.
 */
export async function deleteRendered(db, loaded, settings, key, opts) {
  const file = renderedFile(loaded, settings, key);
  if (!file) return null;
  await removeFile(file.path, opts);
  if (file.kind !== 'clip') await removeFile(file.path.replace(/\.mp4$/i, '.txt'), opts);
  if (file.kind === 'video') db.prepare('UPDATE matches SET output_path = NULL, rendered_at = NULL, updated_at = ? WHERE id = ?').run(nowIso(), loaded.match.id);
  if (file.kind === 'highlights') db.prepare('UPDATE matches SET highlights_path = NULL, highlights_at = NULL, updated_at = ? WHERE id = ?').run(nowIso(), loaded.match.id);
  return file;
}

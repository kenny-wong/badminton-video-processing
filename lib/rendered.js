// A match's finished files: the whole rendered video, the ★ highlights and the
// rally clips (found in the tournament's Clips folder by the match's file name),
// each with the YouTube title and description to use for it.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describeOutput } from './pipeline.js';
import { outputPath, safeName, TITLE_MAX } from './naming.js';

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
  return files.sort((a, b) => b.mtime.localeCompare(a.mtime));
}

/** The finished file with that key, or null. */
export const renderedFile = (loaded, settings, key, opts) => renderedFiles(loaded, settings, opts).find((f) => f.key === key) ?? null;

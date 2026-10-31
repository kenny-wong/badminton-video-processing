// The video work for one match: joining its files when it has several,
// finding rallies by sound, and rendering the edited video with the scoreboard.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { run, pickEncoder } from './ffmpeg.js';
import { findRallies } from './analyse.js';
import { assScript, scoreSpans } from './overlay.js';
import { cardArgs, chapterLines, chapterMetadata, chapters, concatLine, joinArgs, outputFps, outputLength, partArgs, plan, sourceJoinArgs } from './render.js';
import { cardScript, endLines, titleLines } from './cards.js';
import { outputPath, videoDescription, videoTitle } from './naming.js';
import { cleanFormat, inferFormat, midPoint, replayMatch } from '../public/shared/score.js';
import { clock } from '../public/shared/time.js';
import { beTournamentUrl } from './links.js';
import { pageUrl } from './badminfo.js';
import { matchFromRow, nowIso, tournamentFromRow, videoFromRow } from './db.js';
import { boardHeading, resolveBoard } from '../public/shared/board.js';
import { matchPeople } from './players.js';

const PARALLEL_PARTS = 3; // the RTX cards' encoder runs several sessions at once

export function loadMatch(db, id) {
  const match = matchFromRow(db.prepare('SELECT * FROM matches WHERE id = ?').get(id));
  if (!match) return null;
  const tournament = tournamentFromRow(db.prepare('SELECT * FROM tournaments WHERE id = ?').get(match.tournamentId));
  const videos = db.prepare('SELECT * FROM videos WHERE match_id = ? ORDER BY part, recorded_at').all(id).map(videoFromRow);
  return { match, tournament, videos };
}

/** The format to score with: the one chosen, else a guess from the official result. */
export const matchFormat = (match) => cleanFormat(match.format ?? inferFormat(match.games, Boolean(match.winner)));

/**
 * The single file the editor plays and the renderer cuts: the video itself, or
 * for several parts the joined file, when it exists and is still current.
 */
export function sourceFor({ match, videos }) {
  if (!videos.length) return { ready: false, path: null, duration: 0, reason: 'noVideo' };
  if (videos.some((v) => v.missing)) return { ready: false, path: null, duration: 0, reason: 'missing' };
  const duration = videos.reduce((s, v) => s + (v.duration ?? 0), 0);
  const first = videos[0];
  const info = { width: first.width, height: first.height, fps: first.fps, hasAudio: videos.every((v) => v.hasAudio), hdr: videos.some((v) => v.hdr) };
  if (videos.length === 1) return { ready: true, path: first.path, duration, ...info };
  const joined = match.sourcePath;
  return joined && existsSync(joined) ? { ready: true, path: joined, duration, ...info } : { ready: false, path: null, duration, reason: 'needsJoin', ...info };
}

const workFolder = (settings, matchId) => join(settings.outputFolder, '.work', `match-${matchId}`);

/** Joins a match's video files, untouched, into one file in the work folder. */
export async function joinParts(db, tools, settings, id, { signal, job }) {
  const { videos } = loadMatch(db, id);
  const dir = workFolder(settings, id);
  await mkdir(dir, { recursive: true });
  const list = join(dir, 'parts.txt');
  await writeFile(list, videos.map((v) => concatLine(v.path)).join('\n') + '\n');
  const out = join(dir, 'source.mp4');
  const total = videos.reduce((s, v) => s + (v.duration ?? 0), 0);
  job.message = `Joining ${videos.length} videos`;
  await run(tools, sourceJoinArgs({ list, out }), { signal, onProgress: (s) => { job.progress = total ? Math.min(1, s / total) : 0; } });
  db.prepare('UPDATE matches SET source_path = ?, updated_at = ? WHERE id = ?').run(out, nowIso(), id);
  return { path: out };
}

/** Suggested rallies by sound (not saved: the page merges them). */
export async function analyseMatch(db, tools, settings, id, { sensitivity, signal, job }) {
  const loaded = loadMatch(db, id);
  const source = sourceFor(loaded);
  if (!source.ready) throw new Error('The match video isn’t ready');
  job.message = 'Listening for shuttle hits';
  const found = await findRallies(tools, source.path, { duration: source.duration, sensitivity, signal, onProgress: (p) => { job.progress = p; } });
  // Only rallies within the marked match: warm-ups before it and knock-ups after don't count.
  const { matchStart, matchEnd } = loaded.match;
  const inside = found.rallies.filter((r) => r.end > (matchStart ?? 0) && r.start < (matchEnd ?? Infinity));
  return { ...found, rallies: inside, outside: found.rallies.length - inside.length };
}

/** The games to show: the official result when there is one, else the tagged score. */
export function shownGames({ match }, tagged = null) {
  if (match.games?.length) return match.games;
  return tagged ?? replayMatch(match, matchFormat(match)).games;
}

/** Title, description and file name for the finished video (or its highlights). */
export function describeOutput(loaded, parts, { highlights = false, people = null, options = {} } = {}) {
  const { match, tournament } = loaded;
  const format = matchFormat(match);
  const { steps, games, initial } = replayMatch(match, format);
  const list = parts && !highlights ? chapters(match.rallies, steps, parts, midPoint(format.points), initial.games.length + 1) : [];
  const shown = shownGames(loaded, games);
  const links = [
    `Draw and results: ${beTournamentUrl(tournament.beId)}`,
    ...(tournament.badminfoId ? [`badminfo: ${pageUrl(tournament.badminfoId)}`] : []),
  ];
  return {
    title: videoTitle({ tournament, match, games: shown, highlights, upset: Boolean(options.upsetInTitle && people?.upset) }),
    description: videoDescription({ tournament, match, games: shown, chapterText: list.length >= 3 ? chapterLines(list, clock) : '', links, people, options }),
    chapters: list,
    file: outputPath({ tournament, match, highlights }),
  };
}

/**
 * Renders the edited video: each kept part cut and encoded with the scoreboard
 * (several at once), then joined without re-encoding, with chapters. With
 * `highlights`, only the favourite rallies, to a separate file.
 */
export async function renderMatch(db, tools, settings, id, { cut = true, overlay = true, highlights = false, titleCard = settings.cards?.title, endCard = settings.cards?.end, signal, job }) {
  const loaded = loadMatch(db, id);
  const { match } = loaded;
  const source = sourceFor(loaded);
  if (!source.ready) throw new Error('The match video isn’t ready');
  const rallies = match.rallies;
  if (cut && !rallies.length) throw new Error('Tag or find the rallies first, or render without cutting');
  const favourites = rallies.filter((r) => r.fav);
  if (highlights && !favourites.length) throw new Error('Mark some favourite rallies (★ or H) first');
  const format = matchFormat(match);
  const { steps, initial } = replayMatch(match, format);
  // The scoreboard always follows every rally; highlights keep only the favourites' parts, never merging separate ones.
  const parts = highlights
    ? plan(favourites, source.duration, { pre: settings.pre, post: settings.post, mergeGap: 0, from: match.matchStart, to: match.matchEnd })
    : plan(rallies, source.duration, { cut, pre: settings.pre, post: settings.post, from: match.matchStart, to: match.matchEnd });
  const cardSeconds = settings.cards?.seconds ?? 3;
  // A title card shifts everything (and the chapters) along by its length.
  if (titleCard) for (const p of parts) p.outStart += cardSeconds;
  const dir = workFolder(settings, id);
  const partsDir = join(dir, 'parts');
  await rm(partsDir, { recursive: true, force: true });
  await mkdir(partsDir, { recursive: true });
  const style = resolveBoard(settings.board, match.boardStyle);
  if (overlay) {
    const ass = assScript({
      width: source.width ?? 1920, height: source.height ?? 1080, teams: [match.teamA, match.teamB], spans: scoreSpans(rallies, steps, source.duration, initial),
      title: match.draw, nameStyle: settings.nameStyle, style, format, heading: boardHeading(style, loaded),
    });
    await writeFile(join(dir, 'overlay.ass'), ass);
  }
  const encoder = pickEncoder(tools);
  const fps = outputFps(source.fps);
  const width = source.width ?? 1920;
  const height = source.height ?? 1080;
  const logoFile = settings.logo?.file && existsSync(settings.logo.file) ? settings.logo.file : null;
  const logo = logoFile ? { path: logoFile, width: (width * settings.logo.size) / 100, corner: settings.logo.corner, opacity: settings.logo.opacity / 100 } : null;
  const total = outputLength(parts);
  const doneSeconds = new Array(parts.length).fill(0);
  const report = () => { job.progress = Math.min(0.97, doneSeconds.reduce((a, b) => a + b, 0) / total); };
  job.message = `Rendering ${parts.length} part${parts.length === 1 ? '' : 's'} (${encoder === 'h264_nvenc' ? 'NVIDIA encoder' : 'CPU encoder'})`;
  const files = parts.map((_, i) => join(partsDir, `part${String(i + 1).padStart(4, '0')}.mp4`));
  let nextPart = 0;
  const worker = async () => {
    while (nextPart < parts.length) {
      const i = nextPart++;
      const p = parts[i];
      await run(tools, partArgs({ src: source.path, start: p.start, end: p.end, out: files[i], overlay, encoder, fps, hasAudio: source.hasAudio, hdr: source.hdr, logo }), {
        cwd: dir, signal, onProgress: (s) => { doneSeconds[i] = Math.min(s, p.end - p.start); report(); },
      });
      doneSeconds[i] = p.end - p.start;
      report();
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_PARTS, parts.length) }, worker));
  const cards = [];
  for (const [kind, wanted, lines] of [['title', titleCard, () => titleLines({ tournament: loaded.tournament, match, highlights })],
    ['end', endCard, () => endLines({ tournament: loaded.tournament, match, games: shownGames(loaded), format })]]) {
    if (!wanted) continue;
    job.message = `Making the ${kind} card`;
    await writeFile(join(dir, `${kind}.ass`), cardScript({ width, height, style, lines: lines() }));
    const file = join(partsDir, `${kind}.mp4`);
    await run(tools, cardArgs({ out: file, width, height, fps, seconds: cardSeconds, colour: style.box, encoder, ass: `${kind}.ass` }), { cwd: dir, signal });
    cards.push([kind, file]);
  }
  const cardFile = (kind) => cards.filter(([k]) => k === kind).map(([, f]) => f);
  const allFiles = [...cardFile('title'), ...files, ...cardFile('end')];
  const length = total + cards.length * cardSeconds;
  job.message = 'Joining';
  const described = describeOutput(loaded, parts, { highlights, people: matchPeople(db, loaded), options: settings.description });
  const list = join(dir, 'parts.txt');
  await writeFile(list, allFiles.map(concatLine).join('\n') + '\n');
  let meta = null;
  if (described.chapters.length) {
    meta = join(dir, 'chapters.txt');
    await writeFile(meta, chapterMetadata(described.chapters, length));
  }
  const out = join(settings.outputFolder, ...described.file);
  await mkdir(dirname(out), { recursive: true });
  await run(tools, joinArgs({ list, chapters: meta, out }), { signal });
  await writeFile(out.replace(/\.mp4$/, '.txt'), `${described.title}\n\n${described.description}\n`);
  await rm(partsDir, { recursive: true, force: true });
  if (highlights) db.prepare('UPDATE matches SET highlights_path = ?, highlights_at = ? WHERE id = ?').run(out, nowIso(), id);
  else db.prepare('UPDATE matches SET output_path = ?, rendered_at = ? WHERE id = ?').run(out, nowIso(), id);
  return { path: out, highlights, seconds: Math.round(length), parts: parts.length, cards: cards.map(([k]) => k), title: described.title, description: described.description };
}

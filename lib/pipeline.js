// The video work for one match: joining its files when it has several,
// finding rallies by sound, and rendering the edited video with the scoreboard.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { run, pickEncoder } from './ffmpeg.js';
import { assScript, scoreSpans } from './overlay.js';
import { cardArgs, chapterLines, chapterMetadata, chapters, concatLine, joinArgs, musicArgs, outputFps, outputLength, outputSize, partArgs, partLength, plan, withBreaks, withReplays } from './render.js';
import { cardScript, endLines, labelScript, titleLines } from './cards.js';
import { outputPath, videoDescription, videoTitle } from './naming.js';
import { firstShown, matchFormat, replayMatch } from '../public/shared/score.js';
import { clock } from '../public/shared/time.js';
import { beTournamentUrl } from './links.js';
import { pageUrl } from './badminfo.js';
import { matchFromRow, nowIso, tournamentFromRow, videoFromRow } from './db.js';
import { boardHeading } from '../public/shared/board.js';
import { matchPeople } from './players.js';
import { matchBoard } from './nations.js';
import { cachedLevels } from './levels.js';
import { matchStats, shotsIn, statsLine } from '../public/shared/stats.js';
import { boardNames } from '../public/shared/names.js';
import { voiceFreeSound } from './voices.js';
import { hdrNpl } from './settings.js';
import { fontsFor } from './fonts.js';
import { insetBox } from '../public/shared/inset.js';

const PARALLEL_PARTS = 3; // the RTX cards' encoder runs several sessions at once

export function loadMatch(db, id) {
  const match = matchFromRow(db.prepare('SELECT * FROM matches WHERE id = ?').get(id));
  if (!match) return null;
  const tournament = tournamentFromRow(db.prepare('SELECT * FROM tournaments WHERE id = ?').get(match.tournamentId));
  const videos = db.prepare('SELECT * FROM videos WHERE match_id = ? ORDER BY part, recorded_at').all(id).map(videoFromRow);
  return { match, tournament, videos };
}

export { matchFormat }; // kept here too for the modules that import it from the pipeline

/** The file the editor plays and the renderer cuts: the match's (or game's) one video. */
export function sourceFor({ videos }) {
  const [video] = videos;
  if (!video) return { ready: false, path: null, duration: 0, reason: 'noVideo' };
  if (video.missing) return { ready: false, path: null, duration: 0, reason: 'missing' };
  return { ready: true, path: video.path, duration: video.duration ?? 0, width: video.width, height: video.height, fps: video.fps, hasAudio: video.hasAudio, hdr: video.hdr };
}

const workFolder = (settings, matchId) => join(settings.outputFolder, '.work', `match-${matchId}`);

/** The music file to lay under a video, when Settings say so for this kind of video and the file is there. */
export function musicFor(settings, highlights) {
  const m = settings.music;
  if (!m?.file || m.use === 'off' || (m.use === 'highlights' && !highlights) || !existsSync(m.file)) return null;
  return m.file;
}

/** The games to show: the official result when there is one, else the tagged score. */
export function shownGames({ match }, tagged = null) {
  if (match.games?.length) return match.games;
  return tagged ?? replayMatch(match, matchFormat(match)).games;
}

/** Title, description and file name for the finished video (or its highlights). */
export function describeOutput(loaded, parts, { highlights = false, people = null, options = {}, total = null } = {}) {
  const { match, tournament } = loaded;
  const format = matchFormat(match);
  const { steps, games } = replayMatch(match, format);
  const length = total ?? Math.max(0, ...(parts ?? []).map((p) => p.outStart + partLength(p)));
  const list = parts ? chapters(match.rallies, steps, parts, { highlights, total: length }) : [];
  const shown = shownGames(loaded, games);
  const links = [
    ...(tournament.beId ? [`Draw and results: ${beTournamentUrl(tournament.beId)}`] : []), // custom tournaments have no draw page
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
 * `highlights`, only the favourite rallies, to a separate file. With
 * `removeVoices`, the sound comes without voices (lib/voices.js).
 */
export async function renderMatch(db, tools, settings, id, {
  cut = true, overlay = true, highlights = false, titleCard = settings.cards?.title, endCard = settings.cards?.end, replays = settings.output?.replays,
  removeVoices = settings.output?.removeVoices, cornerView = true, signal, job,
}) {
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
  // The whole video keeps the interval's break longer (Settings → Cutting).
  const planned = highlights
    ? plan(favourites, source.duration, { pre: settings.pre, post: settings.post, mergeGap: 0, from: match.matchStart, to: match.matchEnd })
    : plan(withBreaks(rallies, steps, settings.intervalPad), source.duration, { cut, pre: settings.pre, post: settings.post, from: match.matchStart, to: match.matchEnd });
  // A slow-motion replay of each favourite rally's last seconds, straight after it.
  const parts = replays && favourites.length ? withReplays(planned, favourites) : planned;
  const cardSeconds = settings.cards?.seconds ?? 3;
  // A title card shifts everything (and the chapters) along by its length.
  if (titleCard) for (const p of parts) p.outStart += cardSeconds;
  const dir = workFolder(settings, id);
  const partsDir = join(dir, 'parts');
  await rm(partsDir, { recursive: true, force: true });
  await mkdir(partsDir, { recursive: true });
  await fontsFor(dir);
  const style = matchBoard(db, settings.board, match, loaded.tournament);
  // Shot counts from the hit sounds, when the editor has worked them out (for long-rally banners and the end card).
  const hits = (await cachedLevels(db, settings, id))?.hits ?? null;
  const shots = hits ? rallies.map((r) => shotsIn(hits, r)) : null;
  if (overlay) {
    const ass = assScript({
      width: source.width ?? 1920, height: source.height ?? 1080, teams: [match.teamA, match.teamB],
      spans: scoreSpans(rallies, steps, source.duration, firstShown(initial, steps, match.serverSet), { shots, longRally: style.longRally }),
      title: match.draw, nameStyle: settings.nameStyle, style, format, heading: boardHeading(style, loaded),
    });
    await writeFile(join(dir, 'overlay.ass'), ass);
  }
  const audio = removeVoices && source.hasAudio ? await voiceFreeSound(tools, settings, id, source, { signal, job }) : null;
  const encoder = pickEncoder(tools);
  const fps = outputFps(source.fps);
  const size = outputSize(source.width, source.height, settings.output?.size);
  const resize = size.w !== source.width || size.h !== source.height ? size : null;
  const { w: width, h: height } = size;
  const maxRate = settings.output?.maxRate ?? 0;
  if (parts.some((p) => p.replay)) await writeFile(join(dir, 'replay.ass'), labelScript({ width: source.width ?? width, height: source.height ?? height, style, text: 'REPLAY' }));
  const logoFile = settings.logo?.file && existsSync(settings.logo.file) ? settings.logo.file : null;
  const logo = logoFile ? { path: logoFile, width: ((source.width ?? width) * settings.logo.size) / 100, corner: settings.logo.corner, opacity: settings.logo.opacity / 100 } : null;
  const inset = cornerView ? insetBox(match.inset, source.width, source.height) : null;
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
      await run(tools, partArgs({ src: source.path, start: p.start, end: p.end, out: files[i], overlay, encoder, fps, hasAudio: source.hasAudio, hdr: source.hdr, npl: hdrNpl(settings.output), logo,
        size: resize, maxRate, slow: p.slow ?? 1, label: p.replay ? 'replay.ass' : null, audio, inset,
      }), {
        cwd: dir, signal, onProgress: (s) => { doneSeconds[i] = Math.min(s, partLength(p)); report(); },
      });
      doneSeconds[i] = partLength(p);
      report();
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_PARTS, parts.length) }, worker));
  const cards = [];
  for (const [kind, wanted, lines] of [['title', titleCard, () => titleLines({ tournament: loaded.tournament, match, highlights })],
    ['end', endCard, () => endLines({ tournament: loaded.tournament, match, games: shownGames(loaded), format,
      extra: settings.cards?.stats ? statsLine(matchStats(rallies, steps, { hits }), boardNames([match.teamA, match.teamB], settings.nameStyle)) : '' })]]) {
    if (!wanted) continue;
    job.message = `Making the ${kind} card`;
    await writeFile(join(dir, `${kind}.ass`), cardScript({ width, height, style, lines: lines() }));
    const file = join(partsDir, `${kind}.mp4`);
    await run(tools, cardArgs({ out: file, width, height, fps, seconds: cardSeconds, colour: style.box, encoder, ass: `${kind}.ass`, maxRate }), { cwd: dir, signal });
    cards.push([kind, file]);
  }
  const cardFile = (kind) => cards.filter(([k]) => k === kind).map(([, f]) => f);
  const allFiles = [...cardFile('title'), ...files, ...cardFile('end')];
  const length = total + cards.length * cardSeconds;
  job.message = 'Joining';
  const described = describeOutput(loaded, parts, { highlights, people: matchPeople(db, loaded), options: settings.description, total: length });
  const list = join(dir, 'parts.txt');
  await writeFile(list, allFiles.map(concatLine).join('\n') + '\n');
  let meta = null;
  if (described.chapters.length) {
    meta = join(dir, 'chapters.txt');
    await writeFile(meta, chapterMetadata(described.chapters, length));
  }
  const out = join(settings.outputFolder, ...described.file);
  await mkdir(dirname(out), { recursive: true });
  const music = musicFor(settings, highlights);
  if (music) {
    job.message = 'Adding the music';
    const joined = join(dir, 'joined.mp4');
    await run(tools, joinArgs({ list, chapters: meta, out: joined }), { signal });
    await run(tools, musicArgs({ video: joined, music, out, length, musicVolume: settings.music.volume / 100, courtVolume: settings.music.court / 100 }), { signal });
    await rm(joined, { force: true });
  } else {
    await run(tools, joinArgs({ list, chapters: meta, out }), { signal });
  }
  await writeFile(out.replace(/\.mp4$/, '.txt'), `${described.title}\n\n${described.description}\n`);
  await rm(partsDir, { recursive: true, force: true });
  if (highlights) db.prepare('UPDATE matches SET highlights_path = ?, highlights_at = ? WHERE id = ?').run(out, nowIso(), id);
  else db.prepare('UPDATE matches SET output_path = ?, rendered_at = ? WHERE id = ?').run(out, nowIso(), id);
  return { path: out, highlights, seconds: Math.round(length), parts: parts.length, cards: cards.map(([k]) => k), title: described.title, description: described.description };
}

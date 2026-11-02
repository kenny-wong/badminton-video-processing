// Highlight reels: the ★ rallies of every filmed match in a tournament, or of
// one player's matches (in a tournament, or all of them), joined into one
// video. Each match keeps its own scoreboard and gets a short card first;
// videos of different shapes are fitted into one size with black bars. The
// choice of matches is tested in tests/reel.test.js.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { run, pickEncoder } from './ffmpeg.js';
import { assScript, scoreSpans } from './overlay.js';
import { cardArgs, chapterMetadata, concatLine, joinArgs, musicArgs, outputFps, outputSize, partArgs, partLength, plan, withReplays } from './render.js';
import { cardScript, labelScript } from './cards.js';
import { loadMatch, matchFormat, musicFor, sourceFor } from './pipeline.js';
import { matchFromRow } from './db.js';
import { safeName } from './naming.js';
import { boardHeading, resolveBoard } from '../public/shared/board.js';
import { replayMatch, gamesText } from '../public/shared/score.js';
import { boardNames, namesMatch, teamName } from '../public/shared/names.js';
import { clock } from '../public/shared/time.js';
import { voiceFreeSound } from './voices.js';
import { hdrNpl } from './settings.js';
import { matchBoard } from './nations.js';
import { fontsFor } from './fonts.js';

export const UNIT_CARD_SECONDS = 2;

/**
 * The filmed matches (or games filmed on their own) with ★ rallies, oldest
 * first: in one tournament, and/or with one player in them (by badminfo id
 * through the draws, or by name).
 */
export function reelUnits(db, { tournamentId = null, playerId = null, playerName = null } = {}) {
  const rows = db.prepare(`SELECT m.* FROM matches m WHERE EXISTS (SELECT 1 FROM videos v WHERE v.match_id = m.id)
      ${tournamentId ? 'AND m.tournament_id = ?' : ''} ORDER BY m.match_date, m.match_time, m.game`).all(...(tournamentId ? [tournamentId] : [])).map(matchFromRow);
  const entries = playerId ? db.prepare('SELECT tournament_id, name FROM tournament_players WHERE player_id = ?').all(playerId) : [];
  const plays = (m) => {
    const names = [...m.teamA, ...m.teamB].map((n) => n.toLowerCase());
    if (playerId) return entries.some((e) => e.tournament_id === m.tournamentId && names.includes(e.name.toLowerCase()));
    if (playerName) return [...m.teamA, ...m.teamB].some((n) => namesMatch(playerName, n));
    return true;
  };
  return rows.filter((m) => m.rallies.some((r) => r.fav) && plays(m));
}

/** Which video sets a reel's shape: the first upright one when most are upright, else the first landscape one. */
export function baseIndex(sources) {
  const upright = sources.map((s) => (s.height ?? 0) > (s.width ?? 0));
  const most = upright.filter(Boolean).length * 2 > upright.length;
  return Math.max(0, upright.indexOf(most));
}

/** "Lee v Ho · WS U15 Final" for a unit's card and chapter. */
const unitTitle = (m) => `${teamName(m.teamA)} v ${teamName(m.teamB)}${m.game ? ` (game ${m.game})` : ''}`;

/**
 * Renders a reel. `title` names it ("Example Open highlights"); `file` is the
 * output path relative to the output folder ([year, folder, name.mp4]).
 */
export async function renderReel(db, tools, settings, { units, title, file, key }, { signal, job }) {
  if (!units.length) throw new Error('No filmed match here has ★ rallies yet. Mark favourites (H) in the editor first.');
  const loaded = units.map((m) => loadMatch(db, m.id));
  const sources = loaded.map(sourceFor);
  const notReady = loaded.filter((l, i) => !sources[i].ready);
  if (notReady.length) throw new Error(`Open these in the editor first (their videos need joining): ${notReady.map((l) => unitTitle(l.match)).join('; ')}`);
  const dir = join(settings.outputFolder, '.work', safeName(`reel-${key}`, 60));
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await fontsFor(dir);
  const encoder = pickEncoder(tools);
  // One size and frame rate for the whole reel: those of the first video of the shape most of them have
  // (landscape when it's even), shrunk as Settings say; the others are fitted in with black bars.
  const base = sources[baseIndex(sources)];
  const size = { ...outputSize(base.width, base.height, settings.output?.size), fit: true };
  const fps = outputFps(base.fps);
  const maxRate = settings.output?.maxRate ?? 0;
  const logoFile = settings.logo?.file && existsSync(settings.logo.file) ? settings.logo.file : null;
  const files = [];
  const chapters = [];
  let at = 0;
  const card = async (name, lines, seconds, style) => {
    await writeFile(join(dir, `${name}.ass`), cardScript({ width: size.w, height: size.h, style, lines }));
    const out = join(dir, `${name}.mp4`);
    await run(tools, cardArgs({ out, width: size.w, height: size.h, fps, seconds, colour: style.box, encoder, ass: `${name}.ass`, maxRate }), { cwd: dir, signal });
    files.push(out);
    at += seconds;
  };
  const firstStyle = resolveBoard(settings.board, null);
  job.message = 'Making the title card';
  await card('title', [{ text: title.toUpperCase(), size: 0.06, tone: 'text', bold: true }, { text: '★ HIGHLIGHTS', size: 0.04, tone: 'accent', bold: true, gap: 0.03 }], settings.cards?.seconds ?? 3, firstStyle);
  const total = units.length;
  for (const [k, { match, tournament }] of loaded.entries()) {
    const source = sources[k];
    const style = matchBoard(db, settings.board, match, tournament);
    const unitDir = join(dir, `m${k + 1}`);
    await mkdir(unitDir, { recursive: true });
    await fontsFor(unitDir);
    const audio = settings.output?.removeVoices && source.hasAudio
      ? await voiceFreeSound(tools, settings, match.id, source, { signal, job, onProgress: (p) => { job.progress = (k + p * 0.5) / total; } })
      : null;
    job.message = `Match ${k + 1} of ${total}: ${unitTitle(match)}`;
    job.progress = k / total;
    chapters.push({ at: Math.floor(at), title: unitTitle(match) });
    await card(`card${k + 1}`, [
      { text: [match.draw, match.round, match.game ? `Game ${match.game}` : ''].filter(Boolean).join(' · ').toUpperCase(), size: 0.04, tone: 'accent', bold: true },
      { text: boardNames([match.teamA, match.teamB], settings.nameStyle).join('  v  '), size: 0.06, tone: 'text', bold: true, gap: 0.02 },
      { text: [tournament.name, gamesText(match.games)].filter(Boolean).join(' · ').toUpperCase(), size: 0.032, tone: 'dim', gap: 0.02 },
    ], UNIT_CARD_SECONDS, style);
    const format = matchFormat(match);
    const { steps, initial } = replayMatch(match, format);
    await writeFile(join(unitDir, 'overlay.ass'), assScript({
      width: source.width ?? 1920, height: source.height ?? 1080, teams: [match.teamA, match.teamB], spans: scoreSpans(match.rallies, steps, source.duration, initial),
      title: match.draw, nameStyle: settings.nameStyle, style, format, heading: boardHeading(style, { tournament, match }),
    }));
    const favourites = match.rallies.filter((r) => r.fav);
    let parts = plan(favourites, source.duration, { pre: settings.pre, post: settings.post, mergeGap: 0, from: match.matchStart, to: match.matchEnd });
    if (settings.output?.replays) {
      parts = withReplays(parts, favourites);
      await writeFile(join(unitDir, 'replay.ass'), labelScript({ width: source.width ?? 1920, height: source.height ?? 1080, style, text: 'REPLAY' }));
    }
    const logo = logoFile ? { path: logoFile, width: ((source.width ?? 1920) * settings.logo.size) / 100, corner: settings.logo.corner, opacity: settings.logo.opacity / 100 } : null;
    for (const [i, p] of parts.entries()) {
      const out = join(unitDir, `part${String(i + 1).padStart(4, '0')}.mp4`);
      await run(tools, partArgs({
        src: source.path, start: p.start, end: p.end, out, encoder, fps, hasAudio: source.hasAudio, hdr: source.hdr, npl: hdrNpl(settings.output), logo, size, maxRate,
        slow: p.slow ?? 1, label: p.replay ? 'replay.ass' : null, audio,
      }), { cwd: unitDir, signal });
      files.push(out);
      at += partLength(p);
    }
  }
  job.message = 'Joining';
  job.progress = 0.97;
  const list = join(dir, 'parts.txt');
  await writeFile(list, files.map(concatLine).join('\n') + '\n');
  const usable = chapters.filter((c, i) => i === 0 || c.at - chapters[i - 1].at >= 10);
  if (usable.length) usable[0].at = 0;
  const meta = usable.length >= 2 ? join(dir, 'chapters.txt') : null;
  if (meta) await writeFile(meta, chapterMetadata(usable, at));
  const out = join(settings.outputFolder, ...file);
  await mkdir(dirname(out), { recursive: true });
  const music = musicFor(settings, true);
  if (music) {
    const joined = join(dir, 'joined.mp4');
    await run(tools, joinArgs({ list, chapters: meta, out: joined }), { signal });
    job.message = 'Adding the music';
    await run(tools, musicArgs({ video: joined, music, out, length: at, musicVolume: settings.music.volume / 100, courtVolume: settings.music.court / 100 }), { signal });
  } else {
    await run(tools, joinArgs({ list, chapters: meta, out }), { signal });
  }
  const description = [title, '', ...(usable.length >= 3 ? usable.map((c) => `${clock(c.at)} ${c.title}`) : loaded.map((l) => unitTitle(l.match)))].join('\n');
  await writeFile(out.replace(/\.mp4$/, '.txt'), `${title.slice(0, 100)}\n\n${description}\n`);
  await rm(dir, { recursive: true, force: true });
  return { path: out, seconds: Math.round(at), matches: units.length, title };
}

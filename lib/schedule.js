// Match times from Badminton England's own tournament pages (tournamentsoftware,
// copied from the badminton project),
// which badminfo doesn't carry: when each match is (or was) due on court, the
// court, and how long a finished match took. Those pages sit behind a cookie
// notice, so the server accepts only the necessary cookies, as a visitor
// pressing "accept necessary" would, and reads the day's match list. No DOM
// code here, so it is unit tested in tests/schedule.test.js.

export const ORIGIN = 'https://be.tournamentsoftware.com';
export const MAX_DAYS = 4; // longer events (season-long series) are skipped
const UA = 'Mozilla/5.0 (compatible; badminton-video desktop app)';
const TIMEOUT_MS = 8000;
const MAX_BYTES = 3_000_000;

/** The days to read, as YYYYMMDD, from YYYY-MM-DD start and end; null when invalid or longer than MAX_DAYS. */
export function scheduleDays(start, end = start) {
  const ok = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!ok(start) || !ok(end || start)) return null;
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end || start}T00:00:00Z`);
  const days = Math.round((to - from) / 86400000) + 1;
  if (!(days >= 1 && days <= MAX_DAYS)) return null;
  return Array.from({ length: days }, (_, i) => new Date(from + i * 86400000).toISOString().slice(0, 10).replace(/-/g, ''));
}

/** The consent cookie ("st=…") the site sets once only the necessary cookies are accepted. */
export async function consentCookie() {
  const res = await fetch(`${ORIGIN}/cookiewall/Save`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: 'ReturnUrl=%2F&SettingsOpen=false', // no optional purposes: necessary cookies only
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const cookies = res.headers.getSetCookie?.() ?? [res.headers.get('Set-Cookie') ?? ''];
  const st = cookies.map((c) => /(?:^|,\s*)st=([^;]+)/.exec(c)?.[1]).find(Boolean);
  if (!st) throw new Error(`no consent cookie (HTTP ${res.status})`);
  return `st=${st}`;
}

/** One page of the site (path from the root), read with the consent cookie; '' when it is too large. */
export async function fetchPage(path, cookie) {
  const res = await fetch(`${ORIGIN}${path}`, {
    headers: { Cookie: cookie, 'User-Agent': UA, Accept: 'text/html' },
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const html = await res.text();
  return html.length > MAX_BYTES ? '' : html;
}

/** One day's match list page. */
export const fetchDay = (be, day, cookie) => fetchPage(`/tournament/${be}/matches/${day}`, cookie);

export const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

/**
 * The matches on one day's page: each with its time (the group heading above
 * it), draw ("XD U15 - Group A"), round, court, duration in minutes once
 * played, the two sides' player names, games and winner (1 or 2).
 * @returns {{ date: string, time: string, draw: string, round: string, court: string,
 *   duration: number|null, teams: string[][], games: number[][], winner: number|null }[]}
 */
export function parseMatches(html, day) {
  const date = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
  const marks = [];
  let time = '';
  for (const m of html.matchAll(/<h5[^>]*match-group__header[^>]*>\s*(\d{1,2}:\d{2})\s*<\/h5>|<div class="match match--list">/g)) {
    if (m[1]) time = m[1].padStart(5, '0');
    else marks.push({ index: m.index, time });
  }
  return marks.map(({ index, time: at }, k) => {
    const block = html.slice(index, marks[k + 1]?.index ?? html.length);
    const header = [...block.matchAll(/class="match__header-title-item">[\s\S]*?class="nav-link__value">([^<]*)</g)].map((x) => decode(x[1]));
    const aside = decode(/match__header-aside-block[^"]*"\s+title="([^"]*)"/.exec(block)?.[1] ?? '');
    const footer = decode(/class="match__footer-list-item">[\s\S]*?class="nav-link__value">([^<]*)</.exec(block)?.[1] ?? '');
    const rows = block.split(/class="match__row(?=[ "])/).slice(1);
    // Seeded players carry their seed after the name ("Amy Lee [1]", "[3/4]"): dropped, so names match badminfo's.
    const teams = rows.map((r) => [...r.matchAll(/data-player-id="[^"]*"[^>]*>\s*<span class="nav-link__value">([^<]*)</g)]
      .map((x) => decode(x[1]).replace(/\s*\[\d+(?:\/\d+)?\]$/, '')));
    const won = rows.findIndex((r) => r.startsWith(' has-won'));
    const result = /class="match__result">([\s\S]*?)<\/div>/.exec(block)?.[1] ?? '';
    const games = [...result.matchAll(/<ul class="points">([\s\S]*?)<\/ul>/g)]
      .map((g) => [...g[1].matchAll(/points__cell[^"]*">\s*(\d+)/g)].map((x) => Number(x[1])))
      .filter((g) => g.length === 2);
    return {
      date,
      time: at,
      draw: header[0] ?? '',
      round: header[1] ?? '',
      court: footer || aside.split('|').slice(1).join('|').trim(),
      duration: Number(/Duration:\s*(\d+)\s*m/i.exec(aside)?.[1]) || null,
      teams: teams.slice(0, 2),
      games,
      winner: won === 0 ? 1 : won === 1 ? 2 : null,
    };
  }).filter((m) => m.teams.length === 2 && m.teams.every((t) => t.length));
}

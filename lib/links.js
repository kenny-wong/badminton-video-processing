// Tournament links the app accepts: badminfo's, or Badminton England's own
// (tournamentsoftware). Only the id is ever used. Tested in tests/links.test.js.

import { badminfoId } from './badminfo.js';

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * { kind: 'badminfo' | 'be', id } for a badminfo tournament link or a BE one such
 * as https://be.tournamentsoftware.com/tournament/<id>/matches or
 * https://be.tournamentsoftware.com/sport/tournament?id=<id>; null otherwise.
 */
export function parseTournamentLink(link) {
  const b = badminfoId(link);
  if (b) return { kind: 'badminfo', id: b };
  if (typeof link !== 'string' || link.length > 300) return null;
  let url;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (!/^(www\.)?be\.tournamentsoftware\.com$/i.test(url.hostname)) return null;
  const inPath = /^\/tournament\/([^/]+)/i.exec(url.pathname)?.[1];
  const id = inPath ?? url.searchParams.get('id') ?? '';
  return GUID.test(id) && GUID.exec(id)[0].length === id.length ? { kind: 'be', id: id.toLowerCase() } : null;
}

export const beTournamentUrl = (id) => `https://be.tournamentsoftware.com/tournament/${id}`;

/**
 * The video id in a YouTube link: youtube.com/watch?v=<id>, youtu.be/<id>,
 * youtube.com/shorts/<id> or /live/<id>, or YouTube Studio's
 * studio.youtube.com/video/<id>/edit; null otherwise.
 */
export function youtubeId(link) {
  if (typeof link !== 'string' || link.length > 300) return null;
  let url;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com') id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|live|embed)\/([^/]+)/.exec(url.pathname)?.[1];
  else if (host === 'studio.youtube.com') id = /^\/video\/([^/]+)/.exec(url.pathname)?.[1];
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

/** The link stored and shown for a YouTube video id. */
export const youtubeUrl = (id) => `https://youtu.be/${id}`;

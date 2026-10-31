// Time formatting shared by the page and the server.

/** 75.4 -> "1:15", 3725 -> "1:02:05" (whole seconds, rounded down). */
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 75.43 -> "1:15.4" */
export function clockTenths(seconds) {
  const s = Math.max(0, seconds);
  return `${clock(s)}.${Math.floor((s * 10) % 10)}`;
}

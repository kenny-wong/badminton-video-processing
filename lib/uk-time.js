// UK wall-clock times (Badminton England's schedule, phones' file names) as
// moments in time. From the badminton project's groups.js.

/** A UK date and time ("2026-10-24", "09:00") as ms since 1970. */
export function londonTime(date, time) {
  const [y, mo, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  // London is UTC+0 or +1; read the offset at that moment and take it off.
  const name = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeZoneName: 'shortOffset' })
    .formatToParts(new Date(guess)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const offset = Number(/GMT([+-]\d+)/.exec(name)?.[1] ?? 0);
  return guess - offset * 3600000;
}

/** The UK date of a moment, "2026-10-24". */
export function londonDate(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/** The UK wall-clock time of a moment, "09:05". */
export function londonClock(ms) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
}

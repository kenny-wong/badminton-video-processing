// Release notes, newest first. Each new version adds its entry at the top
// (tests/releases.test.js checks the first one is package.json's version).
export const RELEASES = [
  { version: '1.100.0', date: '2026-11-26', notes: [
    'Tournaments page: a match filmed in one video that holds two or more games has a Split button beside Open editor, which opens that video straight in Tools → Split a video.',
  ] },
  { version: '1.99.0', date: '2026-11-26', notes: [
    'Tournaments page: choose ★ All favourites to list every tournament any of your starred players is in, once each, with their names and match counts on each card.',
  ] },
  { version: '1.98.1', date: '2026-11-26', notes: [
    'On the Videos page, the list of tournaments without videos shows only your starred players’ tournaments. Find a tournament by name to see the others.',
  ] },
  { version: '1.98.0', date: '2026-11-26', notes: [
    'Games tagged automatically show an Auto-tagged label on the tournament page and in the editor until you check them and press Mark as reviewed. The progress filter has Auto-tagged: to review, to find them.',
  ] },
  { version: '1.97.1', date: '2026-11-25', notes: [
    'The desktop app no longer acts like a browser: F5 and Ctrl+R don’t reload it, F12 doesn’t open developer tools, and Ctrl+click or a middle click opens a page in the same window.',
  ] },
  { version: '1.97.0', date: '2026-11-25', notes: [
    'Correct a result Badminton England has wrong: click Score ≠ on the tournament page, or Correct score in the editor. Your score is used for titles, cards, the score check and the scoreboard, and stays when you press Update results, until Badminton England says the same.',
  ] },
  { version: '1.96.0', date: '2026-11-25', notes: [
    'A tournament’s pages warn when links don’t fit when the videos were recorded: videos whose times and lengths fit another match better, or a match’s games in the wrong order. Videos that fit a match holding the wrong ones are no longer suggested for another match.',
    'A corner view, marked court or shuttle track goes with its video to another match even before any rally is tagged.',
    'A group match’s new game videos show its match number straight away.',
  ] },
  { version: '1.95.0', date: '2026-11-25', notes: [
    'Enrolment planner: each match’s players, event, time and score go with its YouTube links, so the planner can list the videos by tournament and share them with other accounts.',
  ] },
  { version: '1.94.0', date: '2026-11-25', notes: [
    'Videos tab: grouped by tournament. Open a tournament to choose its own video folder; it’s scanned, and each video that surely shows a match or game without a video is linked by itself (with Undo).',
    'A folder on an external drive is found whatever its drive letter: videos and folders are looked for on every drive when the drives change. Links and tagging are kept while it isn’t connected.',
    'A video moved to another folder or drive is recognised by its name and size, and keeps its match and tagging.',
    'Matching goes by how long each video is for the points played, as well as when it was filmed, and by whose matches were filmed (choose under Filmed).',
  ] },
  { version: '1.93.0', date: '2026-11-25', notes: [
    'Settings → Enrolment planner: connect once with a code, and the YouTube links of your matches and games go to the planner’s Strategy matches by themselves.',
  ] },
  { version: '1.92.0', date: '2026-11-23', notes: [
    'Release notes: click the version number beside the app name to see what changed in each version.',
  ] },
  { version: '1.91.0', date: '2026-11-11', notes: [
    'Group matches are numbered in the order they are played (Group match 1, 2, 3) instead of Badminton England’s fixture rounds. Hover a round to see BE’s name for it.',
  ] },
  { version: '1.90.0', date: '2026-11-11', notes: [
    'The development copy looks different from the installed app: a yellow icon, a DEV badge and “(dev)” in the window title.',
  ] },
  { version: '1.89.0', date: '2026-11-06', notes: [
    'YouTube: once a tournament’s last upload is done, its playlist is put into match order.',
  ] },
  { version: '1.88.0', date: '2026-11-05', notes: [
    'Settings → Tracking tools: set up shuttle tracking, Find players and voice removal with one button, on any Windows PC and in the installed app.',
  ] },
  { version: '1.87.0', date: '2026-11-05', notes: [
    'Tournament page: a star for each game as well as each match, and a filter for favourite matches or favourite games.',
  ] },
  { version: '1.86.1', date: '2026-11-05', notes: [
    'Home: the To do list is one compact list with a row per video.',
  ] },
  { version: '1.86.0', date: '2026-11-05', notes: [
    'Tournament page: a video rendered again after uploading shows Re-rendered and offers Upload (re-rendered), which replaces the video on YouTube.',
  ] },
  { version: '1.85.1', date: '2026-11-05', notes: [
    'Corner view: new ones are a tenth of the picture’s width and can be made as small as 5%.',
  ] },
  { version: '1.85.0', date: '2026-11-05', notes: [
    'Editor: a magnifier that follows the mouse, for reviewing only (never rendered). Zoom with its slider or the mouse wheel.',
    'New corner views start at a fifth of the picture’s width.',
  ] },
  { version: '1.84.0', date: '2026-11-05', notes: [
    'Export: a Corner view tick box among the render options, on by default, also for clips.',
  ] },
  { version: '1.83.0', date: '2026-11-05', notes: [
    'Corner view: a button on the control bar; move and resize the window while the video plays; a zoom slider.',
  ] },
  { version: '1.82.0', date: '2026-11-04', notes: [
    'Corner view: choose an area of the picture and play it enlarged in a corner of the video, in the editor and in renders.',
  ] },
  { version: '1.81.0', date: '2026-11-04', notes: [
    'Editor: expand the video with a button or the V key, with the timeline kept right under it.',
  ] },
  { version: '1.80.2', date: '2026-11-03', notes: [
    'Editor: zooming the timeline stays on the time under the mouse, down to 2 seconds, with frames a tenth of a second apart.',
  ] },
  { version: '1.80.1', date: '2026-11-03', notes: [
    'Scoreboard: no serve marker before the first rally is won while who serves first isn’t chosen.',
  ] },
  { version: '1.80.0', date: '2026-11-03', notes: [
    'Share YouTube links: copy the links of the matches the filters show, with each match’s date, players and score, from tournament and player pages.',
  ] },
  { version: '1.79.0', date: '2026-11-02', notes: [
    'Cutting: keep 4 seconds after the rally that reaches the interval and before the next one; set in Settings.',
  ] },
  { version: '1.78.1', date: '2026-11-02', notes: [
    'Editor: once you move away from the selected rally, ↑/↓ and A/B work from the playhead.',
  ] },
  { version: '1.78.0', date: '2026-11-02', notes: [
    'Tournament page: no Render for a video whose tagged score differs from the result (left out of Render all too).',
    'Render all and Upload all show each job’s progress on its own row.',
  ] },
  { version: '1.77.4', date: '2026-11-02', notes: ['Jobs page: a Close button back to the page it was opened from.'] },
  { version: '1.77.3', date: '2026-11-02', notes: ['Editor: Preview on video ticks itself once the first rally is tagged.'] },
  { version: '1.77.2', date: '2026-11-02', notes: ['Tournament page: the try-again time in yellow text.'] },
  { version: '1.77.1', date: '2026-11-02', notes: ['Tournament page: game rows’ Render and Upload line up in one column, with Open editor at the far right.'] },
  { version: '1.77.0', date: '2026-11-02', notes: [
    'YouTube chapters for every rally, with the score and a star on highlighted rallies. The highlights video gets chapters too.',
  ] },
  { version: '1.76.0', date: '2026-11-02', notes: [
    'Tournament page: Upload starts without questions; an upload refused for a limit says when to try again.',
  ] },
  { version: '1.75.3', date: '2026-11-02', notes: ['Tournament page: a failure shows only “Failed”, with the reason in its tooltip.'] },
  { version: '1.75.2', date: '2026-11-02', notes: ['YouTube: the channel’s upload limit is told apart from the daily quota and the rate limit.'] },
  { version: '1.75.1', date: '2026-11-02', notes: ['Tournament page: a failed render or upload shows Failed beside its button.'] },
  { version: '1.75.0', date: '2026-11-02', notes: [
    'Tournament page: Render and Upload in two rows with their progress, both at once; Upload (rendered) or (original) straight from the list.',
  ] },
  { version: '1.74.0', date: '2026-11-02', notes: [
    'Who serves first must be chosen (games 2 and 3 are filled in from the result); until then a video doesn’t count as tagged.',
  ] },
  { version: '1.73.0', date: '2026-11-02', notes: ['Tournament page: Upload all rendered and Upload all original.'] },
  { version: '1.72.2', date: '2026-11-02', notes: ['Tournament page: no Upload button once a video is on YouTube.'] },
  { version: '1.72.1', date: '2026-11-02', notes: ['Tournament page: Upload on every video; Render only once it has a score.'] },
  { version: '1.72.0', date: '2026-11-02', notes: [
    'Tournament page: Render and Upload side by side; upload the original video without rendering it.',
    'Back on a tournament goes to the Tournaments list.',
  ] },
  { version: '1.71.1', date: '2026-11-02', notes: ['Tournament page: video name and length above Open editor and Unlink; a softer Highlights pill.'] },
  { version: '1.71.0', date: '2026-11-02', notes: ['Tournament cards: Tagged games (tagged of filmed), shown in red until done.'] },
  { version: '1.70.3', date: '2026-11-02', notes: ['Tournament page: Open editor beside Unlink; favourite rallies shown as a Highlights pill.'] },
  { version: '1.70.2', date: '2026-11-02', notes: ['Cutting keeps 1.5 seconds before and after each rally by default.'] },
  { version: '1.70.1', date: '2026-11-02', notes: ['Editor: switching games no longer adds Back steps; Back goes to the tournament.'] },
  { version: '1.70.0', date: '2026-11-02', notes: [
    'Editor: Scoring and Rallies in one compact tab, every rally shown, and the editor opens at the top.',
    'A Back button on every page.',
  ] },
  { version: '1.69.1', date: '2026-11-02', notes: ['Tagging: a rally marked with only A / B starts 5 seconds after the last one by default.'] },
  { version: '1.69.0', date: '2026-11-02', notes: ['Settings: the gap before a rally tagged with only A / B can be changed.'] },
  { version: '1.68.0', date: '2026-11-02', notes: [
    'Editor: an HDR phone video plays as bright as its render at the chosen look; thumbnails and timeline frames match.',
  ] },
  { version: '1.67.1', date: '2026-11-02', notes: ['Editor: the match heading stays on screen while scrolling, with a Back button.'] },
  { version: '1.67.0', date: '2026-11-02', notes: [
    'International scoreboard: smooth, steady number slides and a serve shuttle traced from the broadcast.',
    'D-DIN Condensed is the scoreboard’s default font, bundled with the app.',
  ] },
  { version: '1.66.0', date: '2026-11-02', notes: ['Settings: the scoreboard is also shown at its actual size in a 1080p video.'] },
  { version: '1.65.1', date: '2026-11-02', notes: ['Scoreboard: MATCH POINT stays on one line; long names no longer run into the serve shuttle.'] },
  { version: '1.65.0', date: '2026-11-02', notes: [
    'Players’ flags: from badminfo (England by default), blank for players added by hand, chosen on the Players page. Scoreboard flags follow the players.',
  ] },
  { version: '1.64.2', date: '2026-11-02', notes: ['International scoreboard: score slide and serve marker timed to match the broadcast.'] },
  { version: '1.64.1', date: '2026-11-02', notes: ['International scoreboard: earlier games’ scores the same size as the current one.'] },
  { version: '1.64.0', date: '2026-11-02', notes: ['International broadcast scoreboard with country flags and sliding scores.'] },
  { version: '1.63.0', date: '2026-11-02', notes: [
    'Scoreboard numbers flip over when they change; the final score stays up at the end instead of the next game’s 0-0.',
  ] },
  { version: '1.62.0', date: '2026-11-02', notes: ['The near end follows across a match’s game videos: ends change each game.'] },
  { version: '1.61.0', date: '2026-11-02', notes: ['The winner of a game serves first in the next: game videos default to it, and the editor says so.'] },
  { version: '1.60.0', date: '2026-11-02', notes: [
    'Tournament page: clickable totals, Done so far and Next step filters, Render and Upload beside each video.',
    'Coming back from the editor returns to the same place in the list.',
  ] },
  { version: '1.59.0', date: '2026-11-02', notes: ['Tournament page: filmed matches first, each day’s unfilmed matches folded under Not filmed.'] },
  { version: '1.58.0', date: '2026-11-02', notes: ['Tournament page: less clutter on unfilmed matches, simpler win chances, totals with units.'] },
  { version: '1.57.0', date: '2026-11-02', notes: ['Tournament page: short court names with the venue once in the heading; the star beside the time.'] },
  { version: '1.56.0', date: '2026-11-02', notes: ['Tournament page: filmed games always visible with thumbnails; only games without a video are folded.'] },
  { version: '1.55.0', date: '2026-11-02', notes: ['Tournament page: tidier list and grid, with search and progress filters.'] },
  { version: '1.54.0', date: '2026-11-02', notes: [
    'Editor: click the picture to play or pause; no shuttle, players or court lines over a rendered video.',
  ] },
  { version: '1.53.1', date: '2026-11-02', notes: ['Editor: the play button stays right after switching videos, and a chosen video starts playing.'] },
  { version: '1.53.0', date: '2026-11-02', notes: ['The render button stops a render while it waits or runs.'] },
  { version: '1.52.1', date: '2026-11-02', notes: ['The editor shows a render, tracking or player search still running when you come back to it.'] },
  { version: '1.52.0', date: '2026-11-02', notes: ['The end card’s longest rally and best run line is on by default.'] },
  { version: '1.51.0', date: '2026-11-02', notes: ['Title and end cards are on by default.'] },
  { version: '1.50.0', date: '2026-11-02', notes: [
    'Replace on YouTube: upload the new render, give it the old video’s place in the playlist, then delete the old video.',
  ] },
  { version: '1.49.0', date: '2026-11-02', notes: ['HDR phone videos render at a chosen brightness (Normal by default, darker than before).'] },
  { version: '1.48.0', date: '2026-11-02', notes: ['A match filmed game by game links to the tournament’s YouTube playlist once a game is uploaded.'] },
  { version: '1.47.0', date: '2026-11-02', notes: ['YouTube titles name each player in full.'] },
  { version: '1.46.0', date: '2026-11-02', notes: [
    'Stats: the longest and most-shots rallies play when clicked; landing map dots play their rally.',
  ] },
  { version: '1.45.0', date: '2026-11-02', notes: ['Favourite rallies while tagging: Shift+A / Shift+B tags the winner and stars the rally at once.'] },
  { version: '1.44.0', date: '2026-11-02', notes: ['Editor: Preview on video draws the scoreboard over the original video.'] },
  { version: '1.43.2', date: '2026-11-02', notes: ['Editor: the next-untagged-rally key is removed.'] },
  { version: '1.43.1', date: '2026-11-02', notes: ['Editor: the “this video is this game only” note is gone.'] },
  { version: '1.43.0', date: '2026-11-02', notes: [
    'Editor: Find rallies by sound and winner suggestions removed; Clear all rallies added; the shuttle can be shown on every tab.',
  ] },
  { version: '1.42.0', date: '2026-11-02', notes: ['Players can be dragged into your own order, also used on the Tournaments page.'] },
  { version: '1.41.2', date: '2026-11-02', notes: [
    'Update their results stops re-reading finished tournaments; find a tournament by name.',
  ] },
  { version: '1.41.1', date: '2026-11-02', notes: ['Find a player: Add puts a player on the list without a star.'] },
  { version: '1.41.0', date: '2026-11-02', notes: [
    'Player page: matches grouped by year, tournament and event, with filters.',
    'Favourite matches with a star.',
    'Refresh from folders drops videos that are gone.',
  ] },
  { version: '1.40.0', date: '2026-11-02', notes: ['Open buttons per game; Update their results skips finished, complete tournaments.'] },
  { version: '1.39.0', date: '2026-11-02', notes: [
    'Tournament page: winners in green, losers in red, your players in gold, a win chance column and progress labels.',
  ] },
  { version: '1.38.0', date: '2026-11-02', notes: ['The shuttle dot shows only the shuttle in play over the court.'] },
  { version: '1.37.0', date: '2026-11-02', notes: ['A comment for each video’s YouTube description; players’ names no longer jump to the umpire.'] },
  { version: '1.36.0', date: '2026-11-02', notes: ['Find players in the video and show them with their names.'] },
  { version: '1.35.0', date: '2026-11-02', notes: ['Suggest winners from the official result.'] },
  { version: '1.34.0', date: '2026-11-02', notes: ['Court marking names the corner to click; marked corners can be dragged.'] },
  { version: '1.33.0', date: '2026-11-02', notes: ['One video per match or game, no joining; Unlink all.'] },
  { version: '1.32.0', date: '2026-11-02', notes: ['A merged video takes the first video’s name when the originals are removed.'] },
  { version: '1.31.0', date: '2026-11-02', notes: ['Refresh from folders on the Videos and Tools tabs.'] },
  { version: '1.30.0', date: '2026-11-02', notes: ['Tools: the original videos go to the Recycle Bin after a merge or split.'] },
  { version: '1.29.1', date: '2026-11-02', notes: ['Merged and split files keep the original’s file details and created time.'] },
  { version: '1.29.0', date: '2026-11-02', notes: ['Tools tab: merge videos and split a video into parts without losing quality.'] },
  { version: '1.28.5', date: '2026-11-01', notes: ['MIT licence.'] },
  { version: '1.28.4', date: '2026-11-01', notes: ['One home banner.'] },
  { version: '1.28.3', date: '2026-11-01', notes: ['Home banner and illustrations included with the source.'] },
  { version: '1.28.2', date: '2026-11-01', notes: ['The installer includes the home banner and illustrations.'] },
  { version: '1.28.1', date: '2026-11-01', notes: ['Installer and window icon drawn from the app’s shuttle mark.'] },
  { version: '1.28.0', date: '2026-11-01', notes: ['Desktop app with a Windows installer that brings its own FFmpeg.'] },
  { version: '1.27.0', date: '2026-11-01', notes: ['Mark a tournament complete; tournament cards grouped by year.'] },
  { version: '1.26.0', date: '2026-11-01', notes: [
    'Tournament cards show each player’s progress (matches, filmed, rendered, YouTube); unfinished ones are highlighted.',
  ] },
  { version: '1.25.0', date: '2026-11-01', notes: ['Import every badminfo tournament of a player, skipping ones already in the app.'] },
  { version: '1.24.1', date: '2026-11-01', notes: ['Ticking a custom tournament’s players saves in place.'] },
  { version: '1.24.0', date: '2026-11-01', notes: [
    'Custom tournaments made by hand, a Players list that keeps unstarred players, tournaments grouped by player.',
  ] },
  { version: '1.23.0', date: '2026-11-01', notes: ['Favourite players; a new app mark, icons and home banner.'] },
  { version: '1.22.0', date: '2026-11-01', notes: [
    'Delete rendered files; folding Scoreboard and Clip cards; a seek bar for cut renders.',
  ] },
  { version: '1.21.0', date: '2026-11-01', notes: ['Play rendered files in the editor and choose which one to upload.'] },
  { version: '1.20.6', date: '2026-11-01', notes: ['YouTube box: clearer Upload by hand fold.'] },
  { version: '1.20.5', date: '2026-11-01', notes: ['YouTube and Google pages open in your normal browser.'] },
  { version: '1.20.4', date: '2026-11-01', notes: ['Title and description in the YouTube box.'] },
  { version: '1.20.3', date: '2026-10-31', notes: ['The year in front of tournament playlist names.'] },
  { version: '1.20.2', date: '2026-10-31', notes: ['Shows the playlist an upload will go into.'] },
  { version: '1.20.1', date: '2026-10-31', notes: ['Tooltips in the YouTube box.'] },
  { version: '1.20.0', date: '2026-10-31', notes: ['Upload to YouTube from the app, with tournament playlists.'] },
  { version: '1.19.0', date: '2026-10-31', notes: ['Upload to YouTube helper: copies the title, opens YouTube’s upload page and shows the file.'] },
  { version: '1.18.0', date: '2026-10-31', notes: ['Remove voices from the sound when rendering.'] },
  { version: '1.17.0', date: '2026-10-31', notes: ['Broadcast-style scoreboard as the default look.'] },
  { version: '1.16.5', date: '2026-10-31', notes: ['Restart the server from the page (check).'] },
  { version: '1.16.4', date: '2026-10-31', notes: ['Restart the server from the version bar.'] },
  { version: '1.16.3', date: '2026-10-31', notes: ['Plainer version mismatch message.'] },
  { version: '1.16.2', date: '2026-10-31', notes: ['Server version check (check).'] },
  { version: '1.16.1', date: '2026-10-31', notes: ['The page says when to reload or restart after an update.'] },
  { version: '1.16.0', date: '2026-10-31', notes: [
    'Match statistics: serve and receive, runs, leads, comebacks, rally lengths and shots, a momentum chart and where rallies ended.',
  ] },
  { version: '1.15.0', date: '2026-10-31', notes: ['Highlight reels across matches and one-rally clips, also upright following the shuttle.'] },
  { version: '1.14.0', date: '2026-10-31', notes: ['Video size and bitrate choices, slow-motion replays of favourite rallies, music under highlights.'] },
  { version: '1.13.0', date: '2026-10-31', notes: [
    'Home search and to-do lists, a Jobs page, Render all tagged, a zoomable timeline with frames and sound, keyboard help, light and dark theme, drag and drop linking.',
  ] },
  { version: '1.12.0', date: '2026-10-31', notes: ['Players from badminfo: ratings, grades, win chances and upsets; player pages with rating history.'] },
  { version: '1.11.0', date: '2026-10-31', notes: ['Your logo in a corner of rendered videos; title and end cards.'] },
  { version: '1.10.0', date: '2026-10-31', notes: ['Scoreboard looks: presets, colours, font, size, corner, game point flags and banners, with a preview.'] },
  { version: '1.9.1', date: '2026-10-31', notes: ['The editor opens even when a match has no game list.'] },
  { version: '1.9.0', date: '2026-10-31', notes: ['Editor: switch between a match’s game videos; court lines only on the Tracking tab.'] },
  { version: '1.8.3', date: '2026-10-31', notes: ['The higher score of each game in bold.'] },
  { version: '1.8.2', date: '2026-10-31', notes: ['Made-up example names.'] },
  { version: '1.8.0', date: '2026-10-31', notes: ['App log and error details, with the log of each job.'] },
  { version: '1.7.0', date: '2026-10-31', notes: ['Scoreboard name styles for singles and doubles.'] },
  { version: '1.6.0', date: '2026-10-31', notes: ['New look: icons, page headings, editor tabs and a TV-style scorecard.'] },
  { version: '1.5.0', date: '2026-10-31', notes: ['Shuttle tracking on the graphics card.'] },
  { version: '1.4.0', date: '2026-10-31', notes: ['A match can be filmed game by game.'] },
  { version: '1.3.0', date: '2026-10-31', notes: ['Tagging follows the video when it is linked to another match.'] },
  { version: '1.2.0', date: '2026-10-31', notes: ['Favourite rallies and a highlights video; tournament list and grid views.'] },
  { version: '1.1.0', date: '2026-10-31', notes: ['YouTube links, match start and end, a starting score and more playback speeds.'] },
  { version: '1.0.0', date: '2026-10-31', notes: [
    'First version: import tournaments, link videos to matches by recording time, tag rallies, burn in a scoreboard and cut the gaps.',
  ] },
];

const KINDS = { major: 'Major', minor: 'New', patch: 'Fix' };

// 'major' for x.0.0, 'minor' for 1.x.0, 'patch' for 1.0.x.
export function releaseKind(version) {
  const [, minor, patch] = String(version).split('.').map(Number);
  return patch ? 'patch' : minor ? 'minor' : 'major';
}
export const kindLabel = (version) => KINDS[releaseKind(version)];

// Releases matching every word of the search, in a note or the version.
export function findReleases(releases, text) {
  const words = String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return releases;
  return releases.filter((r) => {
    const hay = `${r.version} ${r.notes.join(' ')}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// Releases grouped by month, newest first: [{ month: 'November 2026', releases }].
export function byMonth(releases) {
  const groups = [];
  for (const r of releases) {
    const month = new Date(`${r.date}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const last = groups.at(-1);
    if (last?.month === month) last.releases.push(r);
    else groups.push({ month, releases: [r] });
  }
  return groups;
}

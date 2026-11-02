# Badminton Video

A Windows desktop app for phone videos of badminton matches. It:

- imports a tournament from **badminfo** or **Badminton England** (tournamentsoftware): every match with its time, court, players and result;
- finds your videos and **links each one to its match** by when it was recorded (one video per match, or one per game when games were filmed separately);
- lets you **tag rallies** from the keyboard, or **finds them by the sound of shuttle hits** so you only say who won each one;
- keeps the score by the rules (21 / 15 / 11 points, setting, best of 3 or one game) and checks it against the official result;
- **renders** the match with a **scoreboard** burned in and the **gaps between rallies cut out**, using the NVIDIA encoder when there is one;
- names the result for **YouTube**: title, description with chapters, and a folder per year and tournament.

Everything runs on your PC. Video files are never moved or changed.

## Installing

Run `Badminton-Video-Setup-<version>.exe`. It installs for your Windows account only (no administrator needed), adds Start-menu and desktop shortcuts, and brings its own copy of FFmpeg. The installer isn't code-signed yet, so Windows may say "Windows protected your PC": choose **More info → Run anyway**.

The installed app keeps everything (database, logs, thumbnails, YouTube sign-in) in `%LOCALAPPDATA%\Badminton Video`; uninstalling leaves that folder alone. Rendered videos go to the folder chosen in Settings (default `Videos\Badminton`). An NVIDIA GPU is optional; without one, rendering uses the CPU (slower). Shuttle tracking and voice removal need the Python set-up below and aren't part of the installer yet.

## Building and developing

Needs Windows 10/11, [Node.js](https://nodejs.org/) 24 or later and FFmpeg (`winget install Gyan.FFmpeg`; found automatically, or set its folder in Settings). The app itself uses no npm packages; Electron and electron-builder are development tools only (`npm install`).

```
npm start      # the app on http://127.0.0.1:8791 in a Chrome app window, data in data/
npm run dev    # the same without opening Chrome, restarting when files change
npm run app    # the desktop (Electron) version, port 8793, data in %LOCALAPPDATA%\Badminton Video (development)
npm run dist   # builds dist\Badminton-Video-Setup-<version>.exe, with this PC's FFmpeg copied in and the icon drawn from public/visual-kit/app-mark.svg
npm test       # unit tests (Node's built-in test runner)
```

The desktop version (`electron/main.js`) runs the same server inside Electron's own process on port 8792, in its own window; web links open in the default browser. `BADMINTON_VIDEO_DATA` points it at another data folder.

## Using it

The **International broadcast** scoreboard look adds shaped country flags, compact white name rows, shaded brown score tiles and sliding score changes. Choose it in **Settings → Scoreboard look**, or for one match in **Export → Scoreboard**. Choose Team A and Team B countries there too; flags are optional and appear in both the preview and rendered videos.

1. **Settings**: add the folders you copy phone videos into (and on the **Players** page, add and star your players to pick out their matches). In Settings you can also choose how names appear on the scoreboard, separately for singles and doubles (CHAN, THAI, T. CHAN or THAI CHAN). The scoreboard's look (by default a broadcast-style board: white rows, narrow lettering, the current game in orange and a shuttle by the server; or another preset or your own colours, font, opacity, size, corner, a heading line, the scores of finished games, GAME POINT / MATCH POINT flags and interval or game banners) is set there too, with a preview over a frame of your video and the board again at its actual size in a 1080p video. The broadcast looks are lettered in D-DIN Condensed, a free DIN condensed like the broadcasts' own, which comes with the app (FFmpeg gets a copy for each render); on the International look a point plays as on TV: the old number slides out of its tile, the new one slides in, and the serve shuttle hops to the other row. As on TV, a number that changes flips over, and once the match (or a game's own video) is over the board keeps the final score up rather than starting the next game at 0–0; each match can pick its own preset and corner on the editor's Export tab. A logo (PNG or JPEG) can go in a corner of every video, and a title card (players, event, date) and an end card (who won, the score) can be added before the first rally and after the last. Videos can be made smaller (1080p or 720p, with a bitrate cap), each ★ rally can get a slow-motion replay of its last 3 seconds straight after it, and a music track (MP3, M4A or WAV) can go under highlights, reels or every video, with the court's sound turned down. **Highlight reel** (on a tournament page, for everyone or one of your players, or on a player's page for all their filmed matches) joins the ★ rallies of many matches into one video, each with a short card and its own scoreboard. The editor's Export tab also makes a **clip of one rally**, as filmed or upright 9:16 for Shorts and Reels; upright clips follow the shuttle once it has been tracked.
2. **Import** a tournament with its badminfo or Badminton England link, or **make your own** (a club night, a friendly, anything not on those sites) by giving it a name. On a custom tournament's page you edit its name, dates, venue and scoring (best of 3 or one game, to 21, 15 or 11), tick which players from the Players list are in it, and add, edit or delete its matches (date, time on court, event, round, court, one or two players a side, the result). Its matches link to videos, get tagged and rendered like imported ones; the time on court is what the video suggestions go by.
3. **Scan video folders**. Each video's recording time comes from the iPhone's clock, the phone's file name (`20261024_091233.mp4`, `VID_…`, `PXL_…`), the video's own timestamp, or as a last resort the file date.
4. On the tournament page, **link** the suggested videos (or choose one per match). A match or game takes one video: one video of the whole match goes to the match, and when the games were filmed separately (back-to-back videos around the match's time) each video is suggested for its own game, which then has its own tagging, render and YouTube link, grouped under the match (**Link both** / **Link all 3** links them together). Videos are never joined. Linked the wrong match? Unlink it: that match is cleared, and the video's tagging goes with it to the next match you link it to. **Unlink all** (top of the page) unlinks every video of the tournament the same way. Winners show in green with a tick and losers in red, game by game; your starred players have a gold ★ mark and their matches a gold edge; **Win chance** is badminfo's chance before the match for each side; courts are shortened ("Court 3", the venue named once at the top). Each day lists its filmed matches first, each filmed game with its thumbnail, progress (rallies, the tagged score against the result, rendered, YouTube) and next step (**Render**, or **Upload**, which opens its YouTube box); the matches not filmed fold under **Not filmed**, which opens by itself while you search. The totals at the top count the whole tournament (matches, then videos: a match filmed game by game has one per game); click a video total to see those matches. The progress filter picks either what's done so far (filmed, tagged, rendered, on YouTube, each including videos that went further) or the next step (needs a video, tagging, ready to render, ready for YouTube, or any of them). Switch between a list and a grid; your players' matches show by default, and coming back from the editor returns you to the match you opened.
5. **Open** a match. Press **S** when a rally starts and **A** or **B** when it ends (pressing A or B without S assumes the rally began 3 seconds after the last one). **N** goes to the next rally without a winner, and **Clear all rallies** (Rallies tab) starts again (Ctrl+Z undoes it). The score and the check against the official result update as you go.
   - Press **M** where the match starts and **F** where it finishes; anything outside is left out.
   - If the video starts mid-match, set the game and score it starts at under *Video starts at*.
   - Playback runs from 0.25× to 16× (`[` and `]`); Chrome mutes the sound above 4×.
   - The score after each tagged rally shows in small type under the timeline. Press **H** (or ☆ in the list) to mark a favourite rally; *Highlights only* renders just those to a separate file.
6. **Render**. The finished video and a `.txt` with its YouTube title and description go into the output folder. Signed in to YouTube (see [YouTube upload](#youtube-upload)), **Upload to YouTube** in the editor's YouTube box uploads it, adds it to the tournament's playlist and marks the match as uploaded. Otherwise the same button copies the title, opens YouTube's upload page and shows the file in Explorer to drag across; upload it as *Unlisted* to share by link, then paste the link into the match's YouTube box: the match shows as *on YouTube* in the tournament list.

## Getting around

- The home page has a compact court banner. A shuttle-and-play app mark, badminton-specific icons, and illustrated setup and empty libraries follow the app's light or dark theme.
- The home page has a **search** across every imported match (player, tournament or event; narrow it to matches with a video, tagged or on YouTube) and a **To do** list of filmed matches still to tag, to render or to upload, plus videos not linked to anything.
- **Jobs** (in the header while anything runs) lists the background work. Renders and shuttle tracking take turns on the graphics card: start several and they queue. **Render all tagged** on a tournament page queues every filmed match whose rallies all have a winner and that has no video yet.
- In the editor, the switch next to the speed plays the original or any rendered file (whole match, highlights, clips). A render as long as the original keeps the rally timeline and scores; a cut one, highlights or a clip plays on its own, with a plain seek bar and 2 s / 10 s jumps, and tagging keys off until you choose Original again. The bin next to the switch deletes the rendered file being played (never the original), and the match forgets it. On the Export tab, Scoreboard and Clip of one rally fold away and remember whether they were open.
- **Refresh from folders** on the Videos and Tools tabs looks in your video folders again (as **Scan folders** on the home page does): new and changed videos are added, and videos no longer in their folders are taken off the list (unless one is linked to a match or carries tagging, or its folder or drive can't be reached right now: those stay, marked *missing*).
- On a tournament page, drag an unlinked video's chip, or the video file itself from Explorer, onto its match (or game) to link it.
- The editor's timeline zooms with the mouse wheel or + / − (0 shows the whole video; Shift+wheel moves along), with a strip of frames above it and the sound level below it, where shuttle hits show as spikes and missed rallies stand out.
- The header shows this window's version; hovering it shows the server's. When they differ (after an update) a bar says the server version doesn't match and the server needs restarting, with a **Restart server** button (it asks first if jobs are running; they would stop) (or, if the server is the newer one, that the window needs reloading).
- In the editor, **?** shows every keyboard shortcut. The header's theme button switches between light, dark and Windows' own setting.

## Merging and splitting videos

The **Tools** tab joins phone videos end to end or cuts one into parts, without re-encoding: the picture and sound are copied as they are, and the originals are never edited. The new files go next to the original and straight into the library.

- **Merge videos**: add videos from the library, put them in order (drag, or ↑ ↓; **Sort by recording time** puts them back in filming order) and merge. They must have the same kind of picture and sound. The result carries the first video's details and start time and the last one's end time, and every frame of every video is checked to be in it. It is named `<first video's name> merged.mp4`, or, when the originals are removed, just the first video's name (its time is still when the merged video starts). Merged videos are marked **merged** in the Videos and Tools lists.
- **Split a video**: choose a video (or **Split** on the Videos page), play or scrub it and mark up to three parts: **1 / 2 / 3** chooses the part, **I** / **O** set where it starts and ends (or type the times), Space plays, ← / → move 2 s (Shift: 10 s), , / . one frame, and the mouse wheel over the picture or the bar moves 1 s a notch (Shift: one frame). A lossless cut can only start on a key frame (phones write one about every second), so each part starts at the last one before your start; the page shows where. Each part is named and timed from where it starts: `20261101_121214.mp4` cut 95 s in becomes `20261101_121349 part 2.mp4`.
- Timestamps: the file's created, modified and accessed times and the video's own creation time each mark the start or the end of recording in the original (Samsung phones stamp the end), and keep marking it in the new file. The phone's own metadata (camera model, lens, location, recording mode, iPhone creation date) and its file-type header (brands and version) are copied over byte for byte.
- **Remove the original videos** (ticked by default) moves the originals to the Recycle Bin once the new files are made, so they can still be restored from there. A split's original goes with everything outside the parts. The originals are kept if anything went wrong (a track that couldn't be copied, frame counts that don't add up, metadata that couldn't be carried over), or if one is linked to a match: unlink it there first.

## Statistics

The editor's **Stats** tab works out, from the tagged rallies: points won on each side's serve and on receive, the longest run of points, average and longest rallies (and shots per rally, counted from the hit sounds), and for each game its length, biggest leads, best runs and comebacks. A momentum chart shows who led after every rally, game by game, and can be saved as a picture. Once the court is marked and the shuttle tracked, a court map shows where each rally ended. Settings can add the longest rally and best run to the end card, and a banner after rallies of many shots.

## Players

The **Players** page holds your list of players: add one by name only, or by their badminfo player link (the app then reads their ratings and matches). Star (★) the ones you film: favourites' matches are picked out on tournament pages and get the video suggestions, and the Tournaments page groups tournaments under each favourite (a tournament with two of them shows under both; the rest come last). Each card shows progress for its player (or all your favourites): their matches out of all, filmed matches (every game has a video, one for the match or one per game), filmed games, rendered videos out of linked ones, and YouTube uploads out of renders. A section with something left to do is yellow, and a card with any is outlined red. **Mark complete** (on the card or the tournament's page) stops the highlighting when nothing more will be filmed there; **Reopen** brings it back. Cards are grouped by year, newest first; **Find a tournament by name** (beside the player choice) narrows the list to tournaments whose name has every word typed. **Find a player** searches everyone in imported badminfo tournaments: ☆ stars one, **Add** puts them on the list without a star. Drag a card by its ⠿ grip (or focus the grip and press the arrow keys) to put the players in your own order, within Favourites or Other players; the Tournaments page groups and its player choice follow that order. Unstarring keeps a player on the list, under *Other players*, for custom tournaments or to star again; **Remove** takes them off.

For a player with a badminfo link, **Import tournaments** (on their card or page) brings in every tournament they have entered on badminfo, upcoming ones too, skipping any already in the app (also those first imported from a Badminton England link), so nothing is doubled. Tournaments badminfo lists without a Badminton England page (leagues) are reported and left out. **Update their results** reads their imported tournaments again, except finished ones that are already up to date, to save fetching the same pages: ones with every result, events with no matches at all (such as camps) read since they ended, and ones read again at least 3 days after they ended (a match still without a result by then was never played, a walkover say, and never gets one). The Open buttons on a player's page (and in the home page search) open each game's video when a match was filmed game by game; a single tournament has **Update results** on its page, for new draws, times and results as an upcoming one is played. Your tagging stays.

Tournaments imported from a badminfo link also bring everyone entered, with their badminfo grades and ratings. Each badminfo player has a page with their rating over time and every match of theirs in imported tournaments, grouped by year, tournament and event (WS, WD, XD, …, read from the draw name however the tournament wrote it). Their latest tournament is open and the rest folded; filters pick by year, event, result (won, lost, no result), video (filmed, not filmed, rendered, on YouTube), ★ favourites only and any words (opponent, partner, tournament), and are remembered. The ☆ beside a match marks it a favourite match: the same star is on the tournament page (list and grid) and in the editor's heading, and starring a game stars its whole match. Tournament pages show each player's rating for the event, badminfo's win chance for matches it has rated, and upsets (the side with under a 35% chance won). The editor's Players tab adds earlier meetings between the same players and the opponents' other filmed matches. Settings choose whether the YouTube description adds the players' badminfo pages and the win chance, and whether an upset goes in the title.

## Shuttle tracking

Optional. [TrackNetV3](https://github.com/qaz812345/TrackNetV3) (MIT licence) follows the shuttle on an NVIDIA GPU. Set it up once with
`powershell -ExecutionPolicy Bypass -File analysis\setup.ps1` (Python 3.10+ and Git needed; about 3 GB of downloads, kept out of the repo in `analysis\`).

In a match: **Mark the court** (click its four outer corners; a tip on the video names the corner to click next and shows it on a small court, and the name follows the pointer; Esc stops). Afterwards drag any yellow corner to move it, with the court lines following, or nudge a focused corner with the arrow keys. Then choose who is at the near end when the video starts and **Track the shuttle**. **Show the shuttle on the video** (ticked unless you untick it, remembered on this PC) draws it on every tab, not only Tracking. The red dot shows only the shuttle in play over the court: sightings beside the court (when the camera is far enough back for there to be any), sightings that stay put for half a second (the shuttle on the floor, or a light mistaken for it) and stray ones off the shuttle's path are hidden. The tracked data keeps them all, for the landing map and clips. The tracked shuttle drives upright clips and the landing map. Works best with the phone behind a baseline, high up, with the whole court in view. Winners are tagged by hand: finding rallies by sound and suggesting winners (from the shuttle or the official result) were tried and taken out, as on real footage they weren't reliable enough to save time.

### Comment for YouTube

The **Comment** box on the editor's Export tab keeps a note on the match (or on one game of it). It goes at the end of the YouTube description of that match's videos: the whole video, the highlights and the rally clips, including ones rendered before the comment was written, and the YouTube box shows the description with it. It's saved as you type, up to 2,000 characters; if the description and the comment are too long for YouTube together, the description gives way, never the comment.

Tracking takes about 1½ minutes per minute of video on an RTX 3090 (a 6-minute game: 9 minutes). `analysis\run_tracknet.py` runs TrackNetV3 with a faster frame reader that gives it exactly the same input; `analysis\check_tracknet_reader.py <TrackNetV3 folder> <video>` checks that. Each run's full output is in `tracking.log` in the match's work folder (`<output>\.work\match-<id>\track\`).

## Players on the video

**Find players** (Tracking tab) runs [Ultralytics YOLO11](https://github.com/ultralytics/ultralytics) pose with its ByteTrack tracker over the whole video on the GPU (about 3½ minutes for an 8-minute game), so each person is followed from frame to frame. It's installed by `analysis\setup.ps1` along with the shuttle tracker; Ultralytics is AGPL-3.0 and is only installed locally, never part of the app or the installer.

**Show players and their names** then draws a box on each player, with their name in their team's colour, on every tab while the video plays. The players are the people whose feet are on the marked court (at most a team's worth per end) and who are usually on it, so an umpire or coach by the court is never named; a name stays on its person, and when a player isn't seen, no one else takes their name; their team comes from who was at the near end when the video started and the score, as ends change after each game and at the deciding game's mid-point. In singles that gives each name; doubles partners are told apart by shirt colour, and **Swap A's names** / **Swap B's names** puts a pair the other way round if they come out wrong. Until the court is marked, everyone found is boxed without names.

## Removing voices

Optional. [Demucs](https://github.com/facebookresearch/demucs) (MIT licence) takes players' shouts, coaching and talk by the court out of the sound and keeps everything else, shuttle hits included. `analysis\setup.ps1` installs it with the shuttle tracker (run it again if you set tracking up before this was added). Switch it on in Settings → Video size, or per render in the editor's Export tab; reels and clips follow Settings and the Export tab's box.

Only the vocals model of Demucs' fine-tuned set runs, and the result is the original sound minus the voices, so nothing else is changed. The first render of a match works out its voice-free sound (about 15 seconds for a 6-minute video on an RTX 3090) and keeps it as `court.flac` in the match's work folder (`<output>\.work\match-<id>\voices\`); later renders reuse it until the video file changes. Loud shouts go; very quiet distant talk may partly stay.

## YouTube upload

Optional, for uploading straight from the app with the YouTube Data API:

1. In [Google Cloud](https://console.cloud.google.com), make a project, turn on **YouTube Data API v3**, set up the OAuth consent screen (External, Testing, with your Google account as a test user) and create an OAuth client of type **Desktop app**.
2. Download the client's JSON and save it as `data\youtube\client.json` (the `data` folder is never committed).
3. In the editor's YouTube box, **Sign in to YouTube**. Google says the app isn't verified: that's expected for your own project; continue. The sign-in is kept in `data\youtube\token.json`; **Sign out** forgets it.

Pick which finished file to upload: the whole match, the ★ highlights or a rally clip (newest first); the match keeps the link of its latest upload. Uploads are resumable (16 MB pieces; a dropped connection carries on from what YouTube has), one at a time, and show on the Jobs page. Choose Unlisted, Private or Public, and whether to add the video to the tournament's playlist (made the first time, remembered in `data\youtube\playlists.json`). The title and description are the ones in the render's `.txt`; the category is Sports and the recording date is the match's.

While the consent screen is in Testing, Google ends the sign-in after 7 days, so sign in again then. Google's documentation disagrees about whether a project that hasn't passed its [API audit](https://support.google.com/youtube/contact/yt_api_form) has its uploads locked as Private: after each upload the app asks YouTube and says so if it was locked (such videos stay private even after an audit, so upload those by hand).

## Logs

The server writes `logs\app.log` in its data folder (`data\` for `npm start`): starts and stops, and when each background job started, finished or failed, with the full error. When something fails, the red box's **Details** shows the longer story, the job's log (**Show log**), and buttons to open the log file and copy the details. Closing or restarting the server stops any job that is running.

## How it works

- `server.js`: a small Node HTTP server bound to 127.0.0.1 only. It serves `public/`, the JSON API in `api/` and match videos with byte ranges. Writes are accepted only from the app's own origin.
- `lib/`: server logic. `badminfo.js` and `schedule.js` read the tournament sources. `media.js` reads recording times, `matching.js` suggests links, `hits.js` and `analyse.js` read the sound for the editor's sound strip and shot counts, `overlay.js` writes the ASS scoreboard (laid out by `public/shared/board.js`, which the Settings preview also draws), `render.js` plans cuts, chapters and FFmpeg commands, `pipeline.js` runs them, and `db.js` holds the SQLite database (`node:sqlite`) with `migrations/`.
- `public/`: the page (plain HTML, CSS and ES modules). `public/shared/` holds the scoring rules and name helpers, used by both the page and the server.
- Rendering cuts each kept part with the scoreboard drawn by FFmpeg's `ass` filter, several parts at once, then joins them without re-encoding. HDR phone footage is tone-mapped to standard video at the brightness chosen in Settings (Bright, Normal or Darker, each previewed on a frame of your newest HDR video), and every output is tagged as BT.709 so YouTube shows its colours as intended.
- Merging and splitting (`lib/video-tools.js`) copy streams with FFmpeg, then `lib/mp4.js` puts the original's `moov/udta` and `moov/meta` boxes back in place of FFmpeg's (safe because FFmpeg writes `moov` after the media), and `lib/filetimes.js` sets the file times (the created time through PowerShell). Names, parts and time shifts are in `public/shared/video-files.js`.

## Not yet

- Shuttle tracking and voice removal in the installer (they need Python and an NVIDIA GPU; for now only from a checkout with `analysis\setup.ps1`).
- Automatic updates and a code-signed installer.

## Licence

MIT: see [LICENSE](LICENSE). The installer also brings FFmpeg, which has its own licence (GPL v3, included under `resources\ffmpeg` in the install folder). The scoreboard's lettering, D-DIN Condensed (© 2017 Datto Inc.), is a free font under the SIL Open Font License 1.1; it comes unchanged in `public/fonts` with its licence ([OFL-D-DIN.txt](public/fonts/OFL-D-DIN.txt)).

# Badminton Video

A Windows desktop app for phone videos of badminton matches. It:

- imports a tournament from **badminfo** or **Badminton England** (tournamentsoftware): every match with its time, court, players and result;
- finds your videos and **links each one to its match** by when it was recorded (several videos of one match are joined);
- lets you **tag rallies** from the keyboard, or **finds them by the sound of shuttle hits** so you only say who won each one;
- keeps the score by the rules (21 / 15 / 11 points, setting, best of 3 or one game) and checks it against the official result;
- **renders** the match with a **scoreboard** burned in and the **gaps between rallies cut out**, using the NVIDIA encoder when there is one;
- names the result for **YouTube**: title, description with chapters, and a folder per year and tournament.

Everything runs on your PC. Video files are never moved or changed.

## Requirements

- Windows 10/11, [Node.js](https://nodejs.org/) 24 or later, Google Chrome
- FFmpeg: `winget install Gyan.FFmpeg` (found automatically, or set its folder in Settings)
- An NVIDIA GPU is optional; without one, rendering uses the CPU (slower)

No npm packages are needed.

## Running

```
npm start      # starts the app on http://127.0.0.1:8791 and opens it in a Chrome app window
npm run dev    # the same without opening Chrome, restarting when files change
npm test       # unit tests (Node's built-in test runner)
```

Data (the SQLite database) lives in `data/`; rendered videos go to the folder chosen in Settings (default `Videos\Badminton`).

## Using it

1. **Settings**: add the folders you copy phone videos into, and your players' names (to pick out their matches). You can also choose how names appear on the scoreboard, separately for singles and doubles (CHAN, THAI, T. CHAN or THAI CHAN). The scoreboard's look (by default a broadcast-style board: white rows, narrow lettering, the current game in orange and a shuttle by the server; or another preset or your own colours, font, opacity, size, corner, a heading line, the scores of finished games, GAME POINT / MATCH POINT flags and interval or game banners) is set there too, with a preview; each match can pick its own preset and corner on the editor's Export tab. A logo (PNG or JPEG) can go in a corner of every video, and a title card (players, event, date) and an end card (who won, the score) can be added before the first rally and after the last. Videos can be made smaller (1080p or 720p, with a bitrate cap), each ★ rally can get a slow-motion replay of its last 3 seconds straight after it, and a music track (MP3, M4A or WAV) can go under highlights, reels or every video, with the court's sound turned down. **Highlight reel** (on a tournament page, for everyone or one of your players, or on a player's page for all their filmed matches) joins the ★ rallies of many matches into one video, each with a short card and its own scoreboard. The editor's Export tab also makes a **clip of one rally**, as filmed or upright 9:16 for Shorts and Reels; upright clips follow the shuttle once it has been tracked.
2. **Import** a tournament with its badminfo or Badminton England link.
3. **Scan video folders**. Each video's recording time comes from the iPhone's clock, the phone's file name (`20261024_091233.mp4`, `VID_…`, `PXL_…`), the video's own timestamp, or as a last resort the file date.
4. On the tournament page, **link** the suggested videos (or choose one per match). A match with several games can also be linked **game by game**: each game then has its own video, tagging, render and YouTube link, grouped under the match. Linked the wrong match? Unlink it: that match is cleared, and the video's tagging goes with it to the next match you link it to. Switch between a list and a grid of video thumbnails; your players' matches show by default, and *Hide matches without a video* narrows it further.
5. **Open** a match. Press **S** when a rally starts and **A** or **B** when it ends (pressing A or B without S assumes the rally began 3 seconds after the last one), or use **Find rallies by sound** and then **N** to go through each rally and press A or B. The score and the check against the official result update as you go.
   - Press **M** where the match starts and **F** where it finishes; anything outside is left out.
   - If the video starts mid-match, set the game and score it starts at under *Video starts at*.
   - Playback runs from 0.25× to 16× (`[` and `]`); Chrome mutes the sound above 4×.
   - The score after each tagged rally shows in small type under the timeline. Press **H** (or ☆ in the list) to mark a favourite rally; *Highlights only* renders just those to a separate file.
6. **Render**. The finished video and a `.txt` with its YouTube title and description go into the output folder. **Upload to YouTube** in the editor's YouTube box copies the title, opens YouTube's upload page and shows the file in Explorer to drag across; upload it as *Unlisted* to share by link, then paste the link into the match's YouTube box: the match shows as *on YouTube* in the tournament list.

## Getting around

- The home page has a **search** across every imported match (player, tournament or event; narrow it to matches with a video, tagged or on YouTube) and a **To do** list of filmed matches still to tag, to render or to upload, plus videos not linked to anything.
- **Jobs** (in the header while anything runs) lists the background work. Renders and shuttle tracking take turns on the graphics card: start several and they queue. **Render all tagged** on a tournament page queues every filmed match whose rallies all have a winner and that has no video yet.
- On a tournament page, drag an unlinked video's chip, or the video file itself from Explorer, onto its match (or game) to link it.
- The editor's timeline zooms with the mouse wheel or + / − (0 shows the whole video; Shift+wheel moves along), with a strip of frames above it and the sound level below it, where shuttle hits show as spikes and missed rallies stand out.
- The header shows this window's version; hovering it shows the server's. When they differ (after an update) a bar says the server version doesn't match and the server needs restarting, with a **Restart server** button (it asks first if jobs are running; they would stop) (or, if the server is the newer one, that the window needs reloading).
- In the editor, **?** shows every keyboard shortcut. The header's theme button switches between light, dark and Windows' own setting.

## Statistics

The editor's **Stats** tab works out, from the tagged rallies: points won on each side's serve and on receive, the longest run of points, average and longest rallies (and shots per rally, counted from the hit sounds), and for each game its length, biggest leads, best runs and comebacks. A momentum chart shows who led after every rally, game by game, and can be saved as a picture. Once the court is marked and the shuttle tracked, a court map shows where each rally ended. Settings can add the longest rally and best run to the end card, and a banner after rallies of many shots.

## Players (from badminfo)

Tournaments imported from a badminfo link also bring everyone entered, with their badminfo grades and ratings. The **Players** page lists your players (from Settings; paste a badminfo link for any that aren't found by name) and each player has a page with their rating over time and every match of theirs in imported tournaments. Tournament pages show each player's rating for the event, badminfo's win chance for matches it has rated, and upsets (the side with under a 35% chance won). The editor's Players tab adds earlier meetings between the same players and the opponents' other filmed matches. Settings choose whether the YouTube description adds the players' badminfo pages and the win chance, and whether an upset goes in the title.

## Shuttle tracking (who won each rally)

Optional. [TrackNetV3](https://github.com/qaz812345/TrackNetV3) (MIT licence) follows the shuttle on an NVIDIA GPU. Set it up once with
`powershell -ExecutionPolicy Bypass -File analysis\setup.ps1` (Python 3.10+ and Git needed; about 3 GB of downloads, kept out of the repo in `analysis\`).

In a match: **Mark the court** (click its four outer corners), choose who is at the near end when the video starts, then **Track the shuttle** and **Suggest winners**. The winner of a rally serves the next one, so the direction of each serve (away from or towards the camera) says which end won the rally before; where the shuttle came down is a second check. Suggestions show as *A?* / *B?* in the rally list; fill in the sure ones and check the rest with **N**. They only ever fill rallies that have no winner yet: winners you tagged are never changed. Works best with the phone behind a baseline, high up, with the whole court in view; from a low corner the serve direction and landing can't be read reliably.

Tracking takes about 1½ minutes per minute of video on an RTX 3090 (a 6-minute game: 9 minutes). `analysis\run_tracknet.py` runs TrackNetV3 with a faster frame reader that gives it exactly the same input; `analysis\check_tracknet_reader.py <TrackNetV3 folder> <video>` checks that. Each run's full output is in `tracking.log` in the match's work folder (`<output>\.work\match-<id>\track\`).

## Removing voices

Optional. [Demucs](https://github.com/facebookresearch/demucs) (MIT licence) takes players' shouts, coaching and talk by the court out of the sound and keeps everything else, shuttle hits included. `analysis\setup.ps1` installs it with the shuttle tracker (run it again if you set tracking up before this was added). Switch it on in Settings → Video size, or per render in the editor's Export tab; reels and clips follow Settings and the Export tab's box.

Only the vocals model of Demucs' fine-tuned set runs, and the result is the original sound minus the voices, so nothing else is changed. The first render of a match works out its voice-free sound (about 15 seconds for a 6-minute video on an RTX 3090) and keeps it as `court.flac` in the match's work folder (`<output>\.work\match-<id>\voices\`); later renders reuse it until the video file changes. Loud shouts go; very quiet distant talk may partly stay.

## Logs

The server writes `data\logs\app.log`: starts and stops, and when each background job started, finished or failed, with the full error. When something fails, the red box's **Details** shows the longer story, the job's log (**Show log**), and buttons to open the log file and copy the details. Closing or restarting the server stops any job that is running.

## How it works

- `server.js`: a small Node HTTP server bound to 127.0.0.1 only. It serves `public/`, the JSON API in `api/` and match videos with byte ranges. Writes are accepted only from the app's own origin.
- `lib/`: server logic. `badminfo.js` and `schedule.js` read the tournament sources. `media.js` reads recording times, `matching.js` suggests links, `hits.js` and `analyse.js` find rallies by sound, `overlay.js` writes the ASS scoreboard (laid out by `public/shared/board.js`, which the Settings preview also draws), `render.js` plans cuts, chapters and FFmpeg commands, `pipeline.js` runs them, and `db.js` holds the SQLite database (`node:sqlite`) with `migrations/`.
- `public/`: the page (plain HTML, CSS and ES modules). `public/shared/` holds the scoring rules and name helpers, used by both the page and the server.
- Rendering cuts each kept part with the scoreboard drawn by FFmpeg's `ass` filter, several parts at once, then joins them without re-encoding. iPhone HDR footage is tone-mapped to standard video.

## Not yet

- Direct upload to YouTube (needs a Google Cloud project that has passed Google's API audit; until then uploads through the API are locked to private).
- Working out who won each rally from the video itself (shuttle tracking).

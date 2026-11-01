# Badminton Video visual kit 01

A forest-green, ivory and amber asset pack matched to the app's existing colours.
Open `http://127.0.0.1:8791/visual-kit/index.html` while the app is running for the interactive
preview. The preview includes light/dark themes, responsive component examples,
asset downloads and click-to-copy icon usage. Its workflow links open the app's
existing pages. Version 1.19.0 applies the mark to the app header and favicon,
the banner to the Tournaments page, and the transparent illustration to setup
and empty libraries. The editor uses the compact SVG icons. App components are
in `../visuals.js` and their styles in `../visuals.css`.

## Files and intended uses

| File | Use |
| --- | --- |
| `court-banner.png` | The 2172 × 724 home banner (Tournaments page). The shuttle tilts diagonally with its cork down-left and feathers up-right; leave HTML text over its dark left half. |
| `shuttle-video.png` | Transparent PNG illustration for onboarding or an empty video library. Keep its alpha; use around 220–320 CSS pixels wide. |
| `app-mark.svg` | Scalable shuttle/play mark for a header, favicon or shortcut. Test your intended small size before replacement. |
| `icons.js` | Ten theme-aware SVG icons for DOM-based controls. |
| `icons/*.svg` | Standalone 24 × 24 SVG files for design tools and image references. |

The PNG illustrations hold image data only (no embedded metadata; `tests/assets.test.js` checks).
The app mark and icons are native SVG. No external fonts, runtime packages,
third-party imagery or network requests are needed by the preview.

## Use an icon in the existing app

```js
import { visualIcon } from './visual-kit/icons.js';

// Works with the existing h() helper and .icon styling.
h('button', { onclick: startTracking }, visualIcon('tracking', 18), 'Track the shuttle');
```

Names: `shuttle`, `court`, `rally`, `scoreboard`, `tracking`, `highlights`,
`rally-cut`, `voice-clean`, `export`, `match-video`.

Icons use `currentColor`, rounded 1.8px strokes and a 24px coordinate grid.
Use 18–24 CSS pixels in controls. They are decorative (`aria-hidden`); give
icon-only controls a meaningful `aria-label`. Inline icons inherit light/dark
text colours. SVG files loaded through `<img>` do not inherit parent colours;
use the JavaScript helper where theme inheritance is needed.

## Use an illustration

```js
h('img', {
  src: 'visual-kit/shuttle-video.png',
  alt: '', // Decorative when nearby text already explains the empty state.
  width: 240,
});
```

For the banner, use `object-fit: cover` with the subject on the right and put
text in real HTML on the left. The preview demonstrates a gradient scrim to
preserve contrast. At narrow widths use a darker scrim or place text below
the image. Keep artwork out of the video editor's timeline so the
footage remains the focus.

## Palette

Forest `#0e3a2c`, court green `#0b7352`, ivory `#f2f7f3`, amber `#f0b429`.
The preview has its own scoped stylesheet and theme button. All filenames are
new so the kit can be reviewed independently of the current app's UI changes.

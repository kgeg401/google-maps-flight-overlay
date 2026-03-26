# Google Maps Flight Overlay

Personal-use Tampermonkey userscript that overlays live aircraft markers on top of `https://www.google.com/maps/*`.

It uses the free Airplanes.live point-radius endpoint directly from the browser. There is no backend, no paid API, and no scraping of Google flight cards or third-party tracker pages.

Current version: `0.10.0`
Repository: `https://github.com/kgeg401/google-maps-flight-overlay`

## Files

- `google-maps-flight-overlay.user.js`: published Tampermonkey userscript
- `dist/google-maps-flight-overlay.user.js`: built artifact copy
- `src/`: modular source tree
- `scripts/`: build helpers
- `CREDITS.md`: attribution for permissive-source concepts and references

## Supported Environment

- Desktop Chrome or Edge
- Tampermonkey
- Google Maps web app at `https://www.google.com/maps/*`

v1 is not designed for mobile browsers.

## Install

Recommended install URL for auto-updates:

- `https://raw.githubusercontent.com/kgeg401/google-maps-flight-overlay/main/google-maps-flight-overlay.user.js`

1. Open Tampermonkey in your browser.
2. Open the raw install URL above in your browser.
3. Let Tampermonkey install the script from that URL.
4. Visit `https://www.google.com/maps/*`.

If you install from the raw GitHub URL, Tampermonkey can auto-update the script when a newer `@version` is published to the repository.

If the script is active, you should see:

- a small status badge in the top-right corner
- a larger `Flights` launcher in the bottom-left corner
- movable overlay panels for menu, logs, settings, selected flight details, and debug state

Click the bottom-left `Flights` launcher to open or close the overlay menu. Use the menu to open settings, debug, or logs.

You can also use Tampermonkey's own script menu while you are on Google Maps:

- `Open Flight Overlay Menu`
- `Toggle Flight Overlay Logs`
- `Copy Flight Overlay Logs`

## Build

```bash
npm install
npm run build
```

The build bundles `src/index.js` into the published userscript and updates both:

- `google-maps-flight-overlay.user.js`
- `dist/google-maps-flight-overlay.user.js`

## Behavior

- The script waits for a visible Google Maps viewport.
- It parses map state from the current Google Maps URL using either `@lat,lon,zoomz` or `@lat,lon,metersm`.
- It derives a center-radius query from the current map center and viewport size.
- It fetches live aircraft from Airplanes.live every 5 seconds.
- It rerenders markers during active pan and zoom interactions so loaded aircraft reposition smoothly before the next fetch.
- It interpolates aircraft positions and headings between fetch snapshots instead of snapping every refresh.
- It keeps a bounded trail history and renders trails for the selected aircraft by default.
- It groups dense overlapping markers and supports click-to-expand spiderfy layouts in crowded views.
- It switches into a decluttered cluster mode at lower zoom levels.
- It persists marker size, hover hit radius, label mode, trail mode, density mode, photo mode, debug level, and panel layout through userscript storage.
- It keeps a rolling structured debug log plus replay snapshots for deterministic troubleshooting.
- It supports replay import/export from the debug panel.
- Hovering near a marker shows a lightweight tooltip with callsign, altitude, heading, speed, hex, and age.
- Clicking a marker opens a persistent details card with photo, registration, type, operator, and origin/destination when route data is available.
- Selected-aircraft enrichment uses `adsbdb` first and only falls back to `ADSB.lol` when fields are missing. Fallback route/photo data are marked advisory.

## Known Limits

- Personal-use PoC only.
- Airplanes.live is documented as non-commercial and rate-limited.
- Google Maps can change its DOM at any time, which can break viewport detection.
- v1 depends on Google Maps exposing a readable `@lat,lon,zoomz` or `@lat,lon,metersm` URL. If the page is in a mode that does not expose either shape, the overlay pauses instead of guessing.
- `...m...` URLs use an estimated zoom derived from the visible map scale, so placement may be a little less precise than explicit `...z...` URLs.
- The script does not use `unsafeWindow` or undocumented Google Maps internals, so viewport detection is heuristic and projection alignment is best-effort.
- Marker projection is still based on the consumer Google Maps URL and viewport heuristics, so 3D/Earth-heavy scenes can drift more than flat map views.
- Log export uses the browser clipboard. If clipboard access is blocked by the browser, log copying can fail.
- Airplanes.live can return `HTTP 429` rate limits. The script now backs off after rate limiting, but quick repeated map moves can still temporarily suppress fresh data.
- Aircraft photos and route details are looked up lazily only after you click a marker, and some aircraft will still have no photo or no destination data.
- The bundled airport fallback is intentionally compact, not exhaustive.
- Replay mode is a debugging aid and currently cycles imported snapshots automatically instead of providing a full timeline scrubber.
- As of Tampermonkey 5.4.1 on Chrome, userscript injection requires the browser's userscript permission. Based on Tampermonkey's official changelog and FAQ, you may need Chrome's `Allow User Scripts` permission and Developer Mode enabled before any page UI can appear.

## Manual Checks

Use these checks after installing:

1. Open `https://www.google.com/maps/*` and confirm the status badge appears.
2. Confirm aircraft markers appear after the first successful fetch.
3. Pan and zoom the map and confirm markers move with the map without waiting for a refetch.
4. Hover a marker and confirm the tooltip appears.
5. Open and close Google Maps side panels and confirm the overlay reattaches.
6. Switch tabs and come back; the overlay should pause while hidden and refresh on return.
7. Click the bottom-left flight icon and confirm the menu opens.
8. Open Settings and change marker size, label mode, and trail mode, then reload the tab and confirm the settings persist.
9. Use `Toggle Logs` and confirm the detailed log panel opens.
10. Click `Copy Logs` and confirm a log dump is copied to the clipboard.
11. Click a marker in a dense area and confirm either direct selection or spiderfy expansion occurs instead of a dead click.
12. Click a selected aircraft and confirm the details card opens with route and photo data when available.
13. Open a Google Maps URL like `https://www.google.com/maps/@41.5932759,-86.9125756,8641m/data=!3m1!1e3` and confirm the overlay no longer pauses on the `...m...` URL shape.
14. Zoom and pan the map after aircraft have loaded and confirm the existing markers rescale and reposition smoothly before the next fetch.
15. Open the Debug panel, export replay data, import it back, and confirm replay mode still renders aircraft frames without hitting the live API.

## Data Source

- Airplanes.live API guide: `https://airplanes.live/api-guide/`
- Airplanes.live field descriptions: `https://airplanes.live/rest-api-adsb-data-field-descriptions/`
- adsbdb public API: `https://github.com/mrjackwills/adsbdb`
- ADSB.lol API: `https://github.com/adsblol/api`
- Airport-name fallback inspiration: `https://github.com/davidmegginson/ourairports-data`

## Version History

Append a new entry here and in the userscript `VERSION_HISTORY` constant whenever the script changes.

### `0.10.0` - 2026-03-26

- Refactored the userscript into modular source files with a build step.
- Added persistent settings, density handling, interpolation, trails, and debug/replay plumbing.
- Expanded enrichment fallbacks while keeping the published Tampermonkey install to a single script file.

### `0.9.0` - 2026-03-26

- Added click-selected aircraft details with a persistent info card.
- Added lazy aircraft photo and route lookups via `api.adsbdb.com` when available.
- Kept destination blank when no route data is available for the selected aircraft.

### `0.8.0` - 2026-03-26

- Excluded the overlay UI from viewport detection so it cannot bind to itself.
- Added a high-frequency render loop while the map is being zoomed or panned.
- Added fetch backoff and interaction settle delays to reduce `HTTP 429` rate limiting.

### `0.7.0` - 2026-03-25

- Mounted the overlay HUD into `document.body` for more reliable rendering.
- Made the launcher button larger and auto-opened the menu on boot.
- Added support for Google Maps `@lat,lon,metersm` URL variants with estimated zoom.

### `0.6.0` - 2026-03-25

- Added Tampermonkey menu commands to open the overlay UI.
- Added a Tampermonkey menu command to toggle and copy overlay logs.
- Restricted execution to the top-level page with `@noframes`.

### `0.5.0` - 2026-03-25

- Added GitHub-backed Tampermonkey auto-update metadata.
- Prepared the project for installation from a dedicated public repository.

### `0.4.0` - 2026-03-25

- Added built-in version history.
- Included version history in the copied log dump.
- Surfaced current version details in the overlay menu.

### `0.3.0` - 2026-03-25

- Added a bottom-left flight icon launcher.
- Added a simple control menu for logs and overlay status.

### `0.2.0` - 2026-03-25

- Added a detailed rolling log panel.
- Added clipboard export, clear, and hide controls for logs.
- Added capture for uncaught errors and promise rejections.

### `0.1.0` - 2026-03-25

- Initial Google Maps overlay proof of concept.
- Added Airplanes.live polling, marker rendering, and hover tooltips.

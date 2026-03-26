# Google Maps Flight Overlay

Personal-use Tampermonkey userscript that overlays live aircraft markers on top of `https://www.google.com/maps/*`.

It uses the free Airplanes.live point-radius endpoint directly from the browser. There is no backend, no paid API, and no scraping of third-party tracker pages in v1.

Current version: `0.9.0`
Repository: `https://github.com/kgeg401/google-maps-flight-overlay`

## Files

- `google-maps-flight-overlay.user.js`: self-contained Tampermonkey userscript

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
- the control menu auto-open the first time the page loads

Click the bottom-left `Flights` launcher to open or close the overlay menu. Use the menu to toggle logs, copy logs, clear logs, or close the menu again.

You can also use Tampermonkey's own script menu while you are on Google Maps:

- `Open Flight Overlay Menu`
- `Toggle Flight Overlay Logs`
- `Copy Flight Overlay Logs`

## Configurable Constants

The script has a `CONFIG` block near the top. These are the main values you may want to tweak:

- `refreshIntervalMs`
- `fetchTimeoutMs`
- `minFetchGapMs`
- `maxQueryRadiusNm`
- `minQueryRadiusNm`
- `hoverHitRadiusPx`
- `renderMarginPx`
- `markerSizePx`
- `markerFillColor`
- `markerStrokeColor`
- `markerHighlightColor`
- `debug`

## Behavior

- The script waits for a visible Google Maps viewport.
- It parses map state from the current Google Maps URL using the `@lat,lon,zoomz` form.
- It derives a center-radius query from the current map center and viewport size.
- It fetches live aircraft from Airplanes.live every 5 seconds.
- It rerenders markers on pan, zoom, resize, and viewport replacement without refetching on every visual change.
- It provides a simple control menu opened from a bottom-left `Flights` launcher.
- It auto-opens the menu on page load so script startup is obvious.
- It also registers Tampermonkey menu commands so the UI and logs can be opened from the extension menu.
- It supports both `@lat,lon,zoomz` Google Maps URLs and `@lat,lon,metersm` URLs by estimating zoom from the visible map scale.
- It keeps rerendering during active pan and zoom interactions so loaded aircraft reposition more smoothly with the map.
- It keeps a rolling in-script debug log with timestamps, message details, and error context.
- The log panel can be expanded from the menu and collapsed again to save screen space.
- The log panel includes `Copy`, `Clear`, and `Hide` controls.
- Hovering near a marker shows:
  - callsign
  - altitude
  - heading
  - speed
  - hex/id
  - age of the last update
- Clicking a marker opens a persistent details card with:
  - aircraft photo when available
  - registration
  - aircraft type
  - operator/airline when available
  - origin and destination when route data is available

## Known Limits

- Personal-use PoC only.
- Airplanes.live is documented as non-commercial and rate-limited.
- Google Maps can change its DOM at any time, which can break viewport detection.
- v1 depends on Google Maps exposing a readable `@lat,lon,zoomz` or `@lat,lon,metersm` URL. If the page is in a mode that does not expose either shape, the overlay pauses instead of guessing.
- `...m...` URLs use an estimated zoom derived from the visible map scale, so placement may be a little less precise than explicit `...z...` URLs.
- The script does not use `unsafeWindow` or undocumented Google Maps internals, so viewport detection is heuristic and projection alignment is best-effort.
- v1 does not include labels, filters, persistence, settings sync, or source fallback.
- Log export uses the browser clipboard. If clipboard access is blocked by the browser, log copying can fail.
- Airplanes.live can return `HTTP 429` rate limits. The script now backs off after rate limiting, but quick repeated map moves can still temporarily suppress fresh data.
- Aircraft photos and route details are looked up lazily via `api.adsbdb.com` only after you click a marker, and some aircraft will not have route or photo data.
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
8. Use `Toggle Logs` and confirm the detailed log panel opens.
9. Click `Hide` on the log panel and confirm it collapses cleanly.
10. Click `Copy Logs` and confirm a log dump is copied to the clipboard.
11. Open Tampermonkey's script menu and confirm `Open Flight Overlay Menu` opens the UI.
12. Use Tampermonkey's `Copy Flight Overlay Logs` command and confirm a log dump is copied.
13. Open a Google Maps URL like `https://www.google.com/maps/@41.5932759,-86.9125756,8641m/data=!3m1!1e3` and confirm the overlay no longer pauses on the `...m...` URL shape.
14. Zoom and pan the map after aircraft have loaded and confirm the existing markers rescale and reposition more smoothly before the next fetch.
15. Click a marker and confirm the details card opens with route and photo data when available.

## Data Source

- Airplanes.live API guide: `https://airplanes.live/api-guide/`
- Airplanes.live field descriptions: `https://airplanes.live/rest-api-adsb-data-field-descriptions/`
- adsbdb public API: `https://github.com/mrjackwills/adsbdb`

## Version History

Append a new entry here and in the userscript `VERSION_HISTORY` constant whenever the script changes.

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

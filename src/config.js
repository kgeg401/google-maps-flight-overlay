export const VERSION = "0.10.0";

export const VERSION_HISTORY = [
  {
    version: "0.10.0",
    date: "2026-03-26",
    changes: [
      "Refactored the userscript into modular source files with a build step.",
      "Added persistent settings, density handling, interpolation, trails, and debug/replay plumbing.",
      "Expanded enrichment fallbacks while keeping the published Tampermonkey install to a single script file.",
    ],
  },
  {
    version: "0.9.0",
    date: "2026-03-26",
    changes: [
      "Added click-selected aircraft details with a persistent info card.",
      "Added lazy aircraft photo and route lookups via api.adsbdb.com when available.",
      "Kept destination blank when no route data is available for the selected aircraft.",
    ],
  },
  {
    version: "0.8.0",
    date: "2026-03-26",
    changes: [
      "Excluded the overlay UI from viewport detection so it cannot bind to itself.",
      "Added a high-frequency render loop while the map is being zoomed or panned.",
      "Added fetch backoff and interaction settle delays to reduce HTTP 429 rate limiting.",
    ],
  },
  {
    version: "0.7.0",
    date: "2026-03-25",
    changes: [
      "Mounted the overlay HUD into document.body for more reliable rendering.",
      "Made the launcher button larger and auto-opened the menu on boot.",
      "Added support for Google Maps @lat,lon,metersm URL variants with estimated zoom.",
    ],
  },
  {
    version: "0.6.0",
    date: "2026-03-25",
    changes: [
      "Added Tampermonkey menu commands to open the overlay UI.",
      "Added a Tampermonkey menu command to toggle and copy overlay logs.",
      "Restricted execution to the top-level page with @noframes.",
    ],
  },
  {
    version: "0.5.0",
    date: "2026-03-25",
    changes: [
      "Added GitHub-backed Tampermonkey auto-update metadata.",
      "Prepared the project for installation from a dedicated public repository.",
    ],
  },
  {
    version: "0.4.0",
    date: "2026-03-25",
    changes: [
      "Added built-in version history.",
      "Included version history in the log dump.",
      "Surfaced current version details in the overlay menu.",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-03-25",
    changes: [
      "Added a bottom-left flight icon launcher.",
      "Added a simple control menu for logs and overlay status.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-03-25",
    changes: [
      "Added a detailed rolling log panel.",
      "Added clipboard export, clear, and hide controls for logs.",
      "Added capture for uncaught errors and promise rejections.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-03-25",
    changes: [
      "Initial Google Maps overlay proof of concept.",
      "Added Airplanes.live polling, marker rendering, and hover tooltips.",
    ],
  },
];

export const TILE_SIZE = 256;
export const WORLD_RESOLUTION_MPP = 156543.03392804097;
export const DEG_TO_RAD = Math.PI / 180;
export const SETTINGS_VERSION = 1;
export const DETAILS_CACHE_TTL_MS = 30 * 60 * 1000;
export const REPLAY_STORAGE_KEY = "gm-flight-overlay-replay";
export const SETTINGS_STORAGE_KEY = "gm-flight-overlay-settings";
export const DETAILS_CACHE_STORAGE_KEY = "gm-flight-overlay-details-cache";

export const APP_CONFIG = {
  refreshIntervalMs: 5000,
  fetchTimeoutMs: 8000,
  minFetchGapMs: 1000,
  interactionRenderDurationMs: 1600,
  interactionSettleDelayMs: 900,
  maxQueryRadiusNm: 100,
  minQueryRadiusNm: 10,
  logBufferSize: 600,
  rateLimitBackoffMs: 30000,
  viewportPollIntervalMs: 1000,
  urlPollIntervalMs: 400,
  domWatchDebounceMs: 150,
  renderMarginPx: 36,
  markerFillColor: "#59d7ff",
  markerStrokeColor: "#07111d",
  markerHighlightColor: "#ffd166",
  markerShadowColor: "rgba(7, 17, 29, 0.28)",
  clusterFillColor: "rgba(18, 35, 52, 0.9)",
  clusterStrokeColor: "rgba(96, 202, 255, 0.92)",
  clusterTextColor: "#f5fbff",
  trailStrokeColor: "rgba(89, 215, 255, 0.58)",
  selectedTrailStrokeColor: "rgba(255, 209, 102, 0.8)",
  labelBackgroundColor: "rgba(6, 10, 18, 0.9)",
  labelBorderColor: "rgba(120, 190, 255, 0.24)",
  labelTextColor: "#f3f7ff",
  debugPanelMaxEntries: 12,
  trailMaxPoints: 24,
  trailExpireMs: 7 * 60 * 1000,
  spiderfyDistancePx: 28,
  spiderfyMinSize: 2,
  spiderfyMaxSize: 18,
  clusterJoinDistancePx: 34,
  declutterZoomThreshold: 8.75,
  highZoomLabelsThreshold: 11.25,
  interpolationDurationMs: 4300,
  interpolationTeleportPx: 220,
  autoOpenMenuOnBoot: true,
};

export const DEFAULT_SETTINGS = {
  settingsVersion: SETTINGS_VERSION,
  markerSizePx: 11,
  hoverHitRadiusPx: 20,
  labelMode: "selected-and-hovered-only",
  trailMode: "selected-only",
  densityMode: "spiderfy",
  photoMode: "enabled",
  debugLevel: "basic",
  panelPositions: {
    menu: { left: 16, top: null, right: null, bottom: 84 },
    logs: { left: null, top: 112, right: 12, bottom: null },
    details: { left: null, top: 112, right: 12, bottom: null },
    settings: { left: 24, top: 112, right: null, bottom: null },
    debug: { left: 24, top: 456, right: null, bottom: null },
  },
  panelVisibility: {
    menu: true,
    logs: false,
    details: true,
    settings: false,
    debug: false,
  },
  debugPanelOpen: false,
  replayPanelOpen: false,
};

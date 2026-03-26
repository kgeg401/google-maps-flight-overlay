// ==UserScript==
// @name         Google Maps Flight Overlay
// @namespace    https://github.com/kgeg401/google-maps-flight-overlay
// @version      0.10.0
// @description  Overlay live aircraft markers on Google Maps using Airplanes.live.
// @match        https://www.google.com/maps/*
// @noframes
// @run-at       document-body
// @sandbox      DOM
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM.xmlHttpRequest
// @connect      api.airplanes.live
// @connect      api.adsbdb.com
// @connect      api.adsb.lol
// @homepageURL  https://github.com/kgeg401/google-maps-flight-overlay
// @supportURL   https://github.com/kgeg401/google-maps-flight-overlay/issues
// @updateURL    https://raw.githubusercontent.com/kgeg401/google-maps-flight-overlay/main/google-maps-flight-overlay.user.js
// @downloadURL  https://raw.githubusercontent.com/kgeg401/google-maps-flight-overlay/main/google-maps-flight-overlay.user.js
// ==/UserScript==
(() => {
  // src/config.js
  var VERSION = "0.10.0";
  var VERSION_HISTORY = [
    {
      version: "0.10.0",
      date: "2026-03-26",
      changes: [
        "Refactored the userscript into modular source files with a build step.",
        "Added persistent settings, density handling, interpolation, trails, and debug/replay plumbing.",
        "Expanded enrichment fallbacks while keeping the published Tampermonkey install to a single script file."
      ]
    },
    {
      version: "0.9.0",
      date: "2026-03-26",
      changes: [
        "Added click-selected aircraft details with a persistent info card.",
        "Added lazy aircraft photo and route lookups via api.adsbdb.com when available.",
        "Kept destination blank when no route data is available for the selected aircraft."
      ]
    },
    {
      version: "0.8.0",
      date: "2026-03-26",
      changes: [
        "Excluded the overlay UI from viewport detection so it cannot bind to itself.",
        "Added a high-frequency render loop while the map is being zoomed or panned.",
        "Added fetch backoff and interaction settle delays to reduce HTTP 429 rate limiting."
      ]
    },
    {
      version: "0.7.0",
      date: "2026-03-25",
      changes: [
        "Mounted the overlay HUD into document.body for more reliable rendering.",
        "Made the launcher button larger and auto-opened the menu on boot.",
        "Added support for Google Maps @lat,lon,metersm URL variants with estimated zoom."
      ]
    },
    {
      version: "0.6.0",
      date: "2026-03-25",
      changes: [
        "Added Tampermonkey menu commands to open the overlay UI.",
        "Added a Tampermonkey menu command to toggle and copy overlay logs.",
        "Restricted execution to the top-level page with @noframes."
      ]
    },
    {
      version: "0.5.0",
      date: "2026-03-25",
      changes: [
        "Added GitHub-backed Tampermonkey auto-update metadata.",
        "Prepared the project for installation from a dedicated public repository."
      ]
    },
    {
      version: "0.4.0",
      date: "2026-03-25",
      changes: [
        "Added built-in version history.",
        "Included version history in the log dump.",
        "Surfaced current version details in the overlay menu."
      ]
    },
    {
      version: "0.3.0",
      date: "2026-03-25",
      changes: [
        "Added a bottom-left flight icon launcher.",
        "Added a simple control menu for logs and overlay status."
      ]
    },
    {
      version: "0.2.0",
      date: "2026-03-25",
      changes: [
        "Added a detailed rolling log panel.",
        "Added clipboard export, clear, and hide controls for logs.",
        "Added capture for uncaught errors and promise rejections."
      ]
    },
    {
      version: "0.1.0",
      date: "2026-03-25",
      changes: [
        "Initial Google Maps overlay proof of concept.",
        "Added Airplanes.live polling, marker rendering, and hover tooltips."
      ]
    }
  ];
  var TILE_SIZE = 256;
  var WORLD_RESOLUTION_MPP = 156543.03392804097;
  var DEG_TO_RAD = Math.PI / 180;
  var SETTINGS_VERSION = 1;
  var DETAILS_CACHE_TTL_MS = 30 * 60 * 1e3;
  var SETTINGS_STORAGE_KEY = "gm-flight-overlay-settings";
  var APP_CONFIG = {
    refreshIntervalMs: 5e3,
    fetchTimeoutMs: 8e3,
    minFetchGapMs: 1e3,
    interactionRenderDurationMs: 1600,
    interactionSettleDelayMs: 900,
    maxQueryRadiusNm: 100,
    minQueryRadiusNm: 10,
    logBufferSize: 600,
    rateLimitBackoffMs: 3e4,
    viewportPollIntervalMs: 1e3,
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
    trailExpireMs: 7 * 60 * 1e3,
    spiderfyDistancePx: 28,
    spiderfyMinSize: 2,
    spiderfyMaxSize: 18,
    clusterJoinDistancePx: 34,
    declutterZoomThreshold: 8.75,
    highZoomLabelsThreshold: 11.25,
    interpolationDurationMs: 4300,
    interpolationTeleportPx: 220,
    autoOpenMenuOnBoot: true
  };
  var DEFAULT_SETTINGS = {
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
      debug: { left: 24, top: 456, right: null, bottom: null }
    },
    panelVisibility: {
      menu: true,
      logs: false,
      details: true,
      settings: false,
      debug: false
    },
    debugPanelOpen: false,
    replayPanelOpen: false
  };

  // src/utils.js
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function isFiniteNumber(value) {
    return Number.isFinite(value);
  }
  function toFiniteNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }
  function firstFiniteNumber(...values) {
    for (const value of values) {
      const parsed = toFiniteNumber(value);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  }
  function cleanText(value) {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim();
    return normalized === "" ? null : normalized;
  }
  function formatLatLon(lat, lon) {
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }
  function formatZoomSummary(mapState) {
    if (!mapState) {
      return "n/a";
    }
    if (mapState.zoomSource === "meters-estimate") {
      return `~z${mapState.zoom.toFixed(2)} from ${Math.round(mapState.scaleMeters || 0)}m`;
    }
    return `z${mapState.zoom.toFixed(2)}`;
  }
  function formatAltitude(aircraft) {
    if (aircraft.onGround) {
      return "GND";
    }
    if (!isFiniteNumber(aircraft.altitudeFt)) {
      return "n/a";
    }
    return `${Math.round(aircraft.altitudeFt).toLocaleString()} ft`;
  }
  function formatSpeed(speedKt) {
    if (!isFiniteNumber(speedKt)) {
      return "n/a";
    }
    return `${Math.round(speedKt)} kt`;
  }
  function formatHeading(heading) {
    if (!isFiniteNumber(heading)) {
      return "n/a";
    }
    return `${Math.round((heading % 360 + 360) % 360)} deg`;
  }
  function formatAge(updatedAt, now = Date.now()) {
    if (!isFiniteNumber(updatedAt)) {
      return "n/a";
    }
    const deltaSec = Math.max(0, Math.round((now - updatedAt) / 1e3));
    return `${deltaSec}s ago`;
  }
  function formatRouteEndpoint(airport) {
    if (!airport) {
      return "";
    }
    const code = cleanText(airport.iataCode) || cleanText(airport.icaoCode) || null;
    const name = cleanText(airport.name) || cleanText(airport.municipality) || null;
    if (code && name) {
      return `${code} ${name}`;
    }
    return code || name || "";
  }
  function formatAircraftTitle(aircraft, details) {
    return cleanText(aircraft && aircraft.callsign) || cleanText(details && details.registration) || cleanText(aircraft && aircraft.registration) || cleanText(aircraft && aircraft.id) || "Selected aircraft";
  }
  function formatAircraftSubtitle(aircraft, details) {
    const parts = [
      cleanText(details && details.manufacturer),
      cleanText(details && details.type),
      cleanText(aircraft && aircraft.aircraftType)
    ].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(" ");
    }
    return "Live aircraft details";
  }
  function mergeDeep(base, override) {
    if (!override || typeof override !== "object") {
      return structuredClone(base);
    }
    const output = Array.isArray(base) ? [...base] : { ...base };
    for (const [key, value] of Object.entries(override)) {
      if (value && typeof value === "object" && !Array.isArray(value) && base && typeof base[key] === "object" && !Array.isArray(base[key])) {
        output[key] = mergeDeep(base[key], value);
      } else {
        output[key] = value;
      }
    }
    return output;
  }
  function copyTextToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "readonly");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.top = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const succeeded = document.execCommand("copy");
        textarea.remove();
        if (!succeeded) {
          reject(new Error("copy_failed"));
          return;
        }
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }
  function safeJsonParse(value, fallback = null) {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return fallback;
    }
  }

  // src/storage.js
  function hasFunction(name) {
    return typeof globalThis[name] === "function";
  }
  function createStorage() {
    const memory = /* @__PURE__ */ new Map();
    function getValue(name, fallback = null) {
      if (hasFunction("GM_getValue")) {
        return Promise.resolve(globalThis.GM_getValue(name, fallback));
      }
      return Promise.resolve(memory.has(name) ? memory.get(name) : fallback);
    }
    function setValue(name, value) {
      if (hasFunction("GM_setValue")) {
        return Promise.resolve(globalThis.GM_setValue(name, value));
      }
      memory.set(name, value);
      return Promise.resolve();
    }
    function removeValue(name) {
      if (hasFunction("GM_deleteValue")) {
        return Promise.resolve(globalThis.GM_deleteValue(name));
      }
      memory.delete(name);
      return Promise.resolve();
    }
    return {
      getValue,
      setValue,
      removeValue,
      async getJson(name, fallback = null) {
        const raw = await getValue(name, null);
        if (raw === null || raw === void 0 || raw === "") {
          return fallback;
        }
        if (typeof raw === "object") {
          return raw;
        }
        return safeJsonParse(raw, fallback);
      },
      async setJson(name, value) {
        return setValue(name, JSON.stringify(value));
      }
    };
  }
  function normalizeSettings(rawSettings) {
    const merged = mergeDeep(DEFAULT_SETTINGS, rawSettings || {});
    merged.settingsVersion = SETTINGS_VERSION;
    merged.markerSizePx = clampNumber(merged.markerSizePx, 6, 20, DEFAULT_SETTINGS.markerSizePx);
    merged.hoverHitRadiusPx = clampNumber(merged.hoverHitRadiusPx, 8, 42, DEFAULT_SETTINGS.hoverHitRadiusPx);
    merged.labelMode = pickAllowed(
      merged.labelMode,
      ["selected-and-hovered-only", "high-zoom-visible", "off"],
      DEFAULT_SETTINGS.labelMode
    );
    merged.trailMode = pickAllowed(
      merged.trailMode,
      ["selected-only", "selected-and-hovered", "off"],
      DEFAULT_SETTINGS.trailMode
    );
    merged.densityMode = pickAllowed(
      merged.densityMode,
      ["normal", "spiderfy", "declutter"],
      DEFAULT_SETTINGS.densityMode
    );
    merged.photoMode = pickAllowed(merged.photoMode, ["enabled", "disabled"], DEFAULT_SETTINGS.photoMode);
    merged.debugLevel = pickAllowed(merged.debugLevel, ["off", "basic", "trace"], DEFAULT_SETTINGS.debugLevel);
    return merged;
  }
  async function loadSettings(storage) {
    const rawSettings = await storage.getJson(SETTINGS_STORAGE_KEY, null);
    return normalizeSettings(rawSettings);
  }
  async function saveSettings(storage, settings) {
    return storage.setJson(SETTINGS_STORAGE_KEY, normalizeSettings(settings));
  }
  async function importSettings(storage, text) {
    const parsed = safeJsonParse(text, null);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid settings JSON");
    }
    const normalized = normalizeSettings(parsed);
    await saveSettings(storage, normalized);
    return normalized;
  }
  function clampNumber(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, numeric));
  }
  function pickAllowed(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }

  // src/state.js
  function createState(window2, settings = DEFAULT_SETTINGS) {
    return {
      aircraft: [],
      aircraftById: /* @__PURE__ */ new Map(),
      previousAircraftById: /* @__PURE__ */ new Map(),
      badgeEl: null,
      canvasEl: null,
      canvasCtx: null,
      densityScene: null,
      densityStats: null,
      debugPanelBodyEl: null,
      debugPanelEl: null,
      debugPanelOpen: Boolean(settings.debugPanelOpen),
      detailsPanelBodyEl: null,
      detailsPanelEl: null,
      detailsPanelOpen: Boolean(settings.panelVisibility && settings.panelVisibility.details),
      domObserver: null,
      drawnMarkers: [],
      heartbeatTimer: 0,
      hoverMarkerId: null,
      hudRootEl: null,
      interpolationState: null,
      interactionFrameHandle: 0,
      interactionRenderUntil: 0,
      isFetching: false,
      lastBackoffMessage: "",
      lastError: "",
      lastFetchCompletedAt: 0,
      lastFetchStartedAt: 0,
      lastFetchSummary: null,
      lastMapInteractionAt: 0,
      lastLocationHref: window2.location.href,
      lastLoggedMapStateKey: "",
      lastLoggedViewportKey: "",
      lastPauseReason: "",
      lastReplayCaptureAt: 0,
      lastSuccessAt: 0,
      lastViewportScanAt: 0,
      logs: [],
      logPanelBodyEl: null,
      logPanelEl: null,
      logPanelOpen: Boolean(settings.panelVisibility && settings.panelVisibility.logs),
      mapState: null,
      menuButtonEl: null,
      menuInfoEl: null,
      menuOpen: Boolean(settings.panelVisibility && settings.panelVisibility.menu),
      menuPanelEl: null,
      mouseX: 0,
      mouseY: 0,
      nextFetchDueAt: 0,
      nextReplayDueAt: 0,
      panelDrag: null,
      pendingViewportRefresh: 0,
      rateLimitBackoffUntil: 0,
      renderScheduled: false,
      renderedAircraftByMarkerId: /* @__PURE__ */ new Map(),
      replayFrameIndex: 0,
      replayFrames: [],
      replayMode: false,
      replayName: "",
      replayPanelEl: null,
      replayPanelOpen: Boolean(settings.replayPanelOpen),
      selectedAircraftDetails: null,
      selectedAircraftDetailsCache: /* @__PURE__ */ new Map(),
      selectedAircraftDetailsError: "",
      selectedAircraftDetailsKey: "",
      selectedAircraftDetailsLoading: false,
      selectedAircraftId: null,
      selectedAircraftSnapshot: null,
      settings,
      settingsExportTextarea: null,
      settingsPanelEl: null,
      settingsPanelOpen: Boolean(settings.panelVisibility && settings.panelVisibility.settings),
      snapshotSequence: 0,
      spiderfyGroupKey: "",
      statusLevel: "boot",
      statusText: "Booting",
      tooltipEl: null,
      trailStore: null,
      trailsById: /* @__PURE__ */ new Map(),
      viewportEl: null,
      viewportRect: null
    };
  }

  // src/debug.js
  var DEBUG_LEVELS = Object.freeze({
    OFF: "off",
    BASIC: "basic",
    TRACE: "trace"
  });
  var DEFAULT_LOG_BUFFER_SIZE = 500;
  var DEFAULT_REPLAY_BUFFER_SIZE = 50;
  function clampNumber2(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return min;
    }
    return Math.min(max, Math.max(min, numeric));
  }
  function normalizeDebugLevel(value) {
    const level = String(value || "").trim().toLowerCase();
    if (level === DEBUG_LEVELS.BASIC || level === DEBUG_LEVELS.TRACE) {
      return level;
    }
    return DEBUG_LEVELS.OFF;
  }
  function levelRank(level) {
    switch (normalizeDebugLevel(level)) {
      case DEBUG_LEVELS.TRACE:
        return 2;
      case DEBUG_LEVELS.BASIC:
        return 1;
      case DEBUG_LEVELS.OFF:
      default:
        return 0;
    }
  }
  function normalizeLogLevel(level) {
    const normalized = String(level || "").trim().toLowerCase();
    if (normalized === "trace" || normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
      return normalized;
    }
    return "info";
  }
  function shouldRecord(currentLevel, entryLevel) {
    const debugRank = levelRank(currentLevel);
    const logLevel = normalizeLogLevel(entryLevel);
    if (debugRank <= 0) {
      return logLevel === "warn" || logLevel === "error";
    }
    if (debugRank === 1) {
      return logLevel !== "trace";
    }
    return true;
  }
  function serializeDebugValue(value, depth = 0) {
    if (depth >= 4) {
      return "[max-depth]";
    }
    if (value === null || value === void 0) {
      return value;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (typeof value === "symbol") {
      return value.toString();
    }
    if (typeof value === "function") {
      return `[function ${value.name || "anonymous"}]`;
    }
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack || null
      };
    }
    if (Array.isArray(value)) {
      return value.slice(0, 32).map((item) => serializeDebugValue(item, depth + 1));
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (value instanceof Map) {
      return {
        type: "Map",
        entries: Array.from(value.entries()).slice(0, 32).map(([key, entryValue]) => [
          serializeDebugValue(key, depth + 1),
          serializeDebugValue(entryValue, depth + 1)
        ])
      };
    }
    if (value instanceof Set) {
      return {
        type: "Set",
        values: Array.from(value.values()).slice(0, 32).map((item) => serializeDebugValue(item, depth + 1))
      };
    }
    if (typeof value === "object") {
      const output = {};
      const keys = Object.keys(value).slice(0, 32);
      for (const key of keys) {
        output[key] = serializeDebugValue(value[key], depth + 1);
      }
      return output;
    }
    return String(value);
  }
  function safeJsonParse2(text, fallback = null) {
    if (typeof text !== "string") {
      return fallback;
    }
    try {
      return JSON.parse(text);
    } catch (_error) {
      return fallback;
    }
  }
  function formatCompactDuration(ms) {
    const totalMs = Math.max(0, Math.floor(Number(ms) || 0));
    const totalSeconds = Math.ceil(totalMs / 1e3);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes <= 0) {
      return `${seconds}s`;
    }
    return `${minutes}m ${seconds}s`;
  }
  function deriveBackoffCountdown(backoffUntilMs, nowMs = Date.now()) {
    const until = Number(backoffUntilMs);
    const active = Number.isFinite(until) && until > nowMs;
    const remainingMs = active ? until - nowMs : 0;
    return Object.freeze({
      active,
      untilMs: Number.isFinite(until) ? until : 0,
      remainingMs,
      remainingSeconds: Math.ceil(remainingMs / 1e3),
      label: active ? `Backoff ${formatCompactDuration(remainingMs)} remaining` : "No backoff",
      severity: active ? "warn" : "ok"
    });
  }
  function deriveDensityStats(input = {}) {
    const visibleAircraftCount = clampNumber2(input.visibleAircraftCount ?? input.aircraftCount, 0, Number.MAX_SAFE_INTEGER);
    const drawnAircraftCount = clampNumber2(input.drawnAircraftCount, 0, Number.MAX_SAFE_INTEGER);
    const groupedCount = clampNumber2(input.groupedCount ?? input.clusterCount, 0, Number.MAX_SAFE_INTEGER);
    const overlappedCount = clampNumber2(input.overlappedCount, 0, Number.MAX_SAFE_INTEGER);
    const spiderfiedCount = clampNumber2(input.spiderfiedCount, 0, Number.MAX_SAFE_INTEGER);
    const trailCount = clampNumber2(input.trailCount, 0, Number.MAX_SAFE_INTEGER);
    return Object.freeze({
      mode: String(input.mode || "normal"),
      visibleAircraftCount,
      drawnAircraftCount,
      groupedCount,
      overlappedCount,
      spiderfiedCount,
      trailCount,
      densityLabel: `${visibleAircraftCount} visible, ${drawnAircraftCount} drawn`
    });
  }
  function deriveSelectedAircraftSummary(selectedAircraft = null, details = null) {
    const aircraft = selectedAircraft || {};
    const enriched = details || {};
    const callsign = String(aircraft.callsign || aircraft.flight || "").trim();
    const registration = String(enriched.registration || aircraft.registration || "").trim();
    const type = String(enriched.type || enriched.icaoType || aircraft.aircraftType || "").trim();
    const operator = String(enriched.airlineName || enriched.owner || "").trim();
    const origin = normalizeAirportEndpoint(enriched.origin);
    const destination = normalizeAirportEndpoint(enriched.destination);
    const title = callsign || registration || aircraft.id || "Unknown flight";
    const subtitleParts = [operator, type].filter(Boolean);
    return Object.freeze({
      id: aircraft.id || null,
      title,
      subtitle: subtitleParts.join(" \u2022 "),
      callsign: callsign || null,
      registration: registration || null,
      type: type || null,
      operator: operator || null,
      origin,
      destination,
      hasPhoto: Boolean(enriched.photoUrl || enriched.photoThumbnailUrl),
      hasRoute: Boolean(origin || destination),
      isStale: Boolean(aircraft.isStale || enriched.isStale)
    });
  }
  function normalizeAirportEndpoint(value) {
    if (value === null || value === void 0) {
      return null;
    }
    if (typeof value === "string") {
      const text = value.trim();
      return text ? text : null;
    }
    if (typeof value === "object") {
      const code = String(value.code || value.icao || value.iata || "").trim();
      const name = String(value.name || value.airportName || "").trim();
      if (!code && !name) {
        return null;
      }
      if (code && name) {
        return `${code} ${name}`;
      }
      return code || name || null;
    }
    return String(value);
  }
  function deriveEnrichmentStatus(input = {}) {
    const source = String(input.source || input.enrichmentSource || "none");
    const status = String(input.status || (input.error ? "error" : input.loading ? "loading" : "ready"));
    return Object.freeze({
      source,
      status,
      loading: Boolean(input.loading),
      cacheHit: Boolean(input.cacheHit),
      hasPhoto: Boolean(input.hasPhoto || input.photoUrl || input.photoThumbnailUrl),
      hasRoute: Boolean(input.hasRoute || input.origin || input.destination),
      error: input.error ? String(input.error.message || input.error) : null,
      advisory: Boolean(input.advisory),
      label: `${source}:${status}`
    });
  }
  function deriveViewportBindingDiagnostics(input = {}) {
    const rect = input.rect || null;
    const hasRect = rect && Number.isFinite(rect.left) && Number.isFinite(rect.top) && Number.isFinite(rect.width) && Number.isFinite(rect.height);
    return Object.freeze({
      bound: Boolean(input.bound ?? input.isBound ?? hasRect),
      reason: String(input.reason || input.pauseReason || "unknown"),
      viewportId: input.viewportId || input.id || null,
      className: input.className || null,
      left: hasRect ? rect.left : null,
      top: hasRect ? rect.top : null,
      width: hasRect ? rect.width : null,
      height: hasRect ? rect.height : null,
      lastScanAt: Number.isFinite(Number(input.lastScanAt)) ? Number(input.lastScanAt) : null,
      scanAgeMs: Number.isFinite(Number(input.lastScanAt)) ? Math.max(0, Date.now() - Number(input.lastScanAt)) : null
    });
  }
  function deriveLastFetchSummary(input = {}) {
    const startedAt = Number(input.startedAt || input.lastFetchStartedAt || 0);
    const completedAt = Number(input.completedAt || input.lastFetchCompletedAt || 0);
    const durationMs = Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt >= startedAt ? completedAt - startedAt : null;
    return Object.freeze({
      url: input.url ? String(input.url) : null,
      radiusNm: Number.isFinite(Number(input.radiusNm)) ? Number(input.radiusNm) : null,
      aircraftCount: Number.isFinite(Number(input.aircraftCount)) ? Number(input.aircraftCount) : null,
      status: String(input.status || (input.error ? "error" : "ok")),
      startedAt: Number.isFinite(startedAt) ? startedAt : null,
      completedAt: Number.isFinite(completedAt) ? completedAt : null,
      durationMs,
      error: input.error ? String(input.error.message || input.error) : null,
      rateLimited: Boolean(input.rateLimited || String(input.error || "").includes("429")),
      backoffUntil: Number.isFinite(Number(input.backoffUntil || input.rateLimitBackoffUntil)) ? Number(input.backoffUntil || input.rateLimitBackoffUntil) : null
    });
  }
  function deriveReplayState(input = {}, snapshots = []) {
    const replaySnapshots = Array.isArray(snapshots) ? snapshots : [];
    const currentIndex = Number.isFinite(Number(input.currentIndex)) ? Number(input.currentIndex) : -1;
    const currentSnapshot = currentIndex >= 0 && currentIndex < replaySnapshots.length ? replaySnapshots[currentIndex] : null;
    return Object.freeze({
      mode: String(input.mode || "inactive"),
      active: Boolean(input.active ?? replaySnapshots.length > 0),
      imported: Boolean(input.imported),
      exported: Boolean(input.exported),
      cursor: currentIndex,
      totalSnapshots: replaySnapshots.length,
      currentSnapshotId: currentSnapshot ? currentSnapshot.id || null : null,
      currentSnapshotLabel: currentSnapshot ? currentSnapshot.label || null : null,
      lastCapturedAt: replaySnapshots.length > 0 ? replaySnapshots[replaySnapshots.length - 1].capturedAt || null : null
    });
  }
  function summarizeDebugContext(context = {}) {
    const backoff = deriveBackoffCountdown(context.rateLimitBackoffUntil || context.backoffUntil || 0, context.nowMs || Date.now());
    const density = deriveDensityStats(context.density || context);
    const selected = deriveSelectedAircraftSummary(context.selectedAircraft || context.aircraft || null, context.selectedAircraftDetails || context.details || null);
    const enrichment = deriveEnrichmentStatus(context.enrichment || context);
    const viewport = deriveViewportBindingDiagnostics(context.viewport || context);
    return Object.freeze({
      level: normalizeDebugLevel(context.level),
      statusLevel: String(context.statusLevel || context.status || "unknown"),
      statusText: String(context.statusText || ""),
      backoff,
      density,
      selected,
      enrichment,
      viewport,
      counts: Object.freeze({
        logs: Array.isArray(context.logs) ? context.logs.length : 0,
        replaySnapshots: Array.isArray(context.replaySnapshots) ? context.replaySnapshots.length : 0
      })
    });
  }
  function buildDebugExport(context = {}) {
    const replaySnapshots = Array.isArray(context.replaySnapshots) ? context.replaySnapshots : [];
    const summary = summarizeDebugContext({
      ...context,
      replaySnapshots
    });
    return Object.freeze({
      generatedAt: new Date(context.nowMs || Date.now()).toISOString(),
      version: String(context.version || context.debugVersion || "unknown"),
      level: normalizeDebugLevel(context.level),
      settings: serializeDebugValue(context.settings || {}, 0),
      status: {
        level: String(context.statusLevel || context.status?.level || "unknown"),
        text: String(context.statusText || context.status?.text || "")
      },
      lastFetchSummary: deriveLastFetchSummary(context.lastFetch || context.fetch || context),
      selection: deriveSelectedAircraftSummary(context.selectedAircraft || context.aircraft || null, context.selectedAircraftDetails || context.details || null),
      densitySummary: deriveDensityStats(context.density || context),
      enrichmentStatus: deriveEnrichmentStatus(context.enrichment || context),
      viewportDiagnostics: deriveViewportBindingDiagnostics(context.viewport || context),
      replayState: deriveReplayState(context.replay || context, replaySnapshots),
      summary,
      logs: Array.isArray(context.logs) ? context.logs.map((entry) => ({ ...entry })) : [],
      replaySnapshots: replaySnapshots.map((snapshot) => ({ ...snapshot }))
    });
  }
  function formatDebugSummary(summary) {
    const data = summary || {};
    const lines = [];
    lines.push(`Status: ${data.statusLevel || "unknown"} ${data.statusText || ""}`.trim());
    if (data.backoff) {
      lines.push(`Backoff: ${data.backoff.label}`);
    }
    if (data.density) {
      lines.push(`Density: ${data.density.mode} (${data.density.densityLabel})`);
    }
    if (data.selected) {
      lines.push(`Selected: ${data.selected.title}`);
      if (data.selected.subtitle) {
        lines.push(`Selected details: ${data.selected.subtitle}`);
      }
    }
    if (data.enrichment) {
      lines.push(`Enrichment: ${data.enrichment.label}`);
    }
    if (data.viewport) {
      lines.push(`Viewport: ${data.viewport.bound ? "bound" : "unbound"} ${data.viewport.width || 0}x${data.viewport.height || 0}`);
    }
    return lines.filter(Boolean).join("\n");
  }
  function serializeDebugDump(dump) {
    return JSON.stringify(dump, null, 2);
  }
  function parseReplayInput(input) {
    if (Array.isArray(input)) {
      return input;
    }
    if (typeof input === "string") {
      const parsed = safeJsonParse2(input, null);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (parsed && Array.isArray(parsed.snapshots)) {
        return parsed.snapshots;
      }
      return [];
    }
    if (input && Array.isArray(input.snapshots)) {
      return input.snapshots;
    }
    return [];
  }
  function parseReplayPayload(input) {
    const snapshots = parseReplayInput(input);
    const meta = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    return {
      snapshots: snapshots.map((snapshot, index) => normalizeReplaySnapshot(snapshot, index, Date.now())).filter(Boolean),
      replayState: {
        mode: String(meta.mode || meta.replayMode || "imported"),
        imported: true,
        active: true,
        currentIndex: Number.isFinite(Number(meta.currentIndex)) ? Number(meta.currentIndex) : 0
      }
    };
  }
  function normalizeReplaySnapshot(snapshot, index = 0, nowMs = Date.now()) {
    if (!snapshot || typeof snapshot !== "object") {
      return null;
    }
    const timestamp = Number(snapshot.timestamp ?? snapshot.ts ?? nowMs);
    return {
      id: String(snapshot.id || snapshot.key || `snapshot-${index}`),
      label: String(snapshot.label || snapshot.name || `Snapshot ${index + 1}`),
      timestamp: Number.isFinite(timestamp) ? timestamp : nowMs,
      aircraftCount: Number.isFinite(Number(snapshot.aircraftCount)) ? Number(snapshot.aircraftCount) : Array.isArray(snapshot.aircraft) ? snapshot.aircraft.length : 0,
      viewport: snapshot.viewport ? serializeDebugValue(snapshot.viewport, 0) : null,
      mapState: snapshot.mapState ? serializeDebugValue(snapshot.mapState, 0) : null,
      selectedAircraft: snapshot.selectedAircraft ? serializeDebugValue(snapshot.selectedAircraft, 0) : null,
      enrichment: snapshot.enrichment ? serializeDebugValue(snapshot.enrichment, 0) : null,
      density: snapshot.density ? serializeDebugValue(snapshot.density, 0) : null,
      payload: snapshot.payload !== void 0 ? serializeDebugValue(snapshot.payload, 0) : serializeDebugValue(snapshot, 0)
    };
  }
  function captureReplaySnapshot(source, meta = {}) {
    const nowMs = Number(meta.nowMs || Date.now());
    const snapshot = typeof source === "function" ? source() : source;
    const normalized = normalizeReplaySnapshot(snapshot, meta.index || 0, nowMs);
    if (!normalized) {
      return null;
    }
    return Object.freeze({
      ...normalized,
      source: String(meta.source || snapshot.source || "capture"),
      capturedAt: nowMs
    });
  }
  function createReplayPlayback(input = {}) {
    const parsed = parseReplayPayload(input);
    const snapshots = parsed.snapshots.slice();
    let index = Math.min(Math.max(Number(parsed.replayState.currentIndex || 0), 0), Math.max(0, snapshots.length - 1));
    return Object.freeze({
      get snapshots() {
        return snapshots.slice();
      },
      get index() {
        return index;
      },
      get current() {
        return snapshots[index] || null;
      },
      next() {
        if (index < snapshots.length - 1) {
          index += 1;
        }
        return snapshots[index] || null;
      },
      previous() {
        if (index > 0) {
          index -= 1;
        }
        return snapshots[index] || null;
      },
      reset(nextIndex = 0) {
        index = Math.min(Math.max(Number(nextIndex) || 0, 0), Math.max(0, snapshots.length - 1));
        return snapshots[index] || null;
      },
      toReplayState() {
        return {
          ...parsed.replayState,
          currentIndex: index,
          totalSnapshots: snapshots.length,
          currentSnapshotId: snapshots[index] ? snapshots[index].id || null : null
        };
      }
    });
  }
  function createDebugStore(options = {}) {
    let currentLevel = normalizeDebugLevel(options.level);
    const logBufferSize = Math.max(1, Number(options.logBufferSize || DEFAULT_LOG_BUFFER_SIZE));
    const replayBufferSize = Math.max(1, Number(options.replayBufferSize || DEFAULT_REPLAY_BUFFER_SIZE));
    const logs = [];
    const replaySnapshots = [];
    function pushLog(entry) {
      logs.push(entry);
      if (logs.length > logBufferSize) {
        logs.splice(0, logs.length - logBufferSize);
      }
      if (typeof options.onLog === "function") {
        options.onLog(entry);
      }
    }
    function record(levelName, message, details, meta = {}) {
      if (!shouldRecord(currentLevel, levelName)) {
        return null;
      }
      const entry = Object.freeze({
        ts: new Date(meta.nowMs || Date.now()).toISOString(),
        level: normalizeLogLevel(levelName),
        message: String(message || ""),
        category: meta.category || null,
        details: details === void 0 ? null : serializeDebugValue(details, 0)
      });
      pushLog(entry);
      return entry;
    }
    function recordReplay(source, meta = {}) {
      const captured = captureReplaySnapshot(source, meta);
      if (!captured) {
        return null;
      }
      replaySnapshots.push(captured);
      if (replaySnapshots.length > replayBufferSize) {
        replaySnapshots.splice(0, replaySnapshots.length - replayBufferSize);
      }
      return captured;
    }
    function buildExport(context = {}) {
      const summary = summarizeDebugContext({
        ...context,
        level: currentLevel,
        logs,
        replaySnapshots
      });
      return Object.freeze({
        generatedAt: new Date(context.nowMs || Date.now()).toISOString(),
        level: currentLevel,
        summary,
        logs: logs.map((entry) => ({ ...entry })),
        replaySnapshots: replaySnapshots.map((snapshot) => ({ ...snapshot })),
        context: serializeDebugValue(context, 0)
      });
    }
    function buildSummary(context = {}) {
      return summarizeDebugContext({
        ...context,
        level: currentLevel,
        logs,
        replaySnapshots
      });
    }
    return Object.freeze({
      get level() {
        return currentLevel;
      },
      get logs() {
        return logs.slice();
      },
      get replaySnapshots() {
        return replaySnapshots.slice();
      },
      setLevel(nextLevel) {
        currentLevel = normalizeDebugLevel(nextLevel);
        return currentLevel;
      },
      getLevel() {
        return currentLevel;
      },
      isEnabled(nextLevel = DEBUG_LEVELS.BASIC) {
        return shouldRecord(currentLevel, nextLevel);
      },
      log: record,
      trace(message, details, meta) {
        return record("trace", message, details, meta);
      },
      debug(message, details, meta) {
        return record("debug", message, details, meta);
      },
      info(message, details, meta) {
        return record("info", message, details, meta);
      },
      warn(message, details, meta) {
        return record("warn", message, details, meta);
      },
      error(message, details, meta) {
        return record("error", message, details, meta);
      },
      clearLogs() {
        logs.length = 0;
      },
      captureReplaySnapshot: recordReplay,
      importReplaySnapshots(input) {
        const list = parseReplayInput(input);
        const normalized = [];
        list.forEach((snapshot, index) => {
          const next = normalizeReplaySnapshot(snapshot, index, Date.now());
          if (next) {
            normalized.push(next);
          }
        });
        replaySnapshots.length = 0;
        replaySnapshots.push(...normalized.slice(-replayBufferSize));
        return replaySnapshots.slice();
      },
      exportReplaySnapshots() {
        return serializeDebugDump({
          generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
          level: currentLevel,
          snapshots: replaySnapshots.slice()
        });
      },
      buildExport,
      buildSummary,
      buildSummaryText(context = {}) {
        return formatDebugSummary(buildSummary(context));
      }
    });
  }
  function createDebugService(context = {}) {
    const store = createDebugStore({
      level: context.level ?? context.debugLevel,
      logBufferSize: context.logBufferSize,
      replayBufferSize: context.replayBufferSize,
      onLog: context.onLog
    });
    let runtimeContext = { ...context };
    function mergeContext(nextContext = {}) {
      runtimeContext = {
        ...runtimeContext,
        ...nextContext
      };
      return runtimeContext;
    }
    function buildContext(overrides = {}) {
      return {
        ...runtimeContext,
        ...overrides,
        level: store.getLevel(),
        logs: store.logs,
        replaySnapshots: store.replaySnapshots
      };
    }
    return Object.freeze({
      store,
      setLevel(nextLevel) {
        return store.setLevel(nextLevel);
      },
      getLevel() {
        return store.getLevel();
      },
      mergeContext,
      getContext() {
        return { ...runtimeContext };
      },
      log: store.log,
      trace: store.trace,
      debug: store.debug,
      info: store.info,
      warn: store.warn,
      error: store.error,
      clearLogs: store.clearLogs,
      captureReplaySnapshot(source, meta = {}) {
        return store.captureReplaySnapshot(source, meta);
      },
      capturePayloadSnapshot(payload, meta = {}) {
        return store.captureReplaySnapshot(payload, meta);
      },
      importReplayPayload(input) {
        const parsed = parseReplayPayload(input);
        store.importReplaySnapshots(parsed.snapshots);
        mergeContext({
          replay: {
            ...runtimeContext.replay || {},
            ...parsed.replayState
          }
        });
        return parsed;
      },
      exportReplayPayload() {
        return {
          generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
          replayState: deriveReplayState(runtimeContext.replay || {}, store.replaySnapshots),
          snapshots: store.replaySnapshots
        };
      },
      createReplayPlayback,
      buildSummary(overrides = {}) {
        return store.buildSummary(buildContext(overrides));
      },
      buildSummaryText(overrides = {}) {
        return store.buildSummaryText(buildContext(overrides));
      },
      buildDebugExport(overrides = {}) {
        return buildDebugExport(buildContext(overrides));
      },
      exportDebug(overrides = {}) {
        return buildDebugExport(buildContext(overrides));
      }
    });
  }

  // src/map.js
  function createMapController(context) {
    const { state, window: window2, document: document2, logEvent, scheduleRender, setStatus } = context;
    function isVisibleElement(element) {
      if (!element || !(element instanceof window2.HTMLElement)) {
        return false;
      }
      if (state.hudRootEl && (element === state.hudRootEl || state.hudRootEl.contains(element))) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width < 280 || rect.height < 280) {
        return false;
      }
      const style = window2.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      return true;
    }
    function scoreViewportCandidate(element) {
      const rect = element.getBoundingClientRect();
      const style = window2.getComputedStyle(element);
      const signalText = `${element.id || ""} ${element.className || ""} ${element.getAttribute("role") || ""} ${element.getAttribute("aria-label") || ""}`.toLowerCase();
      let score = rect.width * rect.height;
      if (signalText.includes("scene")) {
        score += 1e6;
      }
      if (signalText.includes("map")) {
        score += 6e5;
      }
      if (signalText.includes("widget")) {
        score += 25e4;
      }
      if (signalText.includes("globe")) {
        score += 15e4;
      }
      if (element.querySelector("canvas, img, svg")) {
        score += 25e4;
      }
      if (style.overflow === "hidden" || style.overflowX === "hidden" || style.overflowY === "hidden") {
        score += 1e5;
      }
      if (rect.right >= window2.innerWidth - 8) {
        score += 8e4;
      }
      if (rect.bottom >= window2.innerHeight - 8) {
        score += 6e4;
      }
      if (rect.left > 0) {
        score += 4e4;
      }
      if (rect.left >= window2.innerWidth * 0.1) {
        score += 4e4;
      }
      if (rect.width === window2.innerWidth && rect.height === window2.innerHeight) {
        score -= 18e4;
      }
      return score;
    }
    function findViewportElement() {
      const preferredSelectors = [
        "#scene",
        ".widget-scene",
        "div[aria-label*='Map']",
        "div[aria-label*='Satellite']",
        "div[role='main']",
        "main"
      ];
      for (const selector of preferredSelectors) {
        const element = document2.querySelector(selector);
        if (isVisibleElement(element)) {
          return element;
        }
      }
      const candidates = document2.querySelectorAll("div, main, section");
      let bestElement = null;
      let bestScore = -Infinity;
      for (const element of candidates) {
        if (!isVisibleElement(element)) {
          continue;
        }
        const score = scoreViewportCandidate(element);
        if (score > bestScore) {
          bestScore = score;
          bestElement = element;
        }
      }
      return bestElement;
    }
    function updateViewportRect() {
      if (!state.viewportEl || !state.viewportEl.isConnected) {
        state.viewportRect = null;
        return false;
      }
      const rect = state.viewportEl.getBoundingClientRect();
      if (rect.width < 280 || rect.height < 280) {
        state.viewportRect = null;
        return false;
      }
      const nextRect = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      };
      const prevRect = state.viewportRect;
      state.viewportRect = nextRect;
      return !prevRect || prevRect.left !== nextRect.left || prevRect.top !== nextRect.top || prevRect.width !== nextRect.width || prevRect.height !== nextRect.height;
    }
    function refreshViewportBinding(reason = "refresh") {
      const now = Date.now();
      if (now - state.lastViewportScanAt < APP_CONFIG.domWatchDebounceMs && reason !== "force") {
        return;
      }
      state.lastViewportScanAt = now;
      const nextViewportEl = findViewportElement();
      if (!nextViewportEl) {
        if (state.viewportEl) {
          logEvent("warn", "Lost Google Maps viewport element");
        }
        state.viewportEl = null;
        state.viewportRect = null;
        setStatus("warn", "Waiting for Google Maps viewport");
        scheduleRender();
        return;
      }
      const changed = nextViewportEl !== state.viewportEl;
      state.viewportEl = nextViewportEl;
      const rectChanged = updateViewportRect();
      if (changed || rectChanged) {
        const viewportKey = `${Math.round(state.viewportRect ? state.viewportRect.left : 0)}:${Math.round(state.viewportRect ? state.viewportRect.top : 0)}:${Math.round(state.viewportRect ? state.viewportRect.width : 0)}:${Math.round(state.viewportRect ? state.viewportRect.height : 0)}`;
        if (changed || viewportKey !== state.lastLoggedViewportKey) {
          state.lastLoggedViewportKey = viewportKey;
          logEvent("info", "Bound overlay to viewport", {
            changed,
            rect: state.viewportRect,
            id: nextViewportEl.id || null,
            className: nextViewportEl.className || null
          });
        }
        if (!state.mapState) {
          setStatus("warn", "Viewport found, waiting for readable map URL");
        }
        scheduleRender();
      }
    }
    function scheduleViewportRefresh() {
      if (state.pendingViewportRefresh) {
        window2.clearTimeout(state.pendingViewportRefresh);
      }
      state.pendingViewportRefresh = window2.setTimeout(() => {
        state.pendingViewportRefresh = 0;
        refreshViewportBinding("force");
      }, APP_CONFIG.domWatchDebounceMs);
    }
    function kickInteractionRender(reason = "interaction") {
      const now = Date.now();
      state.lastMapInteractionAt = now;
      state.interactionRenderUntil = Math.max(
        state.interactionRenderUntil,
        now + APP_CONFIG.interactionRenderDurationMs
      );
      if (state.interactionFrameHandle) {
        return;
      }
      const tick = () => {
        state.interactionFrameHandle = 0;
        if (Date.now() >= state.interactionRenderUntil) {
          return;
        }
        syncMapStateFromUrl();
        if (!state.viewportEl || !state.viewportEl.isConnected) {
          refreshViewportBinding("force");
        } else {
          updateViewportRect();
        }
        scheduleRender();
        state.interactionFrameHandle = window2.requestAnimationFrame(tick);
      };
      logEvent("debug", "Starting interaction render loop", { reason });
      state.interactionFrameHandle = window2.requestAnimationFrame(tick);
    }
    function parseMapStateFromUrl(href) {
      const zoomMatch = href.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/i);
      if (zoomMatch) {
        const centerLat2 = Number(zoomMatch[1]);
        const centerLon2 = Number(zoomMatch[2]);
        const zoom2 = Number(zoomMatch[3]);
        if (!Number.isFinite(centerLat2) || !Number.isFinite(centerLon2) || !Number.isFinite(zoom2)) {
          return null;
        }
        return {
          centerLat: centerLat2,
          centerLon: centerLon2,
          zoom: zoom2,
          zoomSource: "zoom",
          scaleMeters: null
        };
      }
      const meterMatch = href.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)m/i);
      if (!meterMatch) {
        return null;
      }
      const centerLat = Number(meterMatch[1]);
      const centerLon = Number(meterMatch[2]);
      const scaleMeters = Number(meterMatch[3]);
      const viewportHeight = Math.max(
        1,
        Math.round(
          state.viewportRect && state.viewportRect.height || window2.innerHeight || document2.documentElement.clientHeight || 900
        )
      );
      const zoom = Math.log2(
        Math.cos(centerLat * DEG_TO_RAD) * WORLD_RESOLUTION_MPP * viewportHeight / scaleMeters
      );
      if (!Number.isFinite(centerLat) || !Number.isFinite(centerLon) || !Number.isFinite(scaleMeters) || scaleMeters <= 0 || !Number.isFinite(zoom)) {
        return null;
      }
      return {
        centerLat,
        centerLon,
        zoom: clamp(zoom, 0, 22),
        zoomSource: "meters-estimate",
        scaleMeters
      };
    }
    function syncMapStateFromUrl() {
      const nextHref = window2.location.href;
      const hrefChanged = nextHref !== state.lastLocationHref;
      state.lastLocationHref = nextHref;
      const prevMapState = state.mapState;
      const nextMapState = parseMapStateFromUrl(nextHref);
      if (!nextMapState) {
        state.mapState = null;
        const pauseReason = "url-unreadable";
        if (state.lastPauseReason !== pauseReason) {
          state.lastPauseReason = pauseReason;
          logEvent("warn", "Paused because URL does not expose @lat,lon,zoomz or @lat,lon,metersm", {
            href: nextHref
          });
        }
        if (state.viewportEl) {
          setStatus("warn", "Paused: map URL does not expose zoom data");
        }
        if (prevMapState || hrefChanged) {
          scheduleRender();
        }
        return hrefChanged;
      }
      state.mapState = nextMapState;
      state.lastPauseReason = "";
      const changed = !prevMapState || prevMapState.centerLat !== nextMapState.centerLat || prevMapState.centerLon !== nextMapState.centerLon || prevMapState.zoom !== nextMapState.zoom;
      const mapStateKey = `${nextMapState.centerLat.toFixed(6)},${nextMapState.centerLon.toFixed(6)},${nextMapState.zoom.toFixed(2)}`;
      if ((changed || hrefChanged) && mapStateKey !== state.lastLoggedMapStateKey) {
        state.lastLoggedMapStateKey = mapStateKey;
        logEvent("info", "Parsed map state from URL", nextMapState);
      }
      if (changed) {
        scheduleRender();
      }
      return hrefChanged || changed;
    }
    return {
      findViewportElement,
      updateViewportRect,
      refreshViewportBinding,
      scheduleViewportRefresh,
      kickInteractionRender,
      parseMapStateFromUrl,
      syncMapStateFromUrl,
      metersPerPixel,
      deriveQueryRadiusNm,
      latLonToWorld,
      projectToViewport
    };
  }
  function metersPerPixel(latitude, zoom) {
    return Math.cos(latitude * DEG_TO_RAD) * WORLD_RESOLUTION_MPP / Math.pow(2, zoom);
  }
  function deriveQueryRadiusNm(mapState, viewportRect) {
    const diagonalPx = Math.hypot(viewportRect.width, viewportRect.height);
    const resolution = metersPerPixel(mapState.centerLat, mapState.zoom);
    const radiusMeters = diagonalPx * 0.5 * resolution * 1.15;
    const radiusNm = radiusMeters / 1852;
    return clamp(Math.ceil(radiusNm), APP_CONFIG.minQueryRadiusNm, APP_CONFIG.maxQueryRadiusNm);
  }
  function latLonToWorld(lat, lon, zoom) {
    const scale = TILE_SIZE * Math.pow(2, zoom);
    const sinLat = clamp(Math.sin(lat * DEG_TO_RAD), -0.9999, 0.9999);
    return {
      x: (lon + 180) / 360 * scale,
      y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
      worldSize: scale
    };
  }
  function projectToViewport(mapState, viewportRect, lat, lon) {
    const centerWorld = latLonToWorld(mapState.centerLat, mapState.centerLon, mapState.zoom);
    const pointWorld = latLonToWorld(lat, lon, mapState.zoom);
    let dx = pointWorld.x - centerWorld.x;
    if (dx > centerWorld.worldSize / 2) {
      dx -= centerWorld.worldSize;
    } else if (dx < -centerWorld.worldSize / 2) {
      dx += centerWorld.worldSize;
    }
    const dy = pointWorld.y - centerWorld.y;
    return {
      x: viewportRect.width / 2 + dx,
      y: viewportRect.height / 2 + dy
    };
  }

  // src/data/live.js
  async function requestJson(url, options = {}) {
    const {
      accept = "application/json",
      timeoutMs = APP_CONFIG.fetchTimeoutMs,
      logEvent,
      label = "Requesting JSON"
    } = options;
    if (typeof logEvent === "function") {
      logEvent("debug", label, { url });
    }
    const response = await GM.xmlHttpRequest({
      method: "GET",
      url,
      timeout: timeoutMs,
      headers: {
        Accept: accept
      }
    });
    if (!response || response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response ? response.status : "request_failed"}`);
    }
    return JSON.parse(response.responseText);
  }
  function deriveUpdatedAtMs(record, nowSec) {
    const seenPos = firstFiniteNumber(record.seen_pos, record.seen);
    if (isFiniteNumber(nowSec) && isFiniteNumber(seenPos)) {
      return Math.round((nowSec - seenPos) * 1e3);
    }
    if (isFiniteNumber(nowSec)) {
      return Math.round(nowSec * 1e3);
    }
    return Date.now();
  }
  function normalizeAircraft(payload) {
    const nowSec = toFiniteNumber(payload.now);
    const records = Array.isArray(payload.ac) ? payload.ac : Array.isArray(payload.aircraft) ? payload.aircraft : [];
    const normalized = [];
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const lat = firstFiniteNumber(record.lat, record.lastPosition && record.lastPosition.lat);
      const lon = firstFiniteNumber(record.lon, record.lastPosition && record.lastPosition.lon);
      if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) {
        continue;
      }
      const rawAltitude = record.alt_baro;
      const onGround = rawAltitude === "ground";
      const altitudeFt = onGround ? 0 : firstFiniteNumber(rawAltitude, record.alt_geom);
      normalized.push({
        id: cleanText(record.hex) || `aircraft-${index}`,
        lat,
        lon,
        heading: firstFiniteNumber(record.track, record.true_heading, record.mag_heading, record.nav_heading),
        altitudeFt,
        callsign: cleanText(record.flight) || cleanText(record.r) || null,
        registration: cleanText(record.r),
        aircraftType: cleanText(record.t),
        speedKt: firstFiniteNumber(record.gs, record.tas, record.ias),
        source: cleanText(record.type) || "airplanes.live",
        updatedAt: deriveUpdatedAtMs(record, nowSec),
        onGround
      });
    }
    return normalized;
  }
  function buildRequestUrl(mapState, viewportRect) {
    if (!mapState || !viewportRect) {
      return null;
    }
    const radiusNm = deriveQueryRadiusNm(mapState, viewportRect);
    return {
      radiusNm,
      url: `https://api.airplanes.live/v2/point/${mapState.centerLat.toFixed(6)}/${mapState.centerLon.toFixed(6)}/${radiusNm}`
    };
  }
  function createLiveDataController(context) {
    const {
      state,
      document: document2,
      logEvent,
      setStatus,
      scheduleRender,
      onAircraftData,
      onFetchError
    } = context;
    async function maybeFetchAircraft() {
      if (state.replayMode || document2.hidden || state.isFetching || !state.mapState || !state.viewportRect) {
        return;
      }
      const now = Date.now();
      if (now < state.rateLimitBackoffUntil) {
        return;
      }
      if (now - state.lastMapInteractionAt < APP_CONFIG.interactionSettleDelayMs) {
        return;
      }
      if (now < state.nextFetchDueAt) {
        return;
      }
      if (now - state.lastFetchStartedAt < APP_CONFIG.minFetchGapMs) {
        state.nextFetchDueAt = state.lastFetchStartedAt + APP_CONFIG.minFetchGapMs;
        return;
      }
      const request = buildRequestUrl(state.mapState, state.viewportRect);
      if (!request) {
        return;
      }
      state.isFetching = true;
      state.lastFetchStartedAt = now;
      logEvent("info", "Starting flight data refresh", request);
      setStatus("warn", `Fetching ${request.radiusNm}nm`);
      try {
        const payload = await requestJson(request.url, {
          logEvent,
          label: "Requesting flight data"
        });
        const aircraft = normalizeAircraft(payload);
        const previousMap = state.aircraftById;
        const nextMap = new Map(aircraft.map((entry) => [entry.id, entry]));
        state.previousAircraftById = previousMap;
        state.aircraftById = nextMap;
        state.aircraft = aircraft;
        state.snapshotSequence += 1;
        state.lastSuccessAt = Date.now();
        state.lastFetchCompletedAt = state.lastSuccessAt;
        state.lastError = "";
        state.lastBackoffMessage = "";
        state.rateLimitBackoffUntil = 0;
        state.nextFetchDueAt = Date.now() + APP_CONFIG.refreshIntervalMs;
        state.lastFetchSummary = {
          ok: true,
          fetchedAt: state.lastSuccessAt,
          radiusNm: request.radiusNm,
          aircraftCount: aircraft.length,
          url: request.url,
          source: "airplanes.live"
        };
        logEvent("info", "Flight data refresh succeeded", {
          radiusNm: request.radiusNm,
          aircraftCount: aircraft.length
        });
        if (typeof onAircraftData === "function") {
          await onAircraftData({
            aircraft,
            payload,
            request,
            previousAircraftById: previousMap,
            nextAircraftById: nextMap,
            fetchedAt: state.lastSuccessAt
          });
        }
        setStatus("ok", `Live: ${aircraft.length} aircraft from Airplanes.live`);
        scheduleRender();
      } catch (error) {
        state.lastFetchCompletedAt = Date.now();
        state.lastError = error instanceof Error ? error.message : String(error);
        const isRateLimited = state.lastError.includes("429");
        state.rateLimitBackoffUntil = isRateLimited ? Date.now() + APP_CONFIG.rateLimitBackoffMs : 0;
        state.nextFetchDueAt = Date.now() + (isRateLimited ? APP_CONFIG.rateLimitBackoffMs : APP_CONFIG.refreshIntervalMs);
        state.lastBackoffMessage = isRateLimited ? "Rate limited, backing off before next refresh" : "";
        state.lastFetchSummary = {
          ok: false,
          fetchedAt: state.lastFetchCompletedAt,
          radiusNm: request.radiusNm,
          aircraftCount: state.aircraft.length,
          url: request.url,
          source: "airplanes.live",
          error: state.lastError,
          rateLimited: isRateLimited,
          backoffUntil: state.rateLimitBackoffUntil || null
        };
        logEvent("error", "Flight data refresh failed", error);
        if (!isRateLimited && Date.now() - state.lastSuccessAt > APP_CONFIG.refreshIntervalMs * 2) {
          state.aircraft = [];
        }
        if (typeof onFetchError === "function") {
          onFetchError(error, {
            isRateLimited,
            request,
            nextFetchDueAt: state.nextFetchDueAt,
            backoffUntil: state.rateLimitBackoffUntil
          });
        }
        setStatus(
          "error",
          isRateLimited ? "Rate limited, backing off before next refresh" : "Fetch failed, showing last good frame"
        );
        scheduleRender();
      } finally {
        state.isFetching = false;
      }
    }
    return {
      maybeFetchAircraft,
      buildRequestUrl,
      normalizeAircraft,
      requestJson
    };
  }

  // src/data/airportFallback.js
  var COMPACT_AIRPORT_NAME_BY_CODE = Object.freeze({
    ATL: "Hartsfield-Jackson Atlanta International Airport",
    ORD: "Chicago O'Hare International Airport",
    DFW: "Dallas/Fort Worth International Airport",
    DEN: "Denver International Airport",
    LAX: "Los Angeles International Airport",
    JFK: "John F. Kennedy International Airport",
    SFO: "San Francisco International Airport",
    SEA: "Seattle-Tacoma International Airport",
    MIA: "Miami International Airport",
    LAS: "Harry Reid International Airport",
    PHX: "Phoenix Sky Harbor International Airport",
    BOS: "Boston Logan International Airport",
    IAH: "George Bush Intercontinental Airport",
    CLT: "Charlotte Douglas International Airport",
    MSP: "Minneapolis-Saint Paul International Airport",
    DTW: "Detroit Metropolitan Airport",
    EWR: "Newark Liberty International Airport",
    IAD: "Washington Dulles International Airport",
    DCA: "Ronald Reagan Washington National Airport",
    SAN: "San Diego International Airport",
    BNA: "Nashville International Airport",
    TPA: "Tampa International Airport",
    FLL: "Fort Lauderdale-Hollywood International Airport",
    PHL: "Philadelphia International Airport",
    STL: "St. Louis Lambert International Airport",
    PDX: "Portland International Airport",
    HNL: "Daniel K. Inouye International Airport",
    HOU: "William P. Hobby Airport",
    SJC: "Norman Y. Mineta San Jose International Airport",
    OAK: "Oakland International Airport",
    SMF: "Sacramento International Airport",
    AUS: "Austin-Bergstrom International Airport",
    SAT: "San Antonio International Airport",
    DAL: "Dallas Love Field",
    MDW: "Chicago Midway International Airport",
    LGA: "LaGuardia Airport",
    MCO: "Orlando International Airport",
    RDU: "Raleigh-Durham International Airport",
    SNA: "John Wayne Airport",
    BWI: "Baltimore/Washington International Thurgood Marshall Airport",
    SLC: "Salt Lake City International Airport",
    CVG: "Cincinnati/Northern Kentucky International Airport",
    IND: "Indianapolis International Airport",
    CMH: "John Glenn Columbus International Airport",
    CLE: "Cleveland Hopkins International Airport",
    PIT: "Pittsburgh International Airport",
    BUF: "Buffalo Niagara International Airport",
    ORF: "Norfolk International Airport",
    TUL: "Tulsa International Airport",
    OKC: "Will Rogers World Airport",
    MEM: "Memphis International Airport",
    BHM: "Birmingham-Shuttlesworth International Airport",
    JAX: "Jacksonville International Airport",
    RSW: "Southwest Florida International Airport",
    PBI: "Palm Beach International Airport",
    CHS: "Charleston International Airport",
    SAV: "Savannah/Hilton Head International Airport",
    SDF: "Louisville Muhammad Ali International Airport",
    MKE: "Milwaukee Mitchell International Airport",
    OMA: "Eppley Airfield",
    TUS: "Tucson International Airport",
    ABQ: "Albuquerque International Sunport",
    BOI: "Boise Airport",
    ANC: "Ted Stevens Anchorage International Airport",
    RNO: "Reno-Tahoe International Airport",
    KOA: "Ellison Onizuka Kona International Airport at Keahole",
    LIH: "Lihue Airport",
    OGG: "Kahului Airport",
    HKG: "Hong Kong International Airport",
    NRT: "Narita International Airport",
    HND: "Haneda Airport",
    ICN: "Incheon International Airport",
    SIN: "Singapore Changi Airport",
    DXB: "Dubai International Airport",
    DOH: "Hamad International Airport",
    FRA: "Frankfurt Airport",
    MUC: "Munich Airport",
    CDG: "Charles de Gaulle Airport",
    AMS: "Amsterdam Airport Schiphol",
    LHR: "Heathrow Airport",
    LGW: "London Gatwick Airport",
    MAN: "Manchester Airport",
    DUB: "Dublin Airport",
    ZRH: "Zurich Airport",
    VIE: "Vienna International Airport",
    MAD: "Adolfo Suarez Madrid-Barajas Airport",
    BCN: "Barcelona-El Prat Airport",
    FCO: "Leonardo da Vinci-Fiumicino Airport",
    MXP: "Milan Malpensa Airport",
    ARN: "Stockholm Arlanda Airport",
    CPH: "Copenhagen Airport",
    OSL: "Oslo Airport",
    HEL: "Helsinki Airport",
    IST: "Istanbul Airport",
    DEL: "Indira Gandhi International Airport",
    BOM: "Chhatrapati Shivaji Maharaj International Airport",
    BLR: "Kempegowda International Airport",
    KUL: "Kuala Lumpur International Airport",
    BKK: "Suvarnabhumi Airport",
    SYD: "Sydney Airport",
    MEL: "Melbourne Airport",
    AKL: "Auckland Airport",
    PER: "Perth Airport",
    CPT: "Cape Town International Airport",
    JNB: "O. R. Tambo International Airport",
    GRU: "Sao Paulo/Guarulhos International Airport",
    GIG: "Rio de Janeiro/Galeao International Airport",
    EZE: "Ministro Pistarini International Airport",
    SCL: "Santiago International Airport",
    EGLL: "Heathrow Airport",
    EHAM: "Amsterdam Airport Schiphol",
    LFPG: "Charles de Gaulle Airport",
    EDDF: "Frankfurt Airport",
    EDDM: "Munich Airport",
    LFPO: "Paris Orly Airport",
    LFLL: "Lyon-Saint Exupery Airport",
    EBBR: "Brussels Airport",
    EGKK: "London Gatwick Airport",
    LIRF: "Leonardo da Vinci-Fiumicino Airport",
    LEBL: "Barcelona-El Prat Airport",
    LEMD: "Adolfo Suarez Madrid-Barajas Airport",
    LSZH: "Zurich Airport",
    LOWW: "Vienna International Airport",
    ENGM: "Oslo Airport",
    EFHK: "Helsinki Airport",
    EKCH: "Copenhagen Airport",
    OMDB: "Dubai International Airport",
    VTBS: "Suvarnabhumi Airport",
    WSSS: "Singapore Changi Airport",
    RJAA: "Narita International Airport",
    RJTT: "Haneda Airport",
    RKSI: "Incheon International Airport",
    YSSY: "Sydney Airport",
    YMML: "Melbourne Airport",
    NZAA: "Auckland Airport",
    FAOR: "O. R. Tambo International Airport",
    SBGR: "Sao Paulo/Guarulhos International Airport",
    SBGL: "Rio de Janeiro/Galeao International Airport",
    SAEZ: "Ministro Pistarini International Airport",
    SCEL: "Santiago International Airport"
  });
  function normalizeAirportCode(value) {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return normalized === "" ? null : normalized;
  }
  function pickAirportNameFromCode(code, airportNameByCode) {
    if (!code) {
      return null;
    }
    if (airportNameByCode[code]) {
      return airportNameByCode[code];
    }
    if (code.length === 4 && code.startsWith("K")) {
      const suffix = code.slice(1);
      if (airportNameByCode[suffix]) {
        return airportNameByCode[suffix];
      }
    }
    return null;
  }
  function cleanLabel(value) {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim();
    return normalized === "" ? null : normalized;
  }
  function createAirportResolver(extraCodeMap = {}) {
    const airportNameByCode = {
      ...COMPACT_AIRPORT_NAME_BY_CODE
    };
    for (const [key, value] of Object.entries(extraCodeMap || {})) {
      const normalizedKey = normalizeAirportCode(key);
      if (normalizedKey && typeof value === "string") {
        airportNameByCode[normalizedKey] = value;
      }
    }
    return function resolveAirportReference2(airport, role = "") {
      if (!airport && !role) {
        return null;
      }
      const iataCode = normalizeAirportCode(
        airport && typeof airport === "object" ? airport.iataCode || airport.iata_code || airport.iata : airport
      );
      const icaoCode = normalizeAirportCode(
        airport && typeof airport === "object" ? airport.icaoCode || airport.icao_code || airport.icao : null
      );
      const code = iataCode || icaoCode;
      const suppliedName = airport && typeof airport === "object" ? airport.name : null;
      const suppliedMunicipality = airport && typeof airport === "object" ? airport.municipality : null;
      const airportName = cleanLabel(suppliedName);
      const municipality = cleanLabel(suppliedMunicipality);
      const mappedName = pickAirportNameFromCode(code || icaoCode, airportNameByCode);
      const resolvedName = airportName || mappedName;
      if (!code && !resolvedName && !municipality) {
        return null;
      }
      const displayName = resolvedName || municipality || role || code || null;
      const label = displayName && code ? `${displayName} (${code})` : displayName || code || null;
      return {
        code,
        iataCode,
        icaoCode,
        name: resolvedName || null,
        municipality,
        displayName: resolvedName || municipality || null,
        label,
        source: airportName ? "input" : mappedName ? "mapped" : "input",
        role: role || null
      };
    };
  }
  var AIRPORT_NAME_BY_CODE = Object.freeze({
    ...COMPACT_AIRPORT_NAME_BY_CODE
  });
  var DEFAULT_AIRPORT_RESOLVER = createAirportResolver();
  function resolveAirportReference(airport, role = "") {
    return DEFAULT_AIRPORT_RESOLVER(airport, role);
  }

  // src/data/enrichment.js
  var ADSBDB_API_BASE_URL = "https://api.adsbdb.com/v0";
  var ADSBL_API_BASE_URL = "https://api.adsb.lol/v2";
  var SELECTED_AIRCRAFT_DETAILS_CACHE_VERSION = 1;
  var DEFAULT_SELECTED_AIRCRAFT_DETAILS_STORAGE_KEY = "gm-flight-overlay:selected-aircraft-details-cache:v1";
  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
  function cleanText2(value) {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim();
    return normalized === "" ? null : normalized;
  }
  function cleanLookupKeyPart(value) {
    const text = cleanText2(value);
    return text ? text.replace(/\s+/g, "").toUpperCase() : null;
  }
  function toAirportField(value) {
    if (!value) {
      return null;
    }
    if (typeof value === "string") {
      return {
        name: null,
        municipality: null,
        iataCode: null,
        icaoCode: null,
        code: cleanLookupKeyPart(value),
        source: "string",
        raw: value
      };
    }
    if (!isObject(value)) {
      return null;
    }
    return {
      name: cleanText2(value.name),
      municipality: cleanText2(value.municipality),
      iataCode: cleanLookupKeyPart(value.iataCode || value.iata_code || value.iata),
      icaoCode: cleanLookupKeyPart(value.icaoCode || value.icao_code || value.icao),
      code: cleanLookupKeyPart(
        value.iataCode || value.iata_code || value.iata || value.icaoCode || value.icao_code || value.icao
      ),
      source: cleanText2(value.source) || null,
      raw: value
    };
  }
  function pickText(...values) {
    for (const value of values) {
      const text = cleanText2(value);
      if (text) {
        return text;
      }
    }
    return null;
  }
  function cloneDetails(details) {
    if (!details) {
      return null;
    }
    return JSON.parse(JSON.stringify(details));
  }
  function nowMsFrom(now) {
    return typeof now === "function" ? now() : Date.now();
  }
  function buildAircraftDetailsLookup(aircraft, options = {}) {
    if (!aircraft) {
      return null;
    }
    const modeS = cleanLookupKeyPart(aircraft.id || aircraft.hex);
    const registration = cleanLookupKeyPart(aircraft.registration);
    const identifier = /^[0-9A-F]{6}$/.test(modeS || "") ? modeS : registration;
    if (!identifier) {
      return null;
    }
    const callsign = cleanLookupKeyPart(aircraft.callsign);
    const lookupKey = `${identifier}|${callsign || ""}`;
    return {
      lookupKey,
      identifier,
      callsign,
      adsbdbUrl: buildAdsbdbLookupUrl(identifier, callsign, options),
      adsblolCandidates: buildAdsblolLookupCandidates({ identifier, callsign }, options)
    };
  }
  function buildAdsbdbLookupUrl(identifier, callsign = null, options = {}) {
    const baseUrl = cleanText2(options.baseUrl) || ADSBDB_API_BASE_URL;
    const encodedIdentifier = encodeURIComponent(identifier);
    const baseUrlPath = `${baseUrl}/aircraft/${encodedIdentifier}`;
    if (!callsign) {
      return baseUrlPath;
    }
    return `${baseUrlPath}?callsign=${encodeURIComponent(callsign)}`;
  }
  function buildAdsblolLookupCandidates(lookup, options = {}) {
    const baseUrl = cleanText2(options.baseUrl) || ADSBL_API_BASE_URL;
    const identifier = cleanLookupKeyPart(lookup && lookup.identifier);
    const callsign = cleanLookupKeyPart(lookup && lookup.callsign);
    const candidates = [];
    if (callsign) {
      candidates.push(`${baseUrl}/callsign/${encodeURIComponent(callsign)}`);
      candidates.push(`${baseUrl}/route/${encodeURIComponent(callsign)}`);
      candidates.push(`${baseUrl}/flight/${encodeURIComponent(callsign)}`);
    }
    if (identifier) {
      candidates.push(`${baseUrl}/aircraft/${encodeURIComponent(identifier)}`);
      candidates.push(`${baseUrl}/hex/${encodeURIComponent(identifier)}`);
    }
    return [...new Set(candidates)];
  }
  function createEmptyAircraftDetails(lookupKey = null, now = Date.now) {
    return {
      lookupKey: cleanText2(lookupKey),
      fetchedAt: nowMsFrom(now),
      source: "unknown",
      routeAdvisory: false,
      photoMode: "enabled",
      registration: null,
      manufacturer: null,
      type: null,
      icaoType: null,
      owner: null,
      airlineName: null,
      airlineIcao: null,
      airlineIata: null,
      airlineCallsign: null,
      photoUrl: null,
      photoThumbnailUrl: null,
      photoSource: null,
      routeSource: null,
      origin: null,
      destination: null,
      notes: [],
      aircraft: {
        registration: null,
        manufacturer: null,
        type: null,
        icaoType: null,
        owner: null
      },
      route: {
        airlineName: null,
        airlineIcao: null,
        airlineIata: null,
        airlineCallsign: null,
        origin: null,
        destination: null
      }
    };
  }
  function normalizeAirportEndpoint2(value, role, context = {}) {
    const airportResolver = context.airportResolver || createAirportResolver();
    const airport = toAirportField(value);
    if (!airport) {
      return null;
    }
    const resolved = airportResolver(
      {
        name: airport.name,
        municipality: airport.municipality,
        iataCode: airport.iataCode,
        icaoCode: airport.icaoCode
      },
      role
    ) || resolveAirportReference(
      {
        name: airport.name,
        municipality: airport.municipality,
        iataCode: airport.iataCode,
        icaoCode: airport.icaoCode
      },
      role
    );
    return {
      name: airport.name || resolved && resolved.name || null,
      municipality: airport.municipality || resolved && resolved.municipality || null,
      iataCode: airport.iataCode || resolved && resolved.iataCode || null,
      icaoCode: airport.icaoCode || resolved && resolved.icaoCode || null
    };
  }
  function resolveRouteEndpoint(routeData, role, context = {}) {
    if (!routeData) {
      return null;
    }
    if (typeof routeData === "string") {
      return normalizeAirportEndpoint2(routeData, role, context);
    }
    if (Array.isArray(routeData)) {
      const index = role === "origin" ? 0 : routeData.length - 1;
      return normalizeAirportEndpoint2(routeData[index], role, context);
    }
    return normalizeAirportEndpoint2(routeData, role, context);
  }
  function firstObject(...values) {
    for (const value of values) {
      if (isObject(value)) {
        return value;
      }
    }
    return null;
  }
  function extractAdsbdbPayloadRoots(payload) {
    const response = firstObject(payload && payload.response, payload);
    const aircraft = firstObject(
      response && response.aircraft,
      payload && payload.aircraft,
      payload && payload.data && payload.data.aircraft
    );
    const flightroute = firstObject(
      response && response.flightroute,
      response && response.flightRoute,
      payload && payload.flightroute,
      payload && payload.route,
      payload && payload.data && payload.data.flightroute,
      payload && payload.data && payload.data.route
    );
    return {
      response,
      aircraft,
      flightroute
    };
  }
  function extractAdsblolPayloadRoots(payload) {
    const response = firstObject(payload && payload.response, payload);
    const route = firstObject(
      response && response.route,
      response && response.flightroute,
      response && response.flightRoute,
      payload && payload.route,
      payload && payload.flightroute,
      payload && payload.flightRoute,
      payload && payload.data && payload.data.route,
      payload && payload.data && payload.data.flightroute
    );
    return {
      response,
      route
    };
  }
  function normalizePhotoValue(value) {
    const text = cleanText2(value);
    return text && /^https?:\/\//i.test(text) ? text : null;
  }
  function normalizeAdsbdbDetailsPayload(payload, aircraft = null, context = {}) {
    const lookup = buildAircraftDetailsLookup(aircraft, context) || {};
    const roots = extractAdsbdbPayloadRoots(payload);
    const aircraftData = roots.aircraft || {};
    const flightroute = roots.flightroute || {};
    const photoMode = context.photoMode === "disabled" ? "disabled" : "enabled";
    const origin = resolveRouteEndpoint(
      flightroute.origin || flightroute.departure || flightroute.from,
      "origin",
      context
    );
    const destination = resolveRouteEndpoint(
      flightroute.destination || flightroute.arrival || flightroute.to,
      "destination",
      context
    );
    const registration = pickText(
      aircraftData.registration,
      aircraftData.reg,
      aircraftData.tail_number,
      aircraft && aircraft.registration
    );
    const manufacturer = pickText(
      aircraftData.manufacturer,
      aircraftData.make,
      aircraftData.aircraft_manufacturer
    );
    const type = pickText(aircraftData.type, aircraftData.model, aircraftData.aircraft_type);
    const icaoType = pickText(aircraftData.icao_type, aircraftData.icaoType, aircraftData.icao);
    const owner = pickText(
      aircraftData.registered_owner,
      aircraftData.owner,
      aircraftData.operator,
      aircraftData.airline
    );
    const airlineName = pickText(
      flightroute.airline && flightroute.airline.name,
      flightroute.airline_name,
      flightroute.operator_name,
      flightroute.operator
    );
    const airlineIcao = pickText(
      flightroute.airline && flightroute.airline.icao,
      flightroute.airline && flightroute.airline.icao_code,
      flightroute.airline_icao,
      flightroute.operator_icao
    );
    const airlineIata = pickText(
      flightroute.airline && flightroute.airline.iata,
      flightroute.airline && flightroute.airline.iata_code,
      flightroute.airline_iata,
      flightroute.operator_iata
    );
    const airlineCallsign = pickText(
      flightroute.airline && flightroute.airline.callsign,
      flightroute.airline_callsign,
      flightroute.callsign
    );
    const photoUrl = photoMode === "disabled" ? null : normalizePhotoValue(
      aircraftData.url_photo || aircraftData.photo || aircraftData.image || aircraftData.url || aircraftData.photo_url
    );
    const photoThumbnailUrl = photoMode === "disabled" ? null : normalizePhotoValue(
      aircraftData.url_photo_thumbnail || aircraftData.photo_thumbnail || aircraftData.thumbnail || aircraftData.thumbnail_url
    );
    return {
      lookupKey: cleanText2(lookup.lookupKey || context.lookupKey) || null,
      fetchedAt: nowMsFrom(context.now),
      source: "adsbdb",
      routeAdvisory: false,
      photoMode,
      registration,
      manufacturer,
      type,
      icaoType,
      owner,
      airlineName,
      airlineIcao,
      airlineIata,
      airlineCallsign,
      photoUrl,
      photoThumbnailUrl,
      photoSource: photoUrl || photoThumbnailUrl ? "adsbdb" : null,
      routeSource: origin || destination || airlineName ? "adsbdb" : null,
      origin,
      destination,
      notes: [],
      aircraft: {
        registration,
        manufacturer,
        type,
        icaoType,
        owner
      },
      route: {
        airlineName,
        airlineIcao,
        airlineIata,
        airlineCallsign,
        origin,
        destination
      }
    };
  }
  function normalizeAdsblolDetailsPayload(payload, aircraft = null, context = {}) {
    const lookup = buildAircraftDetailsLookup(aircraft, context) || {};
    const roots = extractAdsblolPayloadRoots(payload);
    const routeData = roots.route || {};
    const photoMode = context.photoMode === "disabled" ? "disabled" : "enabled";
    const origin = resolveRouteEndpoint(
      routeData.origin || routeData.departure || routeData.from || routeData.departure_airport,
      "origin",
      context
    );
    const destination = resolveRouteEndpoint(
      routeData.destination || routeData.arrival || routeData.to || routeData.arrival_airport,
      "destination",
      context
    );
    const airlineName = pickText(
      routeData.airline && routeData.airline.name,
      routeData.airline_name,
      routeData.operator_name,
      routeData.operator
    );
    const airlineIcao = pickText(
      routeData.airline && routeData.airline.icao,
      routeData.airline_icao,
      routeData.operator_icao
    );
    const airlineIata = pickText(
      routeData.airline && routeData.airline.iata,
      routeData.airline_iata,
      routeData.operator_iata
    );
    const airlineCallsign = pickText(
      routeData.airline && routeData.airline.callsign,
      routeData.airline_callsign,
      routeData.callsign
    );
    const photoUrl = photoMode === "disabled" ? null : normalizePhotoValue(
      routeData.photo || routeData.image || routeData.url_photo || routeData.embed_image || routeData.thumbnail
    );
    const photoThumbnailUrl = photoMode === "disabled" ? null : normalizePhotoValue(routeData.thumbnail || routeData.photo_thumbnail || routeData.url_photo_thumbnail);
    return {
      lookupKey: cleanText2(lookup.lookupKey || context.lookupKey) || null,
      fetchedAt: nowMsFrom(context.now),
      source: "adsblol",
      routeAdvisory: true,
      photoMode,
      registration: pickText(routeData.registration, aircraft && aircraft.registration),
      manufacturer: pickText(routeData.manufacturer, routeData.make),
      type: pickText(routeData.type, routeData.model),
      icaoType: pickText(routeData.icao_type, routeData.icaoType, routeData.icao),
      owner: pickText(routeData.owner, routeData.operator, routeData.registered_owner),
      airlineName,
      airlineIcao,
      airlineIata,
      airlineCallsign,
      photoUrl,
      photoThumbnailUrl,
      photoSource: photoUrl || photoThumbnailUrl ? "adsblol" : null,
      routeSource: origin || destination || airlineName ? "adsblol" : null,
      origin,
      destination,
      notes: ["Route/photo data from ADSB.lol are advisory."],
      aircraft: {
        registration: pickText(routeData.registration, aircraft && aircraft.registration),
        manufacturer: pickText(routeData.manufacturer, routeData.make),
        type: pickText(routeData.type, routeData.model),
        icaoType: pickText(routeData.icao_type, routeData.icaoType, routeData.icao),
        owner: pickText(routeData.owner, routeData.operator, routeData.registered_owner)
      },
      route: {
        airlineName,
        airlineIcao,
        airlineIata,
        airlineCallsign,
        origin,
        destination
      }
    };
  }
  function shouldUseAdsblolFallback(details, context = {}) {
    if (!details) {
      return false;
    }
    const photoMode = context.photoMode === "disabled" ? "disabled" : "enabled";
    const missingPhoto = photoMode === "enabled" && !details.photoUrl && !details.photoThumbnailUrl;
    const missingRoute = !details.origin || !details.destination || !details.airlineName;
    return missingPhoto || missingRoute;
  }
  function mergeAirportField(primary, fallback) {
    return primary || fallback || null;
  }
  function mergeAircraftDetails(primary, fallback, context = {}) {
    const base = cloneDetails(primary) || createEmptyAircraftDetails(primary && primary.lookupKey, context.now);
    const extra = cloneDetails(fallback);
    if (!extra) {
      return base;
    }
    const photoMode = context.photoMode === "disabled" ? "disabled" : "enabled";
    const notes = new Set(base.notes || []);
    if (!base.registration) {
      base.registration = extra.registration || null;
    }
    if (!base.manufacturer) {
      base.manufacturer = extra.manufacturer || null;
    }
    if (!base.type) {
      base.type = extra.type || null;
    }
    if (!base.icaoType) {
      base.icaoType = extra.icaoType || null;
    }
    if (!base.owner) {
      base.owner = extra.owner || null;
    }
    if (!base.airlineName) {
      base.airlineName = extra.airlineName || null;
    }
    if (!base.airlineIcao) {
      base.airlineIcao = extra.airlineIcao || null;
    }
    if (!base.airlineIata) {
      base.airlineIata = extra.airlineIata || null;
    }
    if (!base.airlineCallsign) {
      base.airlineCallsign = extra.airlineCallsign || null;
    }
    if (photoMode === "enabled") {
      if (!base.photoUrl) {
        base.photoUrl = extra.photoUrl || null;
        if (base.photoUrl) {
          base.photoSource = extra.photoSource || "adsblol";
        }
      }
      if (!base.photoThumbnailUrl) {
        base.photoThumbnailUrl = extra.photoThumbnailUrl || null;
        if (!base.photoThumbnailUrl && extra.photoUrl) {
          base.photoThumbnailUrl = extra.photoUrl;
        }
        if (base.photoThumbnailUrl && !base.photoSource) {
          base.photoSource = extra.photoSource || "adsblol";
        }
      }
    }
    if (!base.origin) {
      base.origin = mergeAirportField(extra.origin, null);
    }
    if (!base.destination) {
      base.destination = mergeAirportField(extra.destination, null);
    }
    if (extra.routeSource && !base.routeSource) {
      base.routeSource = extra.routeSource;
    }
    base.routeAdvisory = Boolean(base.routeAdvisory || extra.routeAdvisory || base.routeSource === "adsblol");
    base.source = base.source === "adsbdb" && extra.source === "adsblol" ? "adsbdb+adsblol" : base.source || extra.source || "unknown";
    base.fetchedAt = Math.max(base.fetchedAt || 0, extra.fetchedAt || 0);
    if (extra.notes && Array.isArray(extra.notes)) {
      for (const note of extra.notes) {
        const text = cleanText2(note);
        if (text) {
          notes.add(text);
        }
      }
    }
    if (base.routeAdvisory) {
      notes.add("Route/photo data from ADSB.lol are advisory.");
    }
    base.notes = [...notes];
    base.aircraft = {
      registration: base.registration || null,
      manufacturer: base.manufacturer || null,
      type: base.type || null,
      icaoType: base.icaoType || null,
      owner: base.owner || null
    };
    base.route = {
      airlineName: base.airlineName || null,
      airlineIcao: base.airlineIcao || null,
      airlineIata: base.airlineIata || null,
      airlineCallsign: base.airlineCallsign || null,
      origin: base.origin || null,
      destination: base.destination || null
    };
    return base;
  }
  function prunePhotoDetails(details, photoMode = "enabled") {
    if (!details) {
      return details;
    }
    if (photoMode !== "disabled") {
      return details;
    }
    return {
      ...details,
      photoUrl: null,
      photoThumbnailUrl: null,
      photoSource: null,
      photoMode: "disabled"
    };
  }
  function readStorageValue(storage, key) {
    if (!storage) {
      return null;
    }
    if (typeof storage.getValue === "function") {
      return storage.getValue(key, null);
    }
    if (typeof storage.getItem === "function") {
      return storage.getItem(key);
    }
    return null;
  }
  function writeStorageValue(storage, key, value) {
    if (!storage) {
      return;
    }
    if (typeof storage.setValue === "function") {
      storage.setValue(key, value);
      return;
    }
    if (typeof storage.setItem === "function") {
      storage.setItem(key, value);
    }
  }
  function removeStorageValue(storage, key) {
    if (!storage) {
      return;
    }
    if (typeof storage.removeValue === "function") {
      storage.removeValue(key);
      return;
    }
    if (typeof storage.removeItem === "function") {
      storage.removeItem(key);
    }
  }
  function createSelectedAircraftDetailsCache(options = {}) {
    const storage = options.storage || null;
    const storageKey = cleanText2(options.storageKey) || DEFAULT_SELECTED_AIRCRAFT_DETAILS_STORAGE_KEY;
    const now = typeof options.now === "function" ? options.now : Date.now;
    const memoryTtlMs = Number.isFinite(options.memoryTtlMs) ? options.memoryTtlMs : 5 * 60 * 1e3;
    const sessionTtlMs = Number.isFinite(options.sessionTtlMs) ? options.sessionTtlMs : 24 * 60 * 60 * 1e3;
    const maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : 32;
    const memory = /* @__PURE__ */ new Map();
    let hydrated = false;
    function cleanupMemory() {
      const nowAt = nowMsFrom(now);
      for (const [key, entry] of memory.entries()) {
        if (!entry || entry.expiresAt <= nowAt) {
          memory.delete(key);
        }
      }
      while (memory.size > maxEntries) {
        const oldestKey = memory.keys().next().value;
        if (oldestKey === void 0) {
          break;
        }
        memory.delete(oldestKey);
      }
    }
    function hydrate() {
      if (hydrated) {
        cleanupMemory();
        return;
      }
      hydrated = true;
      const raw = readStorageValue(storage, storageKey);
      if (!raw) {
        cleanupMemory();
        return;
      }
      let parsed = null;
      try {
        parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch (_error) {
        parsed = null;
      }
      const entries = parsed && Array.isArray(parsed.entries) ? parsed.entries : [];
      const nowAt = nowMsFrom(now);
      for (const entry of entries) {
        if (!entry || !entry.key || !entry.value) {
          continue;
        }
        const expiresAt = Number.isFinite(entry.expiresAt) ? entry.expiresAt : 0;
        const sessionExpiresAt = Number.isFinite(entry.sessionExpiresAt) ? entry.sessionExpiresAt : 0;
        if (expiresAt <= nowAt && sessionExpiresAt <= nowAt) {
          continue;
        }
        memory.set(entry.key, {
          value: cloneDetails(entry.value),
          expiresAt: Math.max(expiresAt, nowAt + memoryTtlMs),
          sessionExpiresAt: Math.max(sessionExpiresAt, nowAt + sessionTtlMs)
        });
      }
      cleanupMemory();
    }
    function snapshot() {
      cleanupMemory();
      return {
        version: SELECTED_AIRCRAFT_DETAILS_CACHE_VERSION,
        storageKey,
        updatedAt: nowMsFrom(now),
        entries: [...memory.entries()].map(([key, entry]) => ({
          key,
          expiresAt: entry.expiresAt,
          sessionExpiresAt: entry.sessionExpiresAt,
          value: cloneDetails(entry.value)
        }))
      };
    }
    function persist() {
      if (!storage) {
        return;
      }
      writeStorageValue(storage, storageKey, JSON.stringify(snapshot()));
    }
    return {
      hydrate,
      get(key) {
        hydrate();
        cleanupMemory();
        const entry = memory.get(key);
        if (!entry) {
          return null;
        }
        const nowAt = nowMsFrom(now);
        if (entry.expiresAt <= nowAt && entry.sessionExpiresAt <= nowAt) {
          memory.delete(key);
          persist();
          return null;
        }
        if (entry.expiresAt <= nowAt) {
          entry.expiresAt = nowAt + memoryTtlMs;
        }
        return cloneDetails(entry.value);
      },
      set(key, value, options2 = {}) {
        hydrate();
        const persistValue = options2.persist !== false;
        const nowAt = nowMsFrom(now);
        memory.set(key, {
          value: cloneDetails(value),
          expiresAt: nowAt + memoryTtlMs,
          sessionExpiresAt: nowAt + sessionTtlMs
        });
        cleanupMemory();
        if (persistValue) {
          persist();
        }
        return cloneDetails(value);
      },
      clear(key = null) {
        hydrate();
        if (key === null) {
          memory.clear();
        } else {
          memory.delete(key);
        }
        if (memory.size === 0) {
          removeStorageValue(storage, storageKey);
        } else {
          persist();
        }
      },
      snapshot,
      stats() {
        hydrate();
        cleanupMemory();
        return {
          storageKey,
          entries: memory.size,
          memoryTtlMs,
          sessionTtlMs,
          hydrated
        };
      }
    };
  }
  async function tryRequestJson(requestJson2, url) {
    return requestJson2(url);
  }
  async function loadFallbackPayload(requestJson2, lookup, context = {}) {
    const explicitUrls = Array.isArray(context.adsblolLookupUrls) ? context.adsblolLookupUrls : null;
    const urls = explicitUrls && explicitUrls.length > 0 ? explicitUrls : buildAdsblolLookupCandidates(lookup, context);
    let lastError = null;
    for (const url of urls) {
      try {
        return await tryRequestJson(requestJson2, url);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("ADSb.lol fallback lookup failed");
  }
  function createEnrichmentService(context = {}) {
    const requestJson2 = typeof context.requestJson === "function" ? context.requestJson : null;
    const airportResolver = context.airportResolver || createAirportResolver();
    const photoMode = context.photoMode === "disabled" ? "disabled" : "enabled";
    const cache = createSelectedAircraftDetailsCache({
      storage: context.storage || null,
      storageKey: context.storageKey,
      now: context.now,
      memoryTtlMs: context.memoryTtlMs,
      sessionTtlMs: context.sessionTtlMs,
      maxEntries: context.maxEntries
    });
    const logEvent = typeof context.logEvent === "function" ? context.logEvent : null;
    function emit(level, message, details) {
      if (logEvent) {
        logEvent(level, message, details);
      }
    }
    function normalizeAdsbdbPayload(payload, aircraft = null) {
      return prunePhotoDetails(
        normalizeAdsbdbDetailsPayload(payload, aircraft, {
          ...context,
          photoMode,
          airportResolver
        }),
        photoMode
      );
    }
    function normalizeAdsblolPayload(payload, aircraft = null) {
      return prunePhotoDetails(
        normalizeAdsblolDetailsPayload(payload, aircraft, {
          ...context,
          photoMode,
          airportResolver
        }),
        photoMode
      );
    }
    async function loadSelectedAircraftDetails(aircraft, options = {}) {
      const lookup = buildAircraftDetailsLookup(aircraft, context);
      if (!lookup) {
        const empty = createEmptyAircraftDetails(null, context.now);
        empty.photoMode = photoMode;
        empty.notes = ["No aircraft lookup key is available for enrichment."];
        return empty;
      }
      cache.hydrate();
      const cached = options.force ? null : cache.get(lookup.lookupKey);
      if (cached) {
        emit("trace", "Selected aircraft details cache hit", { lookupKey: lookup.lookupKey });
        return prunePhotoDetails(cached, photoMode);
      }
      if (!requestJson2) {
        const empty = createEmptyAircraftDetails(lookup.lookupKey, context.now);
        empty.photoMode = photoMode;
        empty.notes = ["No requestJson() handler was provided for enrichment."];
        return empty;
      }
      emit("trace", "Selected aircraft details cache miss", {
        lookupKey: lookup.lookupKey,
        adsbdbUrl: lookup.adsbdbUrl
      });
      const primaryPayload = await requestJson2(lookup.adsbdbUrl);
      let details = normalizeAdsbdbPayload(primaryPayload, aircraft);
      if (shouldUseAdsblolFallback(details, { photoMode })) {
        try {
          const fallbackPayload = await loadFallbackPayload(requestJson2, lookup, {
            ...context,
            photoMode
          });
          const fallbackDetails = normalizeAdsblolPayload(fallbackPayload, aircraft);
          details = mergeAircraftDetails(details, fallbackDetails, { photoMode, now: context.now });
          emit("trace", "Applied ADSB.lol advisory fallback", {
            lookupKey: lookup.lookupKey,
            hasPhoto: Boolean(details.photoUrl || details.photoThumbnailUrl),
            hasRoute: Boolean(details.origin || details.destination)
          });
        } catch (error) {
          emit("warn", "ADSB.lol fallback lookup failed", {
            lookupKey: lookup.lookupKey,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
      const finalDetails = prunePhotoDetails({
        ...details,
        lookupKey: lookup.lookupKey,
        fetchedAt: nowMsFrom(context.now),
        photoMode
      }, photoMode);
      cache.set(lookup.lookupKey, finalDetails, {
        persist: context.persistSelectedDetails !== false
      });
      return cloneDetails(finalDetails);
    }
    return {
      cache,
      airportResolver,
      buildAircraftDetailsLookup: (aircraft) => buildAircraftDetailsLookup(aircraft, context),
      buildAdsbdbLookupUrl: (identifier, callsign = null) => buildAdsbdbLookupUrl(identifier, callsign, context),
      buildAdsblolLookupCandidates: (lookup) => buildAdsblolLookupCandidates(lookup, context),
      createEmptyAircraftDetails,
      loadSelectedAircraftDetails,
      mergeAircraftDetails: (primary, fallback) => mergeAircraftDetails(primary, fallback, { photoMode, now: context.now }),
      normalizeAdsbdbDetailsPayload: (payload, aircraft = null) => normalizeAdsbdbPayload(payload, aircraft),
      normalizeAdsblolDetailsPayload: (payload, aircraft = null) => normalizeAdsblolPayload(payload, aircraft),
      prunePhotoDetails: (details) => prunePhotoDetails(details, photoMode),
      shouldUseAdsblolFallback: (details) => shouldUseAdsblolFallback(details, { photoMode }),
      exportDebugState() {
        return {
          photoMode,
          cache: cache.snapshot()
        };
      }
    };
  }

  // src/render/density.js
  var TAU = Math.PI * 2;
  var DENSITY_MODES = Object.freeze({
    NORMAL: "normal",
    SPIDERFY: "spiderfy",
    DECLUTTER: "declutter"
  });
  var DEFAULT_DENSITY_OPTIONS = Object.freeze({
    mode: "auto",
    overlapRadiusPx: 14,
    overlapCountThreshold: 2,
    declutterZoomThreshold: 8,
    declutterMarkerCountThreshold: 40,
    declutterDensityThreshold: 48,
    declutterRadiusMultiplier: 2.2,
    declutterMinRadiusPx: 18,
    clusterHitPaddingPx: 8,
    spiderfyCircleRadiusPx: 36,
    spiderfyCircleMaxItems: 8,
    spiderfySpiralStepPx: 7,
    spiderfySpiralAngleStep: Math.PI * (3 - Math.sqrt(5)),
    spiderfyHitPaddingPx: 10
  });
  function isFiniteNumber2(value) {
    return Number.isFinite(value);
  }
  function toFiniteNumber2(value, fallback = null) {
    return isFiniteNumber2(value) ? value : fallback;
  }
  function pickString(value, fallback) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
    return fallback;
  }
  function readPoint(source) {
    if (!source || typeof source !== "object") {
      return null;
    }
    const directX = toFiniteNumber2(source.x);
    const directY = toFiniteNumber2(source.y);
    if (directX !== null && directY !== null) {
      return { x: directX, y: directY };
    }
    const fallbackPairs = [
      [source.baseX, source.baseY],
      [source.point && source.point.x, source.point && source.point.y],
      [source.position && source.position.x, source.position && source.position.y],
      [source.center && source.center.x, source.center && source.center.y]
    ];
    for (const [xValue, yValue] of fallbackPairs) {
      const x = toFiniteNumber2(xValue);
      const y = toFiniteNumber2(yValue);
      if (x !== null && y !== null) {
        return { x, y };
      }
    }
    return null;
  }
  function roundCoord(value) {
    return Math.round(value * 1e3) / 1e3;
  }
  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
  function pointDistanceSq(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }
  function makeBounds() {
    return {
      left: Infinity,
      top: Infinity,
      right: -Infinity,
      bottom: -Infinity
    };
  }
  function updateBounds(bounds, point) {
    bounds.left = Math.min(bounds.left, point.x);
    bounds.top = Math.min(bounds.top, point.y);
    bounds.right = Math.max(bounds.right, point.x);
    bounds.bottom = Math.max(bounds.bottom, point.y);
  }
  function finalizeBounds(bounds) {
    if (!Number.isFinite(bounds.left)) {
      return {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0
      };
    }
    return {
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top
    };
  }
  function averagePoint(markers) {
    if (markers.length === 0) {
      return { x: 0, y: 0 };
    }
    let sumX = 0;
    let sumY = 0;
    for (const marker of markers) {
      sumX += marker.x;
      sumY += marker.y;
    }
    return {
      x: sumX / markers.length,
      y: sumY / markers.length
    };
  }
  function resolveOptions(options = {}) {
    return {
      ...DEFAULT_DENSITY_OPTIONS,
      ...options
    };
  }
  function attachHiddenProperty(target, key, value) {
    Object.defineProperty(target, key, {
      value,
      enumerable: false,
      configurable: true,
      writable: true
    });
  }
  function normalizeProjectedMarker(marker, index = 0) {
    const point = readPoint(marker);
    if (!point) {
      return null;
    }
    const aircraft = marker && typeof marker.aircraft === "object" ? marker.aircraft : null;
    const summary = {
      id: pickString(marker.id, `marker-${index}`),
      aircraftId: pickString(
        aircraft && (aircraft.id || aircraft.hex || aircraft.registration),
        pickString(marker.aircraftId, pickString(marker.aircraftHex, pickString(marker.callsign, `marker-${index}`)))
      ),
      x: point.x,
      y: point.y,
      baseX: toFiniteNumber2(marker.baseX, point.x) ?? point.x,
      baseY: toFiniteNumber2(marker.baseY, point.y) ?? point.y,
      heading: isFiniteNumber2(marker.heading) ? marker.heading : null,
      isSelected: Boolean(marker.isSelected),
      isHovered: Boolean(marker.isHovered),
      weight: Math.max(1, toFiniteNumber2(marker.weight, 1) ?? 1),
      index
    };
    const callsign = aircraft && pickString(aircraft.callsign || aircraft.flight, null);
    const registration = aircraft && pickString(aircraft.registration, null);
    const type = aircraft && pickString(aircraft.type, null);
    if (callsign !== null) {
      summary.callsign = callsign;
    }
    if (registration !== null) {
      summary.registration = registration;
    }
    if (type !== null) {
      summary.type = type;
    }
    attachHiddenProperty(summary, "source", marker);
    if (aircraft) {
      attachHiddenProperty(summary, "aircraft", aircraft);
    }
    return summary;
  }
  function normalizeProjectedMarkers(markers) {
    const list = Array.isArray(markers) ? markers : [];
    const normalized = [];
    for (let index = 0; index < list.length; index += 1) {
      const marker = normalizeProjectedMarker(list[index], index);
      if (marker) {
        normalized.push(marker);
      }
    }
    return normalized;
  }
  function decideDensityMode(input = {}) {
    const options = resolveOptions(input);
    const zoom = toFiniteNumber2(input.zoom, 0) ?? 0;
    const markerCount = Math.max(0, Math.trunc(toFiniteNumber2(input.markerCount, 0) ?? 0));
    const viewportWidth = Math.max(0, toFiniteNumber2(input.viewportWidth, 0) ?? 0);
    const viewportHeight = Math.max(0, toFiniteNumber2(input.viewportHeight, 0) ?? 0);
    const areaMp = Math.max(1, viewportWidth * viewportHeight / 1e6);
    const density = markerCount / areaMp;
    if (options.mode && options.mode !== "auto") {
      return {
        densityMode: options.mode,
        mode: options.mode,
        reason: "forced",
        markerCount,
        density
      };
    }
    if (markerCount <= 1) {
      return {
        densityMode: DENSITY_MODES.NORMAL,
        mode: DENSITY_MODES.NORMAL,
        reason: "sparse",
        markerCount,
        density
      };
    }
    if (zoom <= options.declutterZoomThreshold || markerCount >= options.declutterMarkerCountThreshold || density >= options.declutterDensityThreshold) {
      return {
        densityMode: DENSITY_MODES.DECLUTTER,
        mode: DENSITY_MODES.DECLUTTER,
        reason: zoom <= options.declutterZoomThreshold ? "low-zoom" : "dense",
        markerCount,
        density
      };
    }
    if (markerCount >= options.overlapCountThreshold) {
      return {
        densityMode: DENSITY_MODES.SPIDERFY,
        mode: DENSITY_MODES.SPIDERFY,
        reason: "dense-enough",
        markerCount,
        density
      };
    }
    return {
      densityMode: DENSITY_MODES.NORMAL,
      mode: DENSITY_MODES.NORMAL,
      reason: "sparse",
      markerCount,
      density
    };
  }
  function buildSpatialHash(markers, cellSizePx) {
    const cells = /* @__PURE__ */ new Map();
    for (let index = 0; index < markers.length; index += 1) {
      const marker = markers[index];
      const cellX = Math.floor(marker.x / cellSizePx);
      const cellY = Math.floor(marker.y / cellSizePx);
      const key = `${cellX}:${cellY}`;
      if (!cells.has(key)) {
        cells.set(key, []);
      }
      cells.get(key).push(index);
    }
    return cells;
  }
  function collectComponent(markers, startIndex, radiusPx, cellSizePx, cells, visited) {
    const component = [];
    const queue = [startIndex];
    const radiusSq = radiusPx * radiusPx;
    while (queue.length > 0) {
      const currentIndex = queue.pop();
      if (visited.has(currentIndex)) {
        continue;
      }
      visited.add(currentIndex);
      const current = markers[currentIndex];
      component.push(current);
      const cellX = Math.floor(current.x / cellSizePx);
      const cellY = Math.floor(current.y / cellSizePx);
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          const key = `${cellX + offsetX}:${cellY + offsetY}`;
          const candidates = cells.get(key);
          if (!candidates) {
            continue;
          }
          for (const candidateIndex of candidates) {
            if (visited.has(candidateIndex)) {
              continue;
            }
            const candidate = markers[candidateIndex];
            if (pointDistanceSq(current, candidate) <= radiusSq) {
              queue.push(candidateIndex);
            }
          }
        }
      }
    }
    return component;
  }
  function groupId(mode, markers, center) {
    const sample = markers.slice(0, 4).map((marker) => marker.id).join(",");
    const payload = `${mode}:${markers.length}:${roundCoord(center.x)}:${roundCoord(center.y)}:${sample}`;
    return `${mode}:${hashString(payload)}`;
  }
  function summarizeGroupMembers(markers) {
    return markers.map((marker) => ({
      id: marker.id,
      aircraftId: marker.aircraftId,
      x: marker.x,
      y: marker.y,
      baseX: marker.baseX,
      baseY: marker.baseY,
      heading: marker.heading,
      isSelected: marker.isSelected,
      isHovered: marker.isHovered,
      weight: marker.weight,
      index: marker.index,
      callsign: marker.callsign ?? null,
      registration: marker.registration ?? null,
      type: marker.type ?? null
    }));
  }
  function createSingleGroup(marker) {
    return {
      id: `marker:${marker.id}`,
      kind: "marker",
      mode: DENSITY_MODES.NORMAL,
      markerCount: 1,
      members: summarizeGroupMembers([marker]),
      center: { x: marker.x, y: marker.y },
      bounds: {
        left: marker.x,
        top: marker.y,
        right: marker.x,
        bottom: marker.y,
        width: 0,
        height: 0
      },
      radiusPx: 0,
      hitRadiusPx: 0,
      label: null,
      weight: marker.weight,
      selectedCount: marker.isSelected ? 1 : 0,
      hoveredCount: marker.isHovered ? 1 : 0,
      memberIds: [marker.id]
    };
  }
  function createClusterGroup(mode, markers, radiusPx, hitPaddingPx) {
    const center = averagePoint(markers);
    const bounds = makeBounds();
    let totalWeight = 0;
    const selectedIds = [];
    const hoveredIds = [];
    for (const marker of markers) {
      updateBounds(bounds, marker);
      totalWeight += marker.weight;
      if (marker.isSelected) {
        selectedIds.push(marker.id);
      }
      if (marker.isHovered) {
        hoveredIds.push(marker.id);
      }
    }
    const maxDistance = markers.reduce((accumulator, marker) => {
      const dx = marker.x - center.x;
      const dy = marker.y - center.y;
      return Math.max(accumulator, Math.sqrt(dx * dx + dy * dy));
    }, 0);
    const clusterRadiusPx = Math.max(radiusPx, maxDistance);
    return {
      id: groupId(mode, markers, center),
      kind: "cluster",
      mode,
      markerCount: markers.length,
      members: summarizeGroupMembers(markers),
      center,
      bounds: finalizeBounds(bounds),
      radiusPx: clusterRadiusPx,
      hitRadiusPx: clusterRadiusPx + hitPaddingPx,
      label: String(markers.length),
      weight: totalWeight,
      selectedCount: selectedIds.length,
      hoveredCount: hoveredIds.length,
      memberIds: markers.map((marker) => marker.id),
      selectedMarkerIds: selectedIds,
      hoveredMarkerIds: hoveredIds,
      densityScore: markers.length / Math.max(1, finalizeBounds(bounds).width * finalizeBounds(bounds).height)
    };
  }
  function clusterByRadius(markers, radiusPx, mode, hitPaddingPx) {
    const cellSizePx = Math.max(1, radiusPx);
    const cells = buildSpatialHash(markers, cellSizePx);
    const visited = /* @__PURE__ */ new Set();
    const groups = [];
    for (let index = 0; index < markers.length; index += 1) {
      if (visited.has(index)) {
        continue;
      }
      const component = collectComponent(markers, index, radiusPx, cellSizePx, cells, visited);
      if (component.length <= 1) {
        groups.push(createSingleGroup(component[0]));
        continue;
      }
      groups.push(createClusterGroup(mode, component, radiusPx, hitPaddingPx));
    }
    return groups;
  }
  function maybeExpandSelectedGroup(group, options) {
    const expandGroupId = options.spiderfyGroupId ?? options.expandedGroupId ?? null;
    if (!expandGroupId || group.id !== expandGroupId || group.markerCount <= 1) {
      return group;
    }
    return {
      ...group,
      expanded: expandSpiderfyGroup(group, options)
    };
  }
  function buildDensityScene(markers, options = {}) {
    const normalizedMarkers = normalizeProjectedMarkers(markers);
    const decision = decideDensityMode({
      zoom: options.zoom,
      markerCount: normalizedMarkers.length,
      viewportWidth: options.viewportWidth,
      viewportHeight: options.viewportHeight,
      ...options
    });
    if (normalizedMarkers.length === 0) {
      return {
        densityMode: DENSITY_MODES.NORMAL,
        mode: DENSITY_MODES.NORMAL,
        reason: decision.reason,
        markerCount: 0,
        density: 0,
        viewport: {
          width: Math.max(0, toFiniteNumber2(options.viewportWidth, 0) ?? 0),
          height: Math.max(0, toFiniteNumber2(options.viewportHeight, 0) ?? 0),
          zoom: toFiniteNumber2(options.zoom, null)
        },
        options: {
          overlapRadiusPx: DEFAULT_DENSITY_OPTIONS.overlapRadiusPx
        },
        groups: [],
        stats: {
          groupCount: 0,
          clusterCount: 0,
          markerCount: 0,
          selectedCount: 0,
          hoveredCount: 0
        }
      };
    }
    let groups;
    let radiusPx = 0;
    let hitPaddingPx = toFiniteNumber2(options.clusterHitPaddingPx, DEFAULT_DENSITY_OPTIONS.clusterHitPaddingPx) ?? DEFAULT_DENSITY_OPTIONS.clusterHitPaddingPx;
    if (decision.mode === DENSITY_MODES.NORMAL) {
      groups = normalizedMarkers.map((marker) => createSingleGroup(marker));
    } else {
      radiusPx = decision.mode === DENSITY_MODES.DECLUTTER ? Math.max(
        toFiniteNumber2(options.declutterMinRadiusPx, DEFAULT_DENSITY_OPTIONS.declutterMinRadiusPx) ?? DEFAULT_DENSITY_OPTIONS.declutterMinRadiusPx,
        (toFiniteNumber2(options.overlapRadiusPx, DEFAULT_DENSITY_OPTIONS.overlapRadiusPx) ?? DEFAULT_DENSITY_OPTIONS.overlapRadiusPx) * (toFiniteNumber2(options.declutterRadiusMultiplier, DEFAULT_DENSITY_OPTIONS.declutterRadiusMultiplier) ?? DEFAULT_DENSITY_OPTIONS.declutterRadiusMultiplier)
      ) : toFiniteNumber2(options.overlapRadiusPx, DEFAULT_DENSITY_OPTIONS.overlapRadiusPx) ?? DEFAULT_DENSITY_OPTIONS.overlapRadiusPx;
      groups = clusterByRadius(normalizedMarkers, radiusPx, decision.mode, hitPaddingPx);
    }
    groups = groups.map((group) => maybeExpandSelectedGroup(group, options));
    const selectedCount = normalizedMarkers.filter((marker) => marker.isSelected).length;
    const hoveredCount = normalizedMarkers.filter((marker) => marker.isHovered).length;
    const clusterCount = groups.filter((group) => group.kind === "cluster").length;
    return {
      densityMode: decision.mode,
      mode: decision.mode,
      reason: decision.reason,
      markerCount: normalizedMarkers.length,
      density: decision.density,
      viewport: {
        width: Math.max(0, toFiniteNumber2(options.viewportWidth, 0) ?? 0),
        height: Math.max(0, toFiniteNumber2(options.viewportHeight, 0) ?? 0),
        zoom: toFiniteNumber2(options.zoom, null)
      },
      options: {
        overlapRadiusPx: radiusPx || DEFAULT_DENSITY_OPTIONS.overlapRadiusPx,
        spiderfyGroupId: options.spiderfyGroupId ?? null,
        expandedGroupId: options.expandedGroupId ?? null
      },
      groups,
      stats: {
        groupCount: groups.length,
        clusterCount,
        markerCount: normalizedMarkers.length,
        selectedCount,
        hoveredCount
      }
    };
  }
  function orderSpiderfyMembers(members) {
    return members.slice().sort((a, b) => {
      const aScore = (a.isSelected ? 0 : 2) + (a.isHovered ? 0 : 1);
      const bScore = (b.isSelected ? 0 : 2) + (b.isHovered ? 0 : 1);
      if (aScore !== bScore) {
        return aScore - bScore;
      }
      return String(a.id).localeCompare(String(b.id));
    });
  }
  function expandSpiderfyGroup(group, options = {}) {
    if (!group || !Array.isArray(group.members) || group.members.length === 0) {
      return null;
    }
    const center = readPoint(group.center) || averagePoint(group.members);
    const members = orderSpiderfyMembers(group.members);
    const maxCircleItems = Math.max(1, Math.trunc(toFiniteNumber2(options.spiderfyCircleMaxItems, DEFAULT_DENSITY_OPTIONS.spiderfyCircleMaxItems) ?? DEFAULT_DENSITY_OPTIONS.spiderfyCircleMaxItems));
    const circleRadiusPx = Math.max(1, toFiniteNumber2(options.spiderfyCircleRadiusPx, DEFAULT_DENSITY_OPTIONS.spiderfyCircleRadiusPx) ?? DEFAULT_DENSITY_OPTIONS.spiderfyCircleRadiusPx);
    const spiralStepPx = Math.max(1, toFiniteNumber2(options.spiderfySpiralStepPx, DEFAULT_DENSITY_OPTIONS.spiderfySpiralStepPx) ?? DEFAULT_DENSITY_OPTIONS.spiderfySpiralStepPx);
    const spiralAngleStep = toFiniteNumber2(options.spiderfySpiralAngleStep, DEFAULT_DENSITY_OPTIONS.spiderfySpiralAngleStep) ?? DEFAULT_DENSITY_OPTIONS.spiderfySpiralAngleStep;
    const hitPaddingPx = Math.max(0, toFiniteNumber2(options.spiderfyHitPaddingPx, DEFAULT_DENSITY_OPTIONS.spiderfyHitPaddingPx) ?? DEFAULT_DENSITY_OPTIONS.spiderfyHitPaddingPx);
    const useCircle = members.length <= maxCircleItems;
    const items = [];
    let maxDistancePx = 0;
    for (let index = 0; index < members.length; index += 1) {
      const marker = members[index];
      let angle;
      let distancePx;
      if (useCircle) {
        angle = -Math.PI / 2 + TAU * index / members.length;
        distancePx = circleRadiusPx;
      } else {
        angle = spiralAngleStep * index;
        distancePx = circleRadiusPx + spiralStepPx * Math.sqrt(index + 1);
      }
      const x = center.x + distancePx * Math.cos(angle);
      const y = center.y + distancePx * Math.sin(angle);
      maxDistancePx = Math.max(maxDistancePx, distancePx);
      items.push({
        id: `${marker.id}:${index}`,
        marker,
        x,
        y,
        angle,
        distancePx,
        baseX: marker.baseX,
        baseY: marker.baseY,
        isSelected: marker.isSelected,
        isHovered: marker.isHovered,
        aircraftId: marker.aircraftId
      });
    }
    const bounds = makeBounds();
    updateBounds(bounds, center);
    for (const item of items) {
      updateBounds(bounds, item);
    }
    const expanded = {
      id: `${group.id}:spiderfy`,
      groupId: group.id,
      kind: "spiderfy",
      mode: useCircle ? "circle" : "spiral",
      center,
      members,
      items,
      bounds: finalizeBounds(bounds),
      radiusPx: maxDistancePx + hitPaddingPx,
      hitRadiusPx: maxDistancePx + hitPaddingPx,
      label: String(members.length),
      markerCount: members.length,
      selectedCount: members.filter((marker) => marker.isSelected).length,
      hoveredCount: members.filter((marker) => marker.isHovered).length,
      memberIds: members.map((marker) => marker.id)
    };
    attachHiddenProperty(expanded, "sourceGroup", group);
    return expanded;
  }
  function normalizeSceneInput(sceneOrGroups) {
    if (Array.isArray(sceneOrGroups)) {
      return {
        densityMode: DENSITY_MODES.NORMAL,
        groups: sceneOrGroups
      };
    }
    if (sceneOrGroups && typeof sceneOrGroups === "object" && Array.isArray(sceneOrGroups.groups)) {
      return sceneOrGroups;
    }
    return {
      densityMode: DENSITY_MODES.NORMAL,
      groups: []
    };
  }
  function normalizeTargetPoint(point) {
    const resolved = readPoint(point);
    return resolved ? { x: resolved.x, y: resolved.y } : null;
  }
  function findSceneTargetAtPoint(sceneOrGroups, point, options = {}) {
    const scene = normalizeSceneInput(sceneOrGroups);
    const target = normalizeTargetPoint(point);
    if (!target || scene.groups.length === 0) {
      return null;
    }
    const clusterHitPaddingPx = Math.max(0, toFiniteNumber2(options.clusterHitPaddingPx, DEFAULT_DENSITY_OPTIONS.clusterHitPaddingPx) ?? DEFAULT_DENSITY_OPTIONS.clusterHitPaddingPx);
    const spiderfyHitPaddingPx = Math.max(0, toFiniteNumber2(options.spiderfyHitPaddingPx, DEFAULT_DENSITY_OPTIONS.spiderfyHitPaddingPx) ?? DEFAULT_DENSITY_OPTIONS.spiderfyHitPaddingPx);
    const singleHitRadiusPx = Math.max(1, toFiniteNumber2(options.singleHitRadiusPx, options.hitRadiusPx) ?? 14);
    let bestHit = null;
    for (const group of scene.groups) {
      if (!group || typeof group !== "object") {
        continue;
      }
      const center = readPoint(group.center) || readPoint(group);
      if (!center) {
        continue;
      }
      const groupRadiusPx = Math.max(
        toFiniteNumber2(group.hitRadiusPx, group.radiusPx) ?? 0,
        (toFiniteNumber2(group.radiusPx, 0) ?? 0) + clusterHitPaddingPx
      );
      const expanded = group.expanded && Array.isArray(group.expanded.items) ? group.expanded : null;
      if (expanded) {
        for (const item of expanded.items) {
          const itemPoint = readPoint(item);
          if (!itemPoint) {
            continue;
          }
          const distanceSq = pointDistanceSq(target, itemPoint);
          if (distanceSq <= spiderfyHitPaddingPx * spiderfyHitPaddingPx && (!bestHit || distanceSq < bestHit.distanceSq)) {
            const result = {
              type: "spiderfy-item",
              densityMode: scene.densityMode,
              groupId: group.id,
              markerId: item.marker ? item.marker.id : item.id,
              itemId: item.id,
              point: itemPoint,
              distanceSq
            };
            attachHiddenProperty(result, "group", group);
            attachHiddenProperty(result, "marker", item.marker || null);
            attachHiddenProperty(result, "item", item);
            attachHiddenProperty(result, "scene", scene);
            bestHit = result;
          }
        }
      }
      const isSingle = group.kind === "marker" || group.markerCount === 1;
      const radiusSq = (isSingle ? singleHitRadiusPx : groupRadiusPx) ** 2;
      const centerDistanceSq = pointDistanceSq(target, center);
      if (centerDistanceSq <= radiusSq && (!bestHit || centerDistanceSq < bestHit.distanceSq)) {
        const marker = Array.isArray(group.members) && group.members.length > 0 ? group.members[0] : null;
        const result = {
          type: isSingle ? "marker" : "cluster",
          densityMode: scene.densityMode,
          groupId: group.id,
          markerId: marker ? marker.id : null,
          point: center,
          distanceSq: centerDistanceSq
        };
        attachHiddenProperty(result, "group", group);
        attachHiddenProperty(result, "marker", marker);
        attachHiddenProperty(result, "scene", scene);
        bestHit = result;
      }
    }
    return bestHit;
  }

  // src/render/interpolation.js
  var EARTH_RADIUS_M = 63710088e-1;
  var DEFAULT_INTERPOLATION_OPTIONS = {
    transitionDurationMs: 1600,
    maxTeleportDistanceNm: 20,
    staleAfterMs: 15e3
  };
  function clamp2(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function isFiniteNumber3(value) {
    return Number.isFinite(value);
  }
  function toFiniteNumber3(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }
  function normalizeHeadingDegrees(value) {
    if (!isFiniteNumber3(value)) {
      return null;
    }
    return (value % 360 + 360) % 360;
  }
  function lerp(start, end, progress) {
    return start + (end - start) * progress;
  }
  function lerpAngleDegrees(start, end, progress) {
    const normalizedStart = normalizeHeadingDegrees(start);
    const normalizedEnd = normalizeHeadingDegrees(end);
    if (normalizedStart === null && normalizedEnd === null) {
      return null;
    }
    if (normalizedStart === null) {
      return normalizedEnd;
    }
    if (normalizedEnd === null) {
      return normalizedStart;
    }
    let delta = normalizedEnd - normalizedStart;
    if (delta > 180) {
      delta -= 360;
    } else if (delta < -180) {
      delta += 360;
    }
    return normalizeHeadingDegrees(normalizedStart + delta * progress);
  }
  function wrapLongitudeDelta(deltaDegrees) {
    if (deltaDegrees > 180) {
      return deltaDegrees - 360;
    }
    if (deltaDegrees < -180) {
      return deltaDegrees + 360;
    }
    return deltaDegrees;
  }
  function toRadians(degrees) {
    return degrees * Math.PI / 180;
  }
  function haversineDistanceMeters(startLat, startLon, endLat, endLon) {
    const phi1 = toRadians(startLat);
    const phi2 = toRadians(endLat);
    const deltaPhi = toRadians(endLat - startLat);
    const deltaLambda = toRadians(endLon - startLon);
    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_M * c;
  }
  function distanceNm(start, end) {
    const distanceMeters = haversineDistanceMeters(start.lat, start.lon, end.lat, end.lon);
    return distanceMeters / 1852;
  }
  function isStaleAircraft(aircraft, frameTimeMs, staleAfterMs) {
    const updatedAtMs = toFiniteNumber3(aircraft && aircraft.updatedAt);
    if (!isFiniteNumber3(updatedAtMs) || !isFiniteNumber3(frameTimeMs) || !isFiniteNumber3(staleAfterMs)) {
      return false;
    }
    return frameTimeMs - updatedAtMs > staleAfterMs;
  }
  function isValidPositionRecord(aircraft) {
    return Boolean(
      aircraft && aircraft.id !== void 0 && aircraft.id !== null && isFiniteNumber3(aircraft.lat) && isFiniteNumber3(aircraft.lon)
    );
  }
  function cloneAircraftRecord(aircraft) {
    return {
      ...aircraft,
      interpolation: aircraft.interpolation ? { ...aircraft.interpolation } : null
    };
  }
  function indexAircraftById(aircraftList) {
    const byId = /* @__PURE__ */ new Map();
    if (!Array.isArray(aircraftList)) {
      return byId;
    }
    for (const aircraft of aircraftList) {
      if (!isValidPositionRecord(aircraft)) {
        continue;
      }
      byId.set(String(aircraft.id), cloneAircraftRecord(aircraft));
    }
    return byId;
  }
  function createInterpolationState(options = {}) {
    const resolvedOptions = {
      ...DEFAULT_INTERPOLATION_OPTIONS,
      ...options
    };
    return {
      currentById: /* @__PURE__ */ new Map(),
      currentSampleAtMs: 0,
      generation: 0,
      lastFrameAtMs: 0,
      options: resolvedOptions,
      previousById: /* @__PURE__ */ new Map(),
      previousSampleAtMs: 0,
      transitionDurationMs: resolvedOptions.transitionDurationMs,
      transitionEndAtMs: 0,
      transitionStartAtMs: 0
    };
  }
  function commitAircraftSnapshot(state, aircraftList, sampleAtMs, options = {}) {
    const resolvedState = state || createInterpolationState(options);
    const resolvedOptions = {
      ...DEFAULT_INTERPOLATION_OPTIONS,
      ...resolvedState.options || {},
      ...options
    };
    const nextSampleAtMs = isFiniteNumber3(sampleAtMs) ? sampleAtMs : Date.now();
    resolvedState.previousById = resolvedState.currentById instanceof Map ? resolvedState.currentById : /* @__PURE__ */ new Map();
    resolvedState.previousSampleAtMs = resolvedState.currentSampleAtMs || nextSampleAtMs;
    resolvedState.currentById = indexAircraftById(aircraftList);
    resolvedState.currentSampleAtMs = nextSampleAtMs;
    resolvedState.transitionDurationMs = Math.max(0, resolvedOptions.transitionDurationMs);
    resolvedState.transitionStartAtMs = nextSampleAtMs;
    resolvedState.transitionEndAtMs = nextSampleAtMs + resolvedState.transitionDurationMs;
    resolvedState.generation = (resolvedState.generation || 0) + 1;
    resolvedState.options = resolvedOptions;
    return resolvedState;
  }
  function interpolateLongitude(startLon, endLon, progress) {
    const delta = wrapLongitudeDelta(endLon - startLon);
    const value = startLon + delta * progress;
    if (value > 180) {
      return value - 360;
    }
    if (value < -180) {
      return value + 360;
    }
    return value;
  }
  function resolveInterpolatedAircraft(previous, current, progress, options, frameTimeMs) {
    const interpolated = cloneAircraftRecord(current);
    const teleported = previous && distanceNm(previous, current) > options.maxTeleportDistanceNm;
    if (previous && !teleported && progress < 1) {
      interpolated.lat = lerp(previous.lat, current.lat, progress);
      interpolated.lon = interpolateLongitude(previous.lon, current.lon, progress);
      const heading = lerpAngleDegrees(previous.heading, current.heading, progress);
      interpolated.heading = heading === null ? current.heading : heading;
      interpolated.interpolation = {
        frameTimeMs,
        progress,
        teleported: false,
        interpolated: true,
        distanceNm: distanceNm(previous, current)
      };
      return interpolated;
    }
    interpolated.interpolation = {
      frameTimeMs,
      progress: 1,
      teleported: Boolean(teleported),
      interpolated: false,
      distanceNm: previous ? distanceNm(previous, current) : null
    };
    return interpolated;
  }
  function sampleInterpolatedAircraft(state, frameTimeMs, options = {}) {
    const resolvedState = state || createInterpolationState(options);
    const resolvedOptions = {
      ...DEFAULT_INTERPOLATION_OPTIONS,
      ...resolvedState.options || {},
      ...options
    };
    const frameAtMs = isFiniteNumber3(frameTimeMs) ? frameTimeMs : Date.now();
    const currentById = resolvedState.currentById instanceof Map ? resolvedState.currentById : /* @__PURE__ */ new Map();
    const previousById = resolvedState.previousById instanceof Map ? resolvedState.previousById : /* @__PURE__ */ new Map();
    const transitionDurationMs = Math.max(0, resolvedState.transitionDurationMs || resolvedOptions.transitionDurationMs);
    const transitionStartAtMs = isFiniteNumber3(resolvedState.transitionStartAtMs) ? resolvedState.transitionStartAtMs : frameAtMs;
    const transitionEndAtMs = isFiniteNumber3(resolvedState.transitionEndAtMs) ? resolvedState.transitionEndAtMs : transitionStartAtMs + transitionDurationMs;
    const progress = transitionEndAtMs > transitionStartAtMs ? clamp2((frameAtMs - transitionStartAtMs) / (transitionEndAtMs - transitionStartAtMs), 0, 1) : 1;
    const aircraft = [];
    const stats = {
      carriedForward: 0,
      dropped: 0,
      interpolated: 0,
      newAircraft: 0,
      stale: 0,
      teleported: 0,
      total: 0
    };
    for (const [aircraftId, current] of currentById.entries()) {
      if (!isValidPositionRecord(current)) {
        stats.dropped += 1;
        continue;
      }
      if (isStaleAircraft(current, frameAtMs, resolvedOptions.staleAfterMs)) {
        stats.stale += 1;
        continue;
      }
      const previous = previousById.get(aircraftId) || null;
      const interpolated = resolveInterpolatedAircraft(previous, current, progress, resolvedOptions, frameAtMs);
      if (interpolated.interpolation.teleported) {
        stats.teleported += 1;
      } else if (interpolated.interpolation.interpolated) {
        stats.interpolated += 1;
      } else if (previous) {
        stats.carriedForward += 1;
      } else {
        stats.newAircraft += 1;
      }
      aircraft.push(interpolated);
      stats.total += 1;
    }
    return {
      aircraft,
      generation: resolvedState.generation || 0,
      progress,
      transitionDurationMs,
      transitionEndAtMs,
      transitionStartAtMs,
      stats
    };
  }
  function updateInterpolationFromState(appState, sampleAtMs, options = {}) {
    if (!appState) {
      return null;
    }
    if (!appState.interpolationState) {
      appState.interpolationState = createInterpolationState(options);
    }
    const aircraftList = Array.isArray(appState.aircraft) ? appState.aircraft : [];
    return commitAircraftSnapshot(appState.interpolationState, aircraftList, sampleAtMs, options);
  }

  // src/render/trails.js
  var DEFAULT_TRAIL_OPTIONS = {
    maxAgeMs: 6e4,
    maxPoints: 36,
    minMovementMeters: 200,
    minSampleSpacingMs: 800,
    retainMissingMs: 45e3
  };
  function isFiniteNumber4(value) {
    return Number.isFinite(value);
  }
  function toRadians2(degrees) {
    return degrees * Math.PI / 180;
  }
  function haversineDistanceMeters2(startLat, startLon, endLat, endLon) {
    const earthRadiusM = 63710088e-1;
    const phi1 = toRadians2(startLat);
    const phi2 = toRadians2(endLat);
    const deltaPhi = toRadians2(endLat - startLat);
    const deltaLambda = toRadians2(endLon - startLon);
    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusM * c;
  }
  function createTrailStore(options = {}) {
    return {
      byId: /* @__PURE__ */ new Map(),
      options: {
        ...DEFAULT_TRAIL_OPTIONS,
        ...options
      }
    };
  }
  function isValidTrailAircraft(aircraft) {
    return Boolean(
      aircraft && aircraft.id !== void 0 && aircraft.id !== null && isFiniteNumber4(aircraft.lat) && isFiniteNumber4(aircraft.lon)
    );
  }
  function getOrCreateTrail(store, aircraftId) {
    let trail = store.byId.get(aircraftId);
    if (!trail) {
      trail = {
        aircraftId,
        lastSeenAtMs: 0,
        lastSampleAtMs: 0,
        points: []
      };
      store.byId.set(aircraftId, trail);
    }
    return trail;
  }
  function shouldAppendTrailPoint(trail, aircraft, sampleAtMs, options) {
    if (!trail.points.length) {
      return true;
    }
    const lastPoint = trail.points[trail.points.length - 1];
    const sampleSpacingMs = sampleAtMs - (lastPoint.sampledAtMs || 0);
    if (sampleSpacingMs >= options.minSampleSpacingMs) {
      return true;
    }
    const movementMeters = haversineDistanceMeters2(lastPoint.lat, lastPoint.lon, aircraft.lat, aircraft.lon);
    return movementMeters >= options.minMovementMeters;
  }
  function pruneTrailPoints(trail, nowMs, options) {
    const maxAgeMs = Math.max(0, options.maxAgeMs);
    const cutoff = nowMs - maxAgeMs;
    while (trail.points.length && trail.points[0].sampledAtMs < cutoff) {
      trail.points.shift();
    }
    if (trail.points.length > options.maxPoints) {
      trail.points.splice(0, trail.points.length - options.maxPoints);
    }
  }
  function recordTrailSample(store, aircraft, sampleAtMs, options = {}) {
    if (!store || !isValidTrailAircraft(aircraft)) {
      return null;
    }
    const resolvedOptions = {
      ...DEFAULT_TRAIL_OPTIONS,
      ...store.options || {},
      ...options
    };
    const nowMs = isFiniteNumber4(sampleAtMs) ? sampleAtMs : Date.now();
    const aircraftId = String(aircraft.id);
    const trail = getOrCreateTrail(store, aircraftId);
    trail.lastSeenAtMs = nowMs;
    trail.lastSampleAtMs = nowMs;
    if (shouldAppendTrailPoint(trail, aircraft, nowMs, resolvedOptions)) {
      trail.points.push({
        aircraftId,
        heading: isFiniteNumber4(aircraft.heading) ? aircraft.heading : null,
        lat: aircraft.lat,
        lon: aircraft.lon,
        onGround: Boolean(aircraft.onGround),
        sampledAtMs: nowMs,
        speedKt: isFiniteNumber4(aircraft.speedKt) ? aircraft.speedKt : null,
        updatedAtMs: isFiniteNumber4(aircraft.updatedAt) ? aircraft.updatedAt : null
      });
    }
    pruneTrailPoints(trail, nowMs, resolvedOptions);
    return trail;
  }
  function recordTrailSnapshot(store, aircraftList, sampleAtMs, options = {}) {
    if (!store || !Array.isArray(aircraftList)) {
      return store;
    }
    const resolvedOptions = {
      ...DEFAULT_TRAIL_OPTIONS,
      ...store.options || {},
      ...options
    };
    const nowMs = isFiniteNumber4(sampleAtMs) ? sampleAtMs : Date.now();
    for (const aircraft of aircraftList) {
      recordTrailSample(store, aircraft, nowMs, resolvedOptions);
    }
    pruneTrailStore(store, nowMs, resolvedOptions);
    return store;
  }
  function pruneTrailStore(store, nowMs, options = {}) {
    if (!store || !(store.byId instanceof Map)) {
      return store;
    }
    const resolvedOptions = {
      ...DEFAULT_TRAIL_OPTIONS,
      ...store.options || {},
      ...options
    };
    const cutoff = (isFiniteNumber4(nowMs) ? nowMs : Date.now()) - Math.max(0, resolvedOptions.retainMissingMs);
    for (const [aircraftId, trail] of store.byId.entries()) {
      if (trail.lastSeenAtMs < cutoff) {
        store.byId.delete(aircraftId);
        continue;
      }
      pruneTrailPoints(trail, nowMs, resolvedOptions);
      if (!trail.points.length) {
        store.byId.delete(aircraftId);
      }
    }
    return store;
  }
  function shouldRenderTrailForAircraft(aircraftId, context = {}) {
    const mode = context.mode || "selected-only";
    const selectedAircraftId = context.selectedAircraftId ?? null;
    const hoveredAircraftId = context.hoveredAircraftId ?? null;
    const normalizedAircraftId = aircraftId === void 0 || aircraftId === null ? null : String(aircraftId);
    const normalizedSelectedId = selectedAircraftId === void 0 || selectedAircraftId === null ? null : String(selectedAircraftId);
    const normalizedHoveredId = hoveredAircraftId === void 0 || hoveredAircraftId === null ? null : String(hoveredAircraftId);
    switch (mode) {
      case "off":
        return false;
      case "all":
        return true;
      case "hovered-only":
        return normalizedHoveredId !== null && normalizedAircraftId === normalizedHoveredId;
      case "selected-and-hovered":
        return normalizedSelectedId !== null && normalizedAircraftId === normalizedSelectedId || normalizedHoveredId !== null && normalizedAircraftId === normalizedHoveredId;
      case "selected-only":
      default:
        return normalizedSelectedId !== null && normalizedAircraftId === normalizedSelectedId;
    }
  }
  function collectRenderableTrails(store, context = {}) {
    if (!store || !(store.byId instanceof Map)) {
      return [];
    }
    const trails = [];
    for (const [aircraftId, trail] of store.byId.entries()) {
      if (!shouldRenderTrailForAircraft(aircraftId, context)) {
        continue;
      }
      if (!trail.points.length) {
        continue;
      }
      trails.push({
        aircraftId,
        hovered: context.hoveredAircraftId !== null && String(context.hoveredAircraftId) === String(aircraftId),
        lastSeenAtMs: trail.lastSeenAtMs,
        points: trail.points.map((point) => ({ ...point })),
        selected: context.selectedAircraftId !== null && String(context.selectedAircraftId) === String(aircraftId)
      });
    }
    trails.sort((left, right) => {
      const leftPriority = left.selected ? 0 : left.hovered ? 1 : 2;
      const rightPriority = right.selected ? 0 : right.hovered ? 1 : 2;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return right.lastSeenAtMs - left.lastSeenAtMs;
    });
    return trails;
  }
  function recordTrailSnapshotFromState(store, appState, sampleAtMs, options = {}) {
    if (!appState) {
      return store;
    }
    const aircraftList = Array.isArray(appState.aircraft) ? appState.aircraft : [];
    return recordTrailSnapshot(store, aircraftList, sampleAtMs, options);
  }
  function updateTrailStoreFromState(appState, sampleAtMs, options = {}) {
    if (!appState) {
      return null;
    }
    if (!appState.trailStore) {
      appState.trailStore = createTrailStore(options);
    }
    return recordTrailSnapshotFromState(appState.trailStore, appState, sampleAtMs, options);
  }

  // src/render/canvas.js
  var DEFAULT_CANVAS_THEME = {
    clusterFill: "rgba(255, 209, 102, 0.94)",
    clusterShadow: "rgba(7, 17, 29, 0.28)",
    clusterStroke: "#07111d",
    labelFill: "rgba(6, 10, 18, 0.92)",
    labelStroke: "rgba(120, 190, 255, 0.22)",
    labelText: "#f3f7ff",
    markerColor: "#59d7ff",
    markerHighlightColor: "#ffd166",
    markerSelectedColor: "#9ef3ff",
    markerShadowColor: "rgba(7, 17, 29, 0.28)",
    markerStrokeColor: "#07111d",
    spiderfyLineColor: "rgba(255, 209, 102, 0.42)",
    spiderfyNodeFill: "#ffd166",
    spiderfyNodeStroke: "#07111d",
    trailColor: "rgba(89, 215, 255, 0.55)",
    trailSelectedColor: "rgba(255, 209, 102, 0.78)",
    trailShadowColor: "rgba(7, 17, 29, 0.22)"
  };
  function clamp3(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function isFiniteNumber5(value) {
    return Number.isFinite(value);
  }
  function normalizeColorLayer(color, opacity) {
    if (typeof color !== "string") {
      return color;
    }
    if (!isFiniteNumber5(opacity) || opacity >= 1) {
      return color;
    }
    return color;
  }
  function roundRectPath(ctx, x, y, width, height, radius) {
    const r = clamp3(radius, 0, Math.min(width, height) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  function resizeCanvasForViewport(canvasEl, ctx, viewportRect, devicePixelRatio = 1) {
    if (!canvasEl || !ctx || !viewportRect) {
      return {
        pixelHeight: 0,
        pixelWidth: 0,
        resized: false,
        width: 0,
        height: 0
      };
    }
    const width = Math.max(1, Math.round(viewportRect.width));
    const height = Math.max(1, Math.round(viewportRect.height));
    const pixelWidth = Math.max(1, Math.round(width * devicePixelRatio));
    const pixelHeight = Math.max(1, Math.round(height * devicePixelRatio));
    let resized = false;
    canvasEl.style.left = `${Math.round(viewportRect.left)}px`;
    canvasEl.style.top = `${Math.round(viewportRect.top)}px`;
    canvasEl.style.width = `${width}px`;
    canvasEl.style.height = `${height}px`;
    if (canvasEl.width !== pixelWidth || canvasEl.height !== pixelHeight) {
      canvasEl.width = pixelWidth;
      canvasEl.height = pixelHeight;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(devicePixelRatio, devicePixelRatio);
      resized = true;
    }
    return {
      pixelHeight,
      pixelWidth,
      resized,
      width,
      height
    };
  }
  function clearCanvas(ctx, width, height) {
    if (!ctx || !isFiniteNumber5(width) || !isFiniteNumber5(height)) {
      return;
    }
    ctx.clearRect(0, 0, width, height);
  }
  function measureTextBubble(ctx, text, options = {}) {
    const fontSize = options.fontSize ?? 12;
    const fontFamily = options.fontFamily ?? '"Segoe UI", Tahoma, sans-serif';
    const lineHeight = options.lineHeight ?? 1.35;
    const paddingX = options.paddingX ?? 10;
    const paddingY = options.paddingY ?? 7;
    const lines = String(text ?? "").split("\n");
    if (!ctx) {
      const width = Math.max(1, String(text ?? "").length * fontSize * 0.5 + paddingX * 2);
      const height = lines.length * fontSize * lineHeight + paddingY * 2;
      return {
        height,
        lineHeight,
        lines,
        paddingX,
        paddingY,
        width
      };
    }
    const previousFont = ctx.font;
    ctx.font = `${fontSize}px ${fontFamily}`;
    let maxWidth = 0;
    for (const line of lines) {
      maxWidth = Math.max(maxWidth, ctx.measureText(line).width);
    }
    ctx.font = previousFont;
    return {
      height: lines.length * fontSize * lineHeight + paddingY * 2,
      lineHeight,
      lines,
      paddingX,
      paddingY,
      width: maxWidth + paddingX * 2
    };
  }
  function shouldRenderAircraftLabel(aircraftId, context = {}) {
    const mode = context.mode || "off";
    const normalizedAircraftId = aircraftId === void 0 || aircraftId === null ? null : String(aircraftId);
    const normalizedSelectedId = context.selectedAircraftId === void 0 || context.selectedAircraftId === null ? null : String(context.selectedAircraftId);
    const normalizedHoveredId = context.hoveredAircraftId === void 0 || context.hoveredAircraftId === null ? null : String(context.hoveredAircraftId);
    const minZoomForLabels = context.minZoomForLabels ?? 11;
    const zoom = isFiniteNumber5(context.zoom) ? context.zoom : null;
    switch (mode) {
      case "off":
        return false;
      case "high-zoom-visible":
        return zoom !== null && zoom >= minZoomForLabels && Boolean(context.isVisible ?? true);
      case "selected-and-hovered-only":
      default:
        return normalizedSelectedId !== null && normalizedAircraftId === normalizedSelectedId || normalizedHoveredId !== null && normalizedAircraftId === normalizedHoveredId;
    }
  }
  function drawTrail(ctx, points, options = {}) {
    if (!ctx || !Array.isArray(points) || points.length === 0) {
      return null;
    }
    const theme = { ...DEFAULT_CANVAS_THEME, ...options.theme || {} };
    const lineWidth = options.lineWidth ?? 2;
    const color = options.color ?? theme.trailColor;
    const selected = Boolean(options.selected);
    const opacity = isFiniteNumber5(options.opacity) ? clamp3(options.opacity, 0, 1) : 1;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = selected ? theme.trailSelectedColor : normalizeColorLayer(color, opacity);
    ctx.shadowBlur = options.shadowBlur ?? 8;
    ctx.shadowColor = theme.trailShadowColor;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      ctx.lineTo(points[index].x, points[index].y);
    }
    ctx.stroke();
    const pointRadius = options.pointRadius ?? 2.25;
    ctx.shadowBlur = 0;
    ctx.fillStyle = selected ? theme.markerSelectedColor : color;
    for (const point of points) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, pointRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return {
      end: points[points.length - 1],
      start: points[0]
    };
  }
  function drawAircraftMarker(ctx, marker, options = {}) {
    if (!ctx || !marker) {
      return null;
    }
    const theme = { ...DEFAULT_CANVAS_THEME, ...options.theme || {} };
    const size = options.sizePx ?? marker.sizePx ?? 10;
    const heading = isFiniteNumber5(marker.heading) ? marker.heading : marker.aircraft && isFiniteNumber5(marker.aircraft.heading) ? marker.aircraft.heading : null;
    const highlighted = Boolean(options.highlighted ?? marker.highlighted);
    const selected = Boolean(options.selected ?? marker.selected);
    const faded = Boolean(options.faded ?? marker.faded);
    const opacity = faded ? options.opacity ?? 0.48 : options.opacity ?? 1;
    const fillColor = selected ? theme.markerSelectedColor : highlighted ? theme.markerHighlightColor : options.fillColor ?? theme.markerColor;
    const strokeColor = options.strokeColor ?? theme.markerStrokeColor;
    ctx.save();
    ctx.translate(marker.x, marker.y);
    ctx.globalAlpha = clamp3(opacity, 0, 1);
    ctx.shadowBlur = options.shadowBlur ?? 10;
    ctx.shadowColor = theme.markerShadowColor;
    if (highlighted || selected) {
      ctx.beginPath();
      ctx.arc(0, 0, size + (selected ? 6 : 4), 0, Math.PI * 2);
      ctx.fillStyle = selected ? "rgba(158, 243, 255, 0.18)" : "rgba(255, 209, 102, 0.18)";
      ctx.fill();
    }
    if (isFiniteNumber5(heading)) {
      ctx.rotate((heading % 360 + 360) % 360 * (Math.PI / 180));
    }
    ctx.lineWidth = selected ? 2.25 : highlighted ? 2 : 1.5;
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = fillColor;
    if (isFiniteNumber5(heading)) {
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(size * 0.65, size * 0.82);
      ctx.lineTo(0, size * 0.3);
      ctx.lineTo(-size * 0.65, size * 0.82);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    return {
      height: size * 2,
      radius: size + (selected ? 6 : highlighted ? 4 : 0),
      width: size * 2,
      x: marker.x,
      y: marker.y
    };
  }
  function drawAircraftLabel(ctx, text, anchor, options = {}) {
    if (!ctx || !anchor || text === void 0 || text === null || String(text) === "") {
      return null;
    }
    const theme = { ...DEFAULT_CANVAS_THEME, ...options.theme || {} };
    const metrics = measureTextBubble(ctx, text, options);
    const offsetX = options.offsetX ?? 12;
    const offsetY = options.offsetY ?? -10;
    const fontSize = options.fontSize ?? 12;
    const x = anchor.x + offsetX;
    const y = anchor.y + offsetY - metrics.height + (options.anchor === "below" ? metrics.height : 0);
    const width = metrics.width;
    const height = metrics.height;
    const radius = options.radius ?? 10;
    const opacity = isFiniteNumber5(options.opacity) ? clamp3(options.opacity, 0, 1) : 1;
    const align = options.align ?? "left";
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.font = `${fontSize}px ${options.fontFamily ?? '"Segoe UI", Tahoma, sans-serif'}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = align === "right" ? "right" : "left";
    const boxX = align === "right" ? x - width : x;
    const boxY = y;
    roundRectPath(ctx, boxX, boxY, width, height, radius);
    ctx.fillStyle = options.fillStyle ?? theme.labelFill;
    ctx.fill();
    ctx.lineWidth = options.lineWidth ?? 1;
    ctx.strokeStyle = options.strokeStyle ?? theme.labelStroke;
    ctx.stroke();
    ctx.fillStyle = options.textColor ?? theme.labelText;
    const lines = String(text).split("\n");
    const paddingX = metrics.paddingX;
    const paddingY = metrics.paddingY;
    const lineHeight = options.lineHeight ?? metrics.lineHeight;
    const startY = boxY + paddingY + fontSize / 2;
    const textX = align === "right" ? boxX + width - paddingX : boxX + paddingX;
    for (let index = 0; index < lines.length; index += 1) {
      const lineY = startY + index * fontSize * lineHeight;
      ctx.fillText(lines[index], textX, lineY);
    }
    ctx.restore();
    return {
      height,
      width,
      x: boxX,
      y: boxY
    };
  }
  function drawClusterBubble(ctx, cluster, options = {}) {
    if (!ctx || !cluster) {
      return null;
    }
    const theme = { ...DEFAULT_CANVAS_THEME, ...options.theme || {} };
    const count = Math.max(1, Math.round(cluster.count ?? 1));
    const radius = options.radiusPx ?? cluster.radiusPx ?? clamp3(12 + Math.log10(count + 1) * 10, 12, 28);
    const highlighted = Boolean(options.highlighted ?? cluster.highlighted);
    const selected = Boolean(options.selected ?? cluster.selected);
    const opacity = isFiniteNumber5(options.opacity) ? clamp3(options.opacity, 0, 1) : 1;
    ctx.save();
    ctx.translate(cluster.x, cluster.y);
    ctx.globalAlpha = opacity;
    ctx.shadowBlur = options.shadowBlur ?? 10;
    ctx.shadowColor = theme.clusterShadow;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = options.fillStyle ?? theme.clusterFill;
    ctx.fill();
    ctx.lineWidth = selected ? 2.5 : highlighted ? 2 : 1.5;
    ctx.strokeStyle = options.strokeStyle ?? theme.clusterStroke;
    ctx.stroke();
    const label = options.label ?? String(cluster.label ?? count);
    ctx.shadowBlur = 0;
    ctx.fillStyle = options.textColor ?? theme.clusterStroke;
    ctx.font = `${options.fontSize ?? 12}px ${options.fontFamily ?? '"Segoe UI", Tahoma, sans-serif'}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, 1);
    ctx.restore();
    return {
      count,
      radius,
      x: cluster.x,
      y: cluster.y
    };
  }
  function drawSpiderfyConnector(ctx, centerX, centerY, memberX, memberY, options = {}) {
    if (!ctx) {
      return null;
    }
    const theme = { ...DEFAULT_CANVAS_THEME, ...options.theme || {} };
    const opacity = isFiniteNumber5(options.opacity) ? clamp3(options.opacity, 0, 1) : 1;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(memberX, memberY);
    ctx.lineWidth = options.lineWidth ?? 1.5;
    ctx.strokeStyle = options.strokeStyle ?? theme.spiderfyLineColor;
    ctx.stroke();
    ctx.restore();
    return {
      centerX,
      centerY,
      memberX,
      memberY
    };
  }
  function drawSpiderfyLayout(ctx, spiderfy, options = {}) {
    if (!ctx || !spiderfy || !Array.isArray(spiderfy.members) || spiderfy.members.length === 0) {
      return null;
    }
    const theme = { ...DEFAULT_CANVAS_THEME, ...options.theme || {} };
    const centerX = spiderfy.centerX;
    const centerY = spiderfy.centerY;
    const memberRadiusPx = options.memberRadiusPx ?? spiderfy.memberRadiusPx ?? 7;
    const members = [];
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const member of spiderfy.members) {
      drawSpiderfyConnector(ctx, centerX, centerY, member.x, member.y, {
        ...options,
        strokeStyle: options.connectorColor ?? theme.spiderfyLineColor
      });
      members.push(
        drawAircraftMarker(
          ctx,
          {
            highlighted: member.highlighted,
            heading: member.heading,
            selected: member.selected,
            x: member.x,
            y: member.y
          },
          {
            ...options,
            opacity: member.opacity,
            sizePx: memberRadiusPx,
            theme
          }
        )
      );
      if (member.label) {
        drawAircraftLabel(
          ctx,
          member.label,
          {
            x: member.x,
            y: member.y
          },
          {
            ...options,
            align: "left",
            offsetX: 10,
            offsetY: -10,
            theme
          }
        );
      }
    }
    drawClusterBubble(
      ctx,
      {
        count: spiderfy.members.length,
        x: centerX,
        y: centerY
      },
      {
        ...options,
        fillStyle: options.centerFillStyle ?? "rgba(255, 209, 102, 0.18)",
        strokeStyle: options.centerStrokeStyle ?? theme.spiderfyLineColor,
        textColor: options.centerTextColor ?? theme.labelText,
        radiusPx: options.centerRadiusPx ?? 8
      }
    );
    ctx.restore();
    return {
      centerX,
      centerY,
      members
    };
  }

  // src/styles.js
  var OVERLAY_STYLES = `
  #gm-flight-overlay-root {
    position: fixed;
    inset: 0;
    z-index: 2147483645;
    pointer-events: none;
    font-family: "Segoe UI", Tahoma, sans-serif;
    color: #f3f7ff;
  }

  #gm-flight-overlay-canvas {
    position: fixed;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
    pointer-events: none;
  }

  #gm-flight-overlay-badge {
    position: fixed;
    right: 14px;
    top: 14px;
    max-width: 280px;
    pointer-events: none;
    border: 1px solid rgba(120, 190, 255, 0.18);
    background: rgba(5, 10, 18, 0.86);
    border-radius: 14px;
    padding: 8px 11px;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
    backdrop-filter: blur(10px);
    font-size: 11px;
    font-weight: 600;
    line-height: 1.35;
    letter-spacing: 0.02em;
    white-space: pre-line;
  }

  #gm-flight-overlay-badge[data-level="ok"] {
    border-color: rgba(83, 216, 141, 0.3);
  }

  #gm-flight-overlay-badge[data-level="warn"] {
    border-color: rgba(255, 209, 102, 0.34);
  }

  #gm-flight-overlay-badge[data-level="error"] {
    border-color: rgba(255, 107, 107, 0.38);
  }

  #gm-flight-overlay-launcher {
    position: fixed;
    left: 16px;
    bottom: 16px;
    min-width: 140px;
    height: 58px;
    padding: 0 18px 0 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    pointer-events: auto;
    cursor: pointer;
    border: 1px solid rgba(120, 190, 255, 0.26);
    border-radius: 999px;
    background:
      radial-gradient(circle at top left, rgba(89, 215, 255, 0.12), transparent 45%),
      linear-gradient(180deg, rgba(10, 18, 31, 0.96), rgba(5, 10, 18, 0.98));
    color: #f3f7ff;
    box-shadow: 0 14px 28px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(10px);
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.03em;
    user-select: none;
  }

  #gm-flight-overlay-launcher[data-open="true"] {
    border-color: rgba(89, 215, 255, 0.44);
    box-shadow: 0 14px 28px rgba(0, 0, 0, 0.28), 0 0 0 3px rgba(89, 215, 255, 0.14);
  }

  .gm-flight-overlay-launcher-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(89, 215, 255, 0.12);
    font-size: 16px;
  }

  .gm-flight-overlay-panel {
    position: fixed;
    width: min(360px, calc(100vw - 24px));
    pointer-events: auto;
    border: 1px solid rgba(120, 190, 255, 0.2);
    background:
      radial-gradient(circle at top left, rgba(89, 215, 255, 0.08), transparent 38%),
      linear-gradient(180deg, rgba(9, 16, 27, 0.96), rgba(5, 10, 18, 0.97));
    color: #f3f7ff;
    border-radius: 16px;
    box-shadow: 0 16px 32px rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(12px);
    overflow: hidden;
    display: none;
  }

  .gm-flight-overlay-panel[data-open="true"] {
    display: flex;
    flex-direction: column;
  }

  .gm-flight-overlay-panel[data-panel="details"] {
    width: min(396px, calc(100vw - 24px));
  }

  .gm-flight-overlay-panel[data-panel="logs"] {
    width: min(540px, calc(100vw - 24px));
    max-height: min(58vh, 520px);
  }

  .gm-flight-overlay-panel[data-panel="debug"] {
    width: min(400px, calc(100vw - 24px));
    max-height: min(56vh, 480px);
  }

  .gm-flight-overlay-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.04);
    border-bottom: 1px solid rgba(120, 190, 255, 0.12);
    cursor: grab;
    user-select: none;
  }

  .gm-flight-overlay-panel-header:active {
    cursor: grabbing;
  }

  .gm-flight-overlay-panel-title {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .gm-flight-overlay-panel-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .gm-flight-overlay-button,
  .gm-flight-overlay-field,
  .gm-flight-overlay-select,
  .gm-flight-overlay-textarea {
    border: 1px solid rgba(120, 190, 255, 0.2);
    background: rgba(255, 255, 255, 0.05);
    color: #f3f7ff;
    border-radius: 10px;
    font: inherit;
  }

  .gm-flight-overlay-button {
    padding: 6px 10px;
    font-size: 11px;
    cursor: pointer;
    line-height: 1.2;
  }

  .gm-flight-overlay-button:hover {
    background: rgba(89, 215, 255, 0.12);
  }

  .gm-flight-overlay-button[data-variant="danger"] {
    border-color: rgba(255, 107, 107, 0.28);
  }

  .gm-flight-overlay-panel-body {
    padding: 12px;
    overflow: auto;
  }

  .gm-flight-overlay-menu-grid {
    display: grid;
    gap: 10px;
  }

  .gm-flight-overlay-menu-info,
  .gm-flight-overlay-debug-summary,
  .gm-flight-overlay-details-note {
    border: 1px solid rgba(120, 190, 255, 0.14);
    background: rgba(255, 255, 255, 0.03);
    border-radius: 12px;
    padding: 10px 11px;
    font-size: 12px;
    line-height: 1.45;
    white-space: pre-line;
  }

  .gm-flight-overlay-action-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .gm-flight-overlay-log-body,
  .gm-flight-overlay-debug-log,
  .gm-flight-overlay-textarea {
    font-family: Consolas, "Courier New", monospace;
    font-size: 11px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .gm-flight-overlay-log-body,
  .gm-flight-overlay-debug-log {
    overflow: auto;
  }

  .gm-flight-overlay-details-card {
    display: grid;
    gap: 12px;
  }

  .gm-flight-overlay-details-title {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .gm-flight-overlay-details-subtitle {
    color: rgba(243, 247, 255, 0.7);
    font-size: 13px;
    line-height: 1.4;
  }

  .gm-flight-overlay-details-photo,
  .gm-flight-overlay-details-photo-placeholder {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: 12px;
    border: 1px solid rgba(120, 190, 255, 0.18);
    background: rgba(255, 255, 255, 0.03);
  }

  .gm-flight-overlay-details-photo-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 14px;
    text-align: center;
    color: rgba(243, 247, 255, 0.72);
    font-size: 12px;
  }

  .gm-flight-overlay-details-grid {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr);
    gap: 8px 10px;
    font-size: 12px;
    line-height: 1.4;
  }

  .gm-flight-overlay-details-key {
    color: rgba(243, 247, 255, 0.62);
    font-weight: 600;
  }

  .gm-flight-overlay-details-value {
    color: #f3f7ff;
  }

  .gm-flight-overlay-settings-grid {
    display: grid;
    gap: 12px;
  }

  .gm-flight-overlay-settings-row {
    display: grid;
    gap: 6px;
  }

  .gm-flight-overlay-settings-row label {
    font-size: 12px;
    font-weight: 600;
    color: rgba(243, 247, 255, 0.82);
  }

  .gm-flight-overlay-field,
  .gm-flight-overlay-select {
    width: 100%;
    padding: 8px 10px;
    font-size: 12px;
  }

  .gm-flight-overlay-textarea {
    width: 100%;
    min-height: 120px;
    padding: 10px;
    resize: vertical;
  }

  .gm-flight-overlay-settings-actions,
  .gm-flight-overlay-debug-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  #gm-flight-overlay-tooltip {
    position: fixed;
    left: 0;
    top: 0;
    display: none;
    min-width: 170px;
    max-width: 280px;
    border-radius: 10px;
    border: 1px solid rgba(120, 190, 255, 0.22);
    background: rgba(6, 10, 18, 0.92);
    color: #f3f7ff;
    padding: 8px 10px;
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(8px);
    font-size: 12px;
    line-height: 1.35;
    white-space: pre-line;
  }
`;

  // src/ui/index.js
  function applyPanelPosition(el, position) {
    if (!el || !position) {
      return;
    }
    for (const prop of ["left", "right", "top", "bottom"]) {
      if (position[prop] === null || position[prop] === void 0) {
        el.style[prop] = "";
      } else {
        el.style[prop] = `${Math.round(position[prop])}px`;
      }
    }
  }
  function createButton(label, className = "gm-flight-overlay-button") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    return button;
  }
  function createPanel(state, key, title) {
    const panelEl = document.createElement("section");
    panelEl.className = "gm-flight-overlay-panel";
    panelEl.dataset.panel = key;
    const headerEl = document.createElement("div");
    headerEl.className = "gm-flight-overlay-panel-header";
    headerEl.dataset.dragHandle = key;
    const titleEl = document.createElement("div");
    titleEl.className = "gm-flight-overlay-panel-title";
    titleEl.textContent = title;
    const actionsEl = document.createElement("div");
    actionsEl.className = "gm-flight-overlay-panel-actions";
    const bodyEl = document.createElement("div");
    bodyEl.className = "gm-flight-overlay-panel-body";
    headerEl.appendChild(titleEl);
    headerEl.appendChild(actionsEl);
    panelEl.appendChild(headerEl);
    panelEl.appendChild(bodyEl);
    state.hudRootEl.appendChild(panelEl);
    return {
      panelEl,
      headerEl,
      titleEl,
      actionsEl,
      bodyEl
    };
  }
  function installDragHandler(context, panelKey, panelEl, handleEl) {
    const { state, saveSettings: saveSettings2 } = context;
    const onPointerMove = (event) => {
      if (!state.panelDrag || state.panelDrag.key !== panelKey) {
        return;
      }
      const nextLeft = event.clientX - state.panelDrag.offsetX;
      const nextTop = event.clientY - state.panelDrag.offsetY;
      state.settings.panelPositions[panelKey] = {
        left: Math.max(8, nextLeft),
        top: Math.max(8, nextTop),
        right: null,
        bottom: null
      };
      applyPanelPosition(panelEl, state.settings.panelPositions[panelKey]);
    };
    const onPointerUp = () => {
      if (!state.panelDrag || state.panelDrag.key !== panelKey) {
        return;
      }
      state.panelDrag = null;
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      void saveSettings2();
    };
    handleEl.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      const rect = panelEl.getBoundingClientRect();
      state.panelDrag = {
        key: panelKey,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
      };
      window.addEventListener("pointermove", onPointerMove, true);
      window.addEventListener("pointerup", onPointerUp, true);
    });
  }
  function createUiController(context) {
    const { state, settings, version, versionHistory, debug } = context;
    function saveSettingsSoon() {
      return context.saveSettings();
    }
    function setPanelVisible(panelKey, open) {
      state.settings.panelVisibility[panelKey] = Boolean(open);
      syncPanelOpenState();
      void saveSettingsSoon();
    }
    function syncPanelOpenState() {
      if (state.menuPanelEl) {
        state.menuPanelEl.dataset.open = state.settings.panelVisibility.menu ? "true" : "false";
      }
      if (state.menuButtonEl) {
        state.menuButtonEl.dataset.open = state.settings.panelVisibility.menu ? "true" : "false";
      }
      if (state.logPanelEl) {
        state.logPanelEl.dataset.open = state.settings.panelVisibility.logs ? "true" : "false";
      }
      if (state.detailsPanelEl) {
        const show = state.settings.panelVisibility.details && Boolean(state.selectedAircraftSnapshot);
        state.detailsPanelEl.dataset.open = show ? "true" : "false";
      }
      if (state.settingsPanelEl) {
        state.settingsPanelEl.dataset.open = state.settings.panelVisibility.settings ? "true" : "false";
      }
      if (state.debugPanelEl) {
        state.debugPanelEl.dataset.open = state.settings.panelVisibility.debug ? "true" : "false";
      }
    }
    function ensureHud() {
      if (state.hudRootEl && state.hudRootEl.isConnected) {
        return;
      }
      if (typeof GM_addStyle === "function") {
        GM_addStyle(OVERLAY_STYLES);
      }
      const root = document.createElement("div");
      root.id = "gm-flight-overlay-root";
      const canvasEl = document.createElement("canvas");
      canvasEl.id = "gm-flight-overlay-canvas";
      const badgeEl = document.createElement("div");
      badgeEl.id = "gm-flight-overlay-badge";
      badgeEl.dataset.level = "boot";
      const launcherEl = document.createElement("button");
      launcherEl.type = "button";
      launcherEl.id = "gm-flight-overlay-launcher";
      launcherEl.dataset.open = "false";
      launcherEl.innerHTML = `<span class="gm-flight-overlay-launcher-icon">\u2708</span><span>Flights</span>`;
      const tooltipEl = document.createElement("div");
      tooltipEl.id = "gm-flight-overlay-tooltip";
      root.appendChild(canvasEl);
      root.appendChild(badgeEl);
      root.appendChild(launcherEl);
      root.appendChild(tooltipEl);
      document.body.appendChild(root);
      state.hudRootEl = root;
      state.canvasEl = canvasEl;
      state.canvasCtx = canvasEl.getContext("2d");
      state.badgeEl = badgeEl;
      state.menuButtonEl = launcherEl;
      state.tooltipEl = tooltipEl;
      const menu = createPanel(state, "menu", "Overlay");
      const logs = createPanel(state, "logs", "Logs");
      const details = createPanel(state, "details", "Selected Flight");
      const settingsPanel = createPanel(state, "settings", "Settings");
      const debugPanel = createPanel(state, "debug", "Debug");
      state.menuPanelEl = menu.panelEl;
      state.menuInfoEl = document.createElement("div");
      state.menuInfoEl.className = "gm-flight-overlay-menu-info";
      menu.bodyEl.className = "gm-flight-overlay-panel-body gm-flight-overlay-menu-grid";
      menu.bodyEl.appendChild(state.menuInfoEl);
      const menuButtons = document.createElement("div");
      menuButtons.className = "gm-flight-overlay-action-grid";
      const toggleLogsButton = createButton("Toggle Logs");
      const openSettingsButton = createButton("Settings");
      const openDebugButton = createButton("Debug");
      const copyLogsButton = createButton("Copy Logs");
      const clearLogsButton = createButton("Clear Logs");
      const exportDebugButton = createButton("Export Debug");
      menuButtons.append(toggleLogsButton, openSettingsButton, openDebugButton, copyLogsButton, clearLogsButton, exportDebugButton);
      menu.bodyEl.appendChild(menuButtons);
      state.logPanelEl = logs.panelEl;
      state.logPanelBodyEl = document.createElement("div");
      state.logPanelBodyEl.className = "gm-flight-overlay-log-body";
      logs.bodyEl.appendChild(state.logPanelBodyEl);
      logs.actionsEl.append(
        createButton("Copy"),
        createButton("Clear"),
        createButton("Hide")
      );
      state.detailsPanelEl = details.panelEl;
      state.detailsPanelBodyEl = document.createElement("div");
      details.bodyEl.appendChild(state.detailsPanelBodyEl);
      details.actionsEl.append(createButton("Hide"));
      state.settingsPanelEl = settingsPanel.panelEl;
      settingsPanel.bodyEl.className = "gm-flight-overlay-panel-body gm-flight-overlay-settings-grid";
      const settingsRows = createSettingsForm(context);
      settingsPanel.bodyEl.append(...settingsRows.elements);
      state.debugPanelEl = debugPanel.panelEl;
      state.debugPanelBodyEl = document.createElement("div");
      state.debugPanelBodyEl.className = "gm-flight-overlay-debug-log";
      const debugSummary = document.createElement("div");
      debugSummary.className = "gm-flight-overlay-debug-summary";
      const replayInput = document.createElement("textarea");
      replayInput.className = "gm-flight-overlay-textarea";
      replayInput.placeholder = "Paste replay JSON here";
      const debugActions = document.createElement("div");
      debugActions.className = "gm-flight-overlay-debug-actions";
      const importReplayButton = createButton("Import Replay");
      const exportReplayButton = createButton("Export Replay");
      const clearReplayButton = createButton("Clear Replay");
      const copyDebugButton = createButton("Copy Debug");
      debugActions.append(importReplayButton, exportReplayButton, clearReplayButton, copyDebugButton);
      debugPanel.bodyEl.append(debugSummary, debugActions, replayInput, state.debugPanelBodyEl);
      const [logsCopyButton, logsClearButton, logsHideButton] = logs.actionsEl.querySelectorAll("button");
      const [detailsHideButton] = details.actionsEl.querySelectorAll("button");
      launcherEl.addEventListener("click", () => {
        setPanelVisible("menu", !state.settings.panelVisibility.menu);
      });
      toggleLogsButton.addEventListener("click", () => setPanelVisible("logs", !state.settings.panelVisibility.logs));
      openSettingsButton.addEventListener("click", () => setPanelVisible("settings", !state.settings.panelVisibility.settings));
      openDebugButton.addEventListener("click", () => setPanelVisible("debug", !state.settings.panelVisibility.debug));
      copyLogsButton.addEventListener("click", () => void context.copyLogsToClipboard());
      clearLogsButton.addEventListener("click", () => context.clearLogs());
      exportDebugButton.addEventListener("click", () => void context.copyDebugExport());
      logsCopyButton.addEventListener("click", () => void context.copyLogsToClipboard());
      logsClearButton.addEventListener("click", () => context.clearLogs());
      logsHideButton.addEventListener("click", () => setPanelVisible("logs", false));
      detailsHideButton.addEventListener("click", () => setPanelVisible("details", false));
      copyDebugButton.addEventListener("click", () => void context.copyDebugExport());
      importReplayButton.addEventListener("click", () => context.importReplayFromText(replayInput.value));
      exportReplayButton.addEventListener("click", () => void context.copyReplayExport());
      clearReplayButton.addEventListener("click", () => context.clearReplay());
      for (const [panelKey, panelRefs] of Object.entries({
        menu,
        logs,
        details,
        settings: settingsPanel,
        debug: debugPanel
      })) {
        applyPanelPosition(panelRefs.panelEl, settings.panelPositions[panelKey]);
        installDragHandler(context, panelKey, panelRefs.panelEl, panelRefs.headerEl);
      }
      syncPanelOpenState();
    }
    function createSettingsForm(contextRef) {
      const elements = [];
      const configs = [
        { key: "markerSizePx", label: "Marker Size", type: "number", min: "6", max: "20", step: "1" },
        { key: "hoverHitRadiusPx", label: "Hover Hit Radius", type: "number", min: "8", max: "42", step: "1" },
        { key: "labelMode", label: "Labels", type: "select", options: ["selected-and-hovered-only", "high-zoom-visible", "off"] },
        { key: "trailMode", label: "Trails", type: "select", options: ["selected-only", "selected-and-hovered", "off"] },
        { key: "densityMode", label: "Density", type: "select", options: ["normal", "spiderfy", "declutter"] },
        { key: "photoMode", label: "Photos", type: "select", options: ["enabled", "disabled"] },
        { key: "debugLevel", label: "Debug Level", type: "select", options: ["off", "basic", "trace"] }
      ];
      for (const config of configs) {
        const row = document.createElement("div");
        row.className = "gm-flight-overlay-settings-row";
        const label = document.createElement("label");
        label.textContent = config.label;
        row.appendChild(label);
        let input;
        if (config.type === "select") {
          input = document.createElement("select");
          input.className = "gm-flight-overlay-select";
          for (const optionValue of config.options) {
            const option = document.createElement("option");
            option.value = optionValue;
            option.textContent = optionValue;
            input.appendChild(option);
          }
        } else {
          input = document.createElement("input");
          input.type = config.type;
          input.className = "gm-flight-overlay-field";
          if (config.min) input.min = config.min;
          if (config.max) input.max = config.max;
          if (config.step) input.step = config.step;
        }
        input.value = String(state.settings[config.key]);
        input.addEventListener("change", () => {
          state.settings[config.key] = config.type === "number" ? Number(input.value) : input.value;
          if (config.key === "debugLevel") {
            debug.setLevel(state.settings.debugLevel);
          }
          void contextRef.saveSettings();
          contextRef.scheduleRender();
          refreshAll();
        });
        row.appendChild(input);
        elements.push(row);
      }
      const actions = document.createElement("div");
      actions.className = "gm-flight-overlay-settings-actions";
      const exportSettingsButton = createButton("Export Settings");
      const copySettingsButton = createButton("Copy Settings");
      actions.append(exportSettingsButton, copySettingsButton);
      exportSettingsButton.addEventListener("click", () => contextRef.fillSettingsExport());
      copySettingsButton.addEventListener("click", () => void contextRef.copySettingsExport());
      elements.push(actions);
      const textarea = document.createElement("textarea");
      textarea.className = "gm-flight-overlay-textarea";
      textarea.placeholder = "Exported settings JSON appears here. You can also paste JSON here and use Import Settings.";
      elements.push(textarea);
      const importActions = document.createElement("div");
      importActions.className = "gm-flight-overlay-settings-actions";
      const importSettingsButton = createButton("Import Settings");
      importActions.append(importSettingsButton);
      importSettingsButton.addEventListener("click", () => contextRef.importSettingsFromText(textarea.value));
      elements.push(importActions);
      state.settingsExportTextarea = textarea;
      return { elements };
    }
    function updateBadge() {
      if (!state.badgeEl) {
        return;
      }
      const backoffSeconds = state.rateLimitBackoffUntil > Date.now() ? Math.ceil((state.rateLimitBackoffUntil - Date.now()) / 1e3) : 0;
      let summary = `Flight Overlay v${version}
${state.statusText}`;
      if (state.mapState) {
        summary += `
Map: ${formatZoomSummary(state.mapState)} @ ${formatLatLon(state.mapState.centerLat, state.mapState.centerLon)}`;
      }
      if (state.viewportRect) {
        summary += `
Viewport: ${Math.round(state.viewportRect.width)} x ${Math.round(state.viewportRect.height)}`;
      }
      summary += `
Visible: ${state.aircraft.length}`;
      if (state.densityScene && state.densityScene.stats) {
        summary += `
Groups: ${state.densityScene.stats.groupCount}`;
      }
      if (backoffSeconds > 0) {
        summary += `
Backoff: ${backoffSeconds}s`;
      }
      state.badgeEl.dataset.level = state.statusLevel;
      state.badgeEl.textContent = summary;
    }
    function updateMenuPanel() {
      if (!state.menuInfoEl) {
        return;
      }
      const lines = [
        `Version: ${version}`,
        `Status: ${state.statusLevel} ${state.statusText}`,
        state.mapState ? `Map: ${formatZoomSummary(state.mapState)} @ ${formatLatLon(state.mapState.centerLat, state.mapState.centerLon)}` : "Map: n/a",
        state.viewportRect ? `Viewport: ${Math.round(state.viewportRect.width)} x ${Math.round(state.viewportRect.height)}` : "Viewport: n/a",
        state.densityScene ? `Density: ${state.densityScene.mode} (${state.densityScene.stats.groupCount} groups)` : "Density: n/a",
        `Logs: ${debug.store.logs.length}`,
        `Latest: ${versionHistory[0].changes[0]}`
      ];
      state.menuInfoEl.textContent = lines.join("\n");
      syncPanelOpenState();
    }
    function updateLogPanel() {
      if (!state.logPanelBodyEl) {
        return;
      }
      state.logPanelBodyEl.textContent = debug.store.logs.map((entry) => {
        const lines = [`[${entry.ts}] ${entry.level.toUpperCase()} ${entry.message}`];
        if (entry.details !== null) {
          lines.push(JSON.stringify(entry.details, null, 2));
        }
        return lines.join("\n");
      }).join("\n\n");
      if (state.settings.panelVisibility.logs) {
        state.logPanelBodyEl.scrollTop = state.logPanelBodyEl.scrollHeight;
      }
    }
    function updateDetailsPanel() {
      if (!state.detailsPanelBodyEl) {
        return;
      }
      state.detailsPanelBodyEl.replaceChildren();
      if (!state.selectedAircraftSnapshot) {
        syncPanelOpenState();
        return;
      }
      const aircraft = state.selectedAircraftSnapshot;
      const details = state.selectedAircraftDetails;
      const wrapper = document.createElement("div");
      wrapper.className = "gm-flight-overlay-details-card";
      const title = document.createElement("div");
      title.className = "gm-flight-overlay-details-title";
      title.textContent = formatAircraftTitle(aircraft, details);
      wrapper.appendChild(title);
      const subtitle = document.createElement("div");
      subtitle.className = "gm-flight-overlay-details-subtitle";
      subtitle.textContent = formatAircraftSubtitle(aircraft, details);
      wrapper.appendChild(subtitle);
      const photoUrl = details && (details.photoThumbnailUrl || details.photoUrl);
      if (photoUrl) {
        const image = document.createElement("img");
        image.className = "gm-flight-overlay-details-photo";
        image.src = photoUrl;
        image.alt = title.textContent;
        wrapper.appendChild(image);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "gm-flight-overlay-details-photo-placeholder";
        placeholder.textContent = state.selectedAircraftDetailsLoading ? "Loading aircraft photo..." : "No aircraft photo available";
        wrapper.appendChild(placeholder);
      }
      const grid = document.createElement("div");
      grid.className = "gm-flight-overlay-details-grid";
      const rows = [
        ["Callsign", aircraft.callsign || "blank"],
        ["Registration", details && details.registration || aircraft.registration || "blank"],
        ["Hex", aircraft.id || "blank"],
        ["Type", details && (details.type || details.icaoType) || aircraft.aircraftType || "blank"],
        ["Operator", details && (details.airlineName || details.owner) || "blank"],
        ["Origin", formatRouteEndpoint(details && details.origin) || "blank"],
        ["Destination", formatRouteEndpoint(details && details.destination) || "blank"],
        ["Altitude", formatAltitude(aircraft)],
        ["Speed", formatSpeed(aircraft.speedKt)],
        ["Heading", formatHeading(aircraft.heading)],
        ["Updated", formatAge(aircraft.updatedAt)],
        ["Source", details && details.source ? details.source : "live"]
      ];
      for (const [key, value] of rows) {
        const keyEl = document.createElement("div");
        keyEl.className = "gm-flight-overlay-details-key";
        keyEl.textContent = key;
        const valueEl = document.createElement("div");
        valueEl.className = "gm-flight-overlay-details-value";
        valueEl.textContent = value;
        grid.append(keyEl, valueEl);
      }
      wrapper.appendChild(grid);
      const note = document.createElement("div");
      note.className = "gm-flight-overlay-details-note";
      if (state.selectedAircraftDetailsLoading) {
        note.textContent = "Loading aircraft photo and route details...";
      } else if (state.selectedAircraftDetailsError) {
        note.textContent = state.selectedAircraftDetailsError;
      } else if (details && details.routeAdvisory) {
        note.textContent = "Route data is advisory fallback information.";
      } else {
        note.textContent = "Click another aircraft to update the selected flight card.";
      }
      wrapper.appendChild(note);
      state.detailsPanelBodyEl.appendChild(wrapper);
      syncPanelOpenState();
    }
    function updateSettingsPanel() {
      if (!state.settingsExportTextarea) {
        return;
      }
      state.settingsExportTextarea.value = JSON.stringify(state.settings, null, 2);
    }
    function updateDebugPanel() {
      if (!state.debugPanelBodyEl) {
        return;
      }
      const summaryEl = state.debugPanelEl.querySelector(".gm-flight-overlay-debug-summary");
      if (summaryEl) {
        summaryEl.textContent = debug.buildSummaryText(context.buildDebugContext());
      }
      state.debugPanelBodyEl.textContent = debug.store.logs.slice(-12).map((entry) => {
        const lines = [`[${entry.ts}] ${entry.level.toUpperCase()} ${entry.message}`];
        if (entry.details !== null) {
          lines.push(JSON.stringify(entry.details, null, 2));
        }
        return lines.join("\n");
      }).join("\n\n");
    }
    function renderTooltip(marker) {
      if (!state.tooltipEl || !marker) {
        hideTooltip();
        return;
      }
      const lines = [
        marker.aircraft.callsign || "Unknown flight",
        `Alt: ${formatAltitude(marker.aircraft)}`,
        `Heading: ${formatHeading(marker.aircraft.heading)}`,
        `Speed: ${formatSpeed(marker.aircraft.speedKt)}`,
        `Hex: ${marker.aircraft.id}`,
        `Updated: ${formatAge(marker.aircraft.updatedAt)}`
      ];
      state.tooltipEl.textContent = lines.join("\n");
      state.tooltipEl.style.display = "block";
      const tooltipWidth = 220;
      const tooltipHeight = 124;
      const offset = 14;
      const left = Math.min(
        Math.max(8, state.mouseX + offset),
        Math.max(8, window.innerWidth - tooltipWidth - 8)
      );
      const top = Math.min(
        Math.max(8, state.mouseY + offset),
        Math.max(8, window.innerHeight - tooltipHeight - 8)
      );
      state.tooltipEl.style.left = `${Math.round(left)}px`;
      state.tooltipEl.style.top = `${Math.round(top)}px`;
    }
    function hideTooltip() {
      if (state.tooltipEl) {
        state.tooltipEl.style.display = "none";
      }
    }
    function refreshAll() {
      updateBadge();
      updateMenuPanel();
      updateLogPanel();
      updateDetailsPanel();
      updateSettingsPanel();
      updateDebugPanel();
    }
    async function copyDebugExport() {
      const text = JSON.stringify(context.buildDebugContext(), null, 2);
      await copyTextToClipboard(text);
    }
    return {
      ensureHud,
      setPanelVisible,
      syncPanelOpenState,
      updateBadge,
      updateMenuPanel,
      updateLogPanel,
      updateDetailsPanel,
      updateSettingsPanel,
      updateDebugPanel,
      renderTooltip,
      hideTooltip,
      refreshAll,
      copyDebugExport
    };
  }

  // src/index.js
  function run() {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    void startApp();
  }
  async function startApp() {
    const storage = createStorage();
    const settings = await loadSettings(storage);
    const state = createState(window, settings);
    state.interpolationState = createInterpolationState({
      transitionDurationMs: APP_CONFIG.interpolationDurationMs
    });
    state.trailStore = createTrailStore({
      maxAgeMs: APP_CONFIG.trailExpireMs,
      maxPoints: APP_CONFIG.trailMaxPoints
    });
    let ui = null;
    let mapController = null;
    let liveData = null;
    let enrichment = null;
    let enrichmentPhotoMode = null;
    const debug = createDebugService({
      level: settings.debugLevel,
      logBufferSize: APP_CONFIG.logBufferSize
    });
    function syncLogs() {
      state.logs = debug.store.logs;
      if (ui) {
        ui.updateLogPanel();
        ui.updateDebugPanel();
      }
    }
    function logEvent(level, message, details) {
      const entry = debug.log(level, message, details);
      const consolePrefix = `[gm-flight-overlay][${level}] ${message}`;
      if (level === "error") {
        console.error(consolePrefix, details);
      } else if (level === "warn") {
        console.warn(consolePrefix, details);
      } else if (state.settings.debugLevel === "trace" || level !== "debug") {
        console.log(consolePrefix, details);
      }
      syncLogs();
      return entry;
    }
    function buildDebugContext() {
      return {
        version: VERSION,
        settings: state.settings,
        statusLevel: state.statusLevel,
        statusText: state.statusText,
        rateLimitBackoffUntil: state.rateLimitBackoffUntil,
        density: {
          mode: state.densityScene ? state.densityScene.mode : "normal",
          visibleAircraftCount: state.aircraft.length,
          drawnAircraftCount: state.drawnMarkers.length,
          groupedCount: state.densityScene && state.densityScene.stats ? state.densityScene.stats.clusterCount : 0,
          spiderfiedCount: state.spiderfyGroupKey ? 1 : 0,
          trailCount: collectRenderableTrails(state.trailStore, {
            mode: state.settings.trailMode,
            selectedAircraftId: state.selectedAircraftId,
            hoveredAircraftId: state.hoverMarkerId
          }).length
        },
        selectedAircraft: state.selectedAircraftSnapshot,
        selectedAircraftDetails: state.selectedAircraftDetails,
        enrichment: {
          source: state.selectedAircraftDetails ? state.selectedAircraftDetails.source : "none",
          loading: state.selectedAircraftDetailsLoading,
          hasPhoto: Boolean(
            state.selectedAircraftDetails && (state.selectedAircraftDetails.photoUrl || state.selectedAircraftDetails.photoThumbnailUrl)
          ),
          hasRoute: Boolean(
            state.selectedAircraftDetails && (state.selectedAircraftDetails.origin || state.selectedAircraftDetails.destination)
          ),
          error: state.selectedAircraftDetailsError || null,
          advisory: Boolean(state.selectedAircraftDetails && state.selectedAircraftDetails.routeAdvisory)
        },
        viewport: {
          bound: Boolean(state.viewportRect),
          rect: state.viewportRect,
          reason: state.lastPauseReason || "",
          viewportId: state.viewportEl ? state.viewportEl.id || null : null,
          className: state.viewportEl ? state.viewportEl.className || null : null,
          lastScanAt: state.lastViewportScanAt
        },
        replay: {
          active: state.replayMode,
          mode: state.replayMode ? "replay" : "inactive",
          currentIndex: state.replayFrameIndex
        },
        replaySnapshots: state.replayFrames,
        lastFetch: state.lastFetchSummary,
        logs: debug.store.logs
      };
    }
    function setStatus(level, text) {
      state.statusLevel = level;
      state.statusText = text;
      if (ui) {
        ui.updateBadge();
        ui.updateMenuPanel();
        ui.updateDebugPanel();
      }
    }
    function saveSettingsNow() {
      debug.setLevel(state.settings.debugLevel);
      enrichmentPhotoMode = null;
      return saveSettings(storage, state.settings);
    }
    function replaceSettings(nextSettings) {
      for (const key of Object.keys(state.settings)) {
        delete state.settings[key];
      }
      Object.assign(state.settings, nextSettings);
      debug.setLevel(state.settings.debugLevel);
      enrichmentPhotoMode = null;
    }
    function buildLogDump() {
      const lines = [
        "Google Maps Flight Overlay log dump",
        `version: ${VERSION}`,
        `generatedAt: ${(/* @__PURE__ */ new Date()).toISOString()}`,
        `href: ${window.location.href}`,
        `status: ${state.statusLevel} ${state.statusText}`,
        `aircraftCount: ${state.aircraft.length}`
      ];
      if (state.mapState) {
        lines.push(
          `mapState: center=${state.mapState.centerLat},${state.mapState.centerLon} zoom=${state.mapState.zoom} source=${state.mapState.zoomSource || "unknown"}`
        );
      } else {
        lines.push("mapState: null");
      }
      if (state.viewportRect) {
        lines.push(
          `viewport: left=${Math.round(state.viewportRect.left)} top=${Math.round(state.viewportRect.top)} width=${Math.round(state.viewportRect.width)} height=${Math.round(state.viewportRect.height)}`
        );
      } else {
        lines.push("viewport: null");
      }
      lines.push("versionHistory:");
      for (const entry of VERSION_HISTORY) {
        lines.push(`- ${entry.version} (${entry.date})`);
        for (const change of entry.changes) {
          lines.push(`  * ${change}`);
        }
      }
      lines.push("logs:");
      for (const entry of debug.store.logs) {
        lines.push(`[${entry.ts}] ${entry.level.toUpperCase()} ${entry.message}`);
        if (entry.details !== null) {
          lines.push(JSON.stringify(entry.details, null, 2));
        }
      }
      return lines.join("\n");
    }
    async function copyLogsToClipboard() {
      await copyTextToClipboard(buildLogDump());
      logEvent("info", "Copied logs to clipboard");
      setStatus("ok", "Logs copied to clipboard");
    }
    async function copyDebugExport() {
      await copyTextToClipboard(JSON.stringify(debug.buildDebugExport(buildDebugContext()), null, 2));
      logEvent("info", "Copied debug export");
      setStatus("ok", "Debug export copied");
    }
    async function copyReplayExport() {
      await copyTextToClipboard(JSON.stringify(debug.exportReplayPayload(), null, 2));
      logEvent("info", "Copied replay export");
      setStatus("ok", "Replay export copied");
    }
    async function copySettingsExport() {
      await copyTextToClipboard(JSON.stringify(state.settings, null, 2));
      logEvent("info", "Copied settings export");
      setStatus("ok", "Settings copied");
    }
    async function fillSettingsExport() {
      if (state.settingsExportTextarea) {
        state.settingsExportTextarea.value = JSON.stringify(state.settings, null, 2);
      }
    }
    async function importSettingsFromText(text) {
      const nextSettings = await importSettings(storage, text);
      replaceSettings(nextSettings);
      if (ui) {
        ui.refreshAll();
      }
      logEvent("info", "Imported settings");
      setStatus("ok", "Settings imported");
      scheduleRender();
    }
    function clearLogs() {
      debug.clearLogs();
      syncLogs();
      logEvent("info", "Cleared log panel");
      setStatus("ok", "Logs cleared");
    }
    function getTheme() {
      return {
        ...DEFAULT_CANVAS_THEME,
        markerColor: APP_CONFIG.markerFillColor,
        markerHighlightColor: APP_CONFIG.markerHighlightColor,
        markerStrokeColor: APP_CONFIG.markerStrokeColor,
        markerShadowColor: APP_CONFIG.markerShadowColor,
        clusterFill: APP_CONFIG.clusterFillColor,
        clusterStroke: APP_CONFIG.clusterStrokeColor,
        labelFill: APP_CONFIG.labelBackgroundColor,
        labelStroke: APP_CONFIG.labelBorderColor,
        labelText: APP_CONFIG.labelTextColor,
        trailColor: APP_CONFIG.trailStrokeColor,
        trailSelectedColor: APP_CONFIG.selectedTrailStrokeColor
      };
    }
    function updateSelectedAircraftSnapshot() {
      if (!state.selectedAircraftId) {
        return;
      }
      const nextAircraft = state.aircraft.find((aircraft) => aircraft.id === state.selectedAircraftId) || null;
      if (!nextAircraft) {
        if (ui) {
          ui.updateDetailsPanel();
        }
        return;
      }
      const previousRegistration = state.selectedAircraftSnapshot ? state.selectedAircraftSnapshot.registration : null;
      state.selectedAircraftSnapshot = nextAircraft;
      if (cleanText(previousRegistration) !== cleanText(nextAircraft.registration)) {
        void loadSelectedAircraftDetails(false);
      }
      if (ui) {
        ui.updateDetailsPanel();
      }
    }
    async function loadSelectedAircraftDetails(force = false) {
      if (!state.selectedAircraftSnapshot) {
        return;
      }
      state.selectedAircraftDetailsLoading = true;
      state.selectedAircraftDetailsError = "";
      state.selectedAircraftDetails = null;
      if (ui) {
        ui.updateDetailsPanel();
      }
      try {
        const details = await ensureEnrichmentService().loadSelectedAircraftDetails(state.selectedAircraftSnapshot, { force });
        state.selectedAircraftDetails = details;
        state.selectedAircraftDetailsLoading = false;
        state.selectedAircraftDetailsError = "";
        logEvent("info", "Loaded selected aircraft details", {
          lookupKey: details.lookupKey,
          source: details.source,
          hasPhoto: Boolean(details.photoUrl || details.photoThumbnailUrl),
          hasRoute: Boolean(details.origin || details.destination)
        });
      } catch (error) {
        state.selectedAircraftDetailsLoading = false;
        state.selectedAircraftDetailsError = error instanceof Error ? error.message : String(error);
        logEvent("warn", "Failed to load selected aircraft details", {
          message: state.selectedAircraftDetailsError
        });
      }
      if (ui) {
        ui.updateDetailsPanel();
        ui.updateDebugPanel();
      }
    }
    function selectAircraft(aircraft) {
      if (!aircraft) {
        return;
      }
      state.selectedAircraftId = aircraft.id;
      state.selectedAircraftSnapshot = aircraft;
      state.selectedAircraftDetails = null;
      state.selectedAircraftDetailsLoading = false;
      state.selectedAircraftDetailsError = "";
      state.settings.panelVisibility.details = true;
      logEvent("info", "Selected aircraft for details", {
        id: aircraft.id,
        callsign: aircraft.callsign,
        registration: aircraft.registration
      });
      if (ui) {
        ui.syncPanelOpenState();
        ui.updateDetailsPanel();
      }
      void loadSelectedAircraftDetails(false);
      scheduleRender();
    }
    function clearSelectedAircraft() {
      state.selectedAircraftId = null;
      state.selectedAircraftSnapshot = null;
      state.selectedAircraftDetails = null;
      state.selectedAircraftDetailsError = "";
      state.selectedAircraftDetailsLoading = false;
      scheduleRender();
      if (ui) {
        ui.updateDetailsPanel();
      }
    }
    function scheduleRender() {
      if (state.renderScheduled) {
        return;
      }
      state.renderScheduled = true;
      window.requestAnimationFrame(renderFrame);
    }
    function buildProjectedMarkers(displayAircraft) {
      const projected = [];
      const margin = APP_CONFIG.renderMarginPx;
      const viewportRect = state.viewportRect;
      const mapState = state.mapState;
      if (!viewportRect || !mapState) {
        return projected;
      }
      for (const aircraft of displayAircraft) {
        const point = projectToViewport(mapState, viewportRect, aircraft.lat, aircraft.lon);
        if (point.x < -margin || point.y < -margin || point.x > viewportRect.width + margin || point.y > viewportRect.height + margin) {
          continue;
        }
        projected.push({
          id: aircraft.id,
          aircraft,
          x: point.x,
          y: point.y,
          baseX: point.x,
          baseY: point.y,
          heading: aircraft.heading,
          isSelected: aircraft.id === state.selectedAircraftId,
          isHovered: aircraft.id === state.hoverMarkerId
        });
      }
      return projected;
    }
    function projectTrailPoints(trail) {
      if (!state.mapState || !state.viewportRect) {
        return [];
      }
      return trail.points.map((point) => ({
        ...point,
        ...projectToViewport(state.mapState, state.viewportRect, point.lat, point.lon)
      })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    }
    function renderDensityScene(ctx, densityScene) {
      const theme = getTheme();
      state.drawnMarkers = [];
      state.renderedAircraftByMarkerId = /* @__PURE__ */ new Map();
      const displayAircraftById = new Map(
        state.interpolatedAircraftList.map((aircraft) => [aircraft.id, aircraft])
      );
      const trails = collectRenderableTrails(state.trailStore, {
        mode: state.settings.trailMode,
        selectedAircraftId: state.selectedAircraftId,
        hoveredAircraftId: state.hoverMarkerId
      });
      for (const trail of trails) {
        const points = projectTrailPoints(trail);
        if (points.length < 2) {
          continue;
        }
        drawTrail(ctx, points, {
          selected: trail.selected,
          theme
        });
      }
      for (const group of densityScene.groups) {
        if (group.expanded && Array.isArray(group.expanded.items)) {
          drawSpiderfyLayout(
            ctx,
            {
              centerX: group.center.x,
              centerY: group.center.y,
              members: group.expanded.items.map((item) => {
                const aircraft2 = displayAircraftById.get(item.marker.aircraftId || item.marker.id) || null;
                if (aircraft2) {
                  state.drawnMarkers.push({
                    aircraft: aircraft2,
                    x: item.x,
                    y: item.y,
                    markerId: item.marker.id,
                    type: "spiderfy-item"
                  });
                  state.renderedAircraftByMarkerId.set(item.marker.id, aircraft2);
                }
                return {
                  x: item.x,
                  y: item.y,
                  heading: aircraft2 ? aircraft2.heading : item.marker.heading,
                  selected: item.isSelected,
                  highlighted: item.isHovered,
                  label: shouldRenderAircraftLabel(item.marker.id, {
                    mode: state.settings.labelMode,
                    selectedAircraftId: state.selectedAircraftId,
                    hoveredAircraftId: state.hoverMarkerId,
                    zoom: state.mapState ? state.mapState.zoom : null,
                    minZoomForLabels: APP_CONFIG.highZoomLabelsThreshold,
                    isVisible: true
                  }) ? cleanText(aircraft2 && aircraft2.callsign) || cleanText(aircraft2 && aircraft2.registration) || item.marker.id : null
                };
              })
            },
            {
              theme,
              memberRadiusPx: state.settings.markerSizePx
            }
          );
          continue;
        }
        if (group.kind === "cluster") {
          drawClusterBubble(ctx, {
            count: group.markerCount,
            label: group.markerCount,
            radiusPx: Math.max(14, group.radiusPx),
            x: group.center.x,
            y: group.center.y,
            highlighted: group.hoveredCount > 0,
            selected: group.selectedCount > 0
          }, { theme });
          continue;
        }
        const member = group.members[0];
        const aircraft = displayAircraftById.get(member.aircraftId || member.id) || null;
        if (!aircraft) {
          continue;
        }
        state.drawnMarkers.push({
          aircraft,
          x: group.center.x,
          y: group.center.y,
          markerId: member.id,
          type: "marker"
        });
        state.renderedAircraftByMarkerId.set(member.id, aircraft);
        drawAircraftMarker(ctx, {
          aircraft,
          x: group.center.x,
          y: group.center.y,
          heading: aircraft.heading,
          selected: member.isSelected,
          highlighted: member.isHovered
        }, {
          sizePx: state.settings.markerSizePx,
          theme
        });
        if (shouldRenderAircraftLabel(member.id, {
          mode: state.settings.labelMode,
          selectedAircraftId: state.selectedAircraftId,
          hoveredAircraftId: state.hoverMarkerId,
          zoom: state.mapState ? state.mapState.zoom : null,
          minZoomForLabels: APP_CONFIG.highZoomLabelsThreshold,
          isVisible: true
        })) {
          const label = cleanText(aircraft.callsign) || cleanText(aircraft.registration) || cleanText(aircraft.id);
          if (label) {
            drawAircraftLabel(ctx, label, { x: group.center.x, y: group.center.y }, { theme });
          }
        }
      }
    }
    function renderFrame() {
      state.renderScheduled = false;
      if (!state.canvasEl || !state.canvasCtx) {
        return;
      }
      mapController.syncMapStateFromUrl();
      if (!state.viewportEl || !state.viewportEl.isConnected) {
        mapController.refreshViewportBinding("force");
      } else {
        mapController.updateViewportRect();
      }
      if (!state.viewportRect) {
        clearCanvas(state.canvasCtx, 0, 0);
        if (ui) {
          ui.hideTooltip();
          ui.refreshAll();
        }
        return;
      }
      resizeCanvasForViewport(
        state.canvasEl,
        state.canvasCtx,
        state.viewportRect,
        window.devicePixelRatio || 1
      );
      clearCanvas(state.canvasCtx, state.viewportRect.width, state.viewportRect.height);
      if (!state.mapState) {
        if (ui) {
          ui.hideTooltip();
          ui.refreshAll();
        }
        return;
      }
      const sampled = sampleInterpolatedAircraft(state.interpolationState, Date.now(), {
        transitionDurationMs: APP_CONFIG.interpolationDurationMs,
        maxTeleportDistanceNm: 50,
        staleAfterMs: APP_CONFIG.refreshIntervalMs * 3
      });
      state.interpolatedAircraftList = sampled.aircraft;
      const projectedMarkers = buildProjectedMarkers(sampled.aircraft);
      state.densityScene = buildDensityScene(projectedMarkers, {
        mode: state.settings.densityMode,
        zoom: state.mapState.zoom,
        viewportWidth: state.viewportRect.width,
        viewportHeight: state.viewportRect.height,
        overlapRadiusPx: Math.max(12, state.settings.hoverHitRadiusPx - 2),
        spiderfyGroupId: state.spiderfyGroupKey || null,
        declutterZoomThreshold: APP_CONFIG.declutterZoomThreshold,
        clusterHitPaddingPx: Math.max(6, Math.round(state.settings.hoverHitRadiusPx * 0.45)),
        spiderfyHitPaddingPx: state.settings.hoverHitRadiusPx
      });
      state.densityStats = state.densityScene.stats;
      renderDensityScene(state.canvasCtx, state.densityScene);
      updateHoverState();
      if (ui) {
        ui.refreshAll();
      }
    }
    function resolveHitAtClientPoint(clientX, clientY) {
      if (!state.viewportRect || !state.densityScene) {
        return null;
      }
      const localX = clientX - state.viewportRect.left;
      const localY = clientY - state.viewportRect.top;
      if (localX < 0 || localY < 0 || localX > state.viewportRect.width || localY > state.viewportRect.height) {
        return null;
      }
      return findSceneTargetAtPoint(state.densityScene, { x: localX, y: localY }, {
        singleHitRadiusPx: state.settings.hoverHitRadiusPx,
        clusterHitPaddingPx: Math.max(6, Math.round(state.settings.hoverHitRadiusPx * 0.45)),
        spiderfyHitPaddingPx: state.settings.hoverHitRadiusPx
      });
    }
    function updateHoverState() {
      const hit = resolveHitAtClientPoint(state.mouseX, state.mouseY);
      if (!hit || hit.type !== "marker" && hit.type !== "spiderfy-item") {
        const hadHover = state.hoverMarkerId !== null;
        state.hoverMarkerId = null;
        if (ui) {
          ui.hideTooltip();
        }
        if (hadHover) {
          scheduleRender();
        }
        return;
      }
      const aircraft = state.renderedAircraftByMarkerId.get(hit.markerId) || null;
      const nextHoverId = aircraft ? aircraft.id : null;
      if (!aircraft) {
        state.hoverMarkerId = null;
        if (ui) {
          ui.hideTooltip();
        }
        return;
      }
      if (state.hoverMarkerId !== nextHoverId) {
        state.hoverMarkerId = nextHoverId;
        scheduleRender();
      }
      if (ui) {
        ui.renderTooltip({ aircraft });
      }
    }
    function handleMapClick(event) {
      if (state.hudRootEl && event.target instanceof Node && state.hudRootEl.contains(event.target)) {
        return;
      }
      const hit = resolveHitAtClientPoint(event.clientX, event.clientY);
      if (!hit) {
        return;
      }
      if (hit.type === "cluster") {
        if (state.settings.densityMode !== "normal") {
          state.spiderfyGroupKey = state.spiderfyGroupKey === hit.groupId ? "" : hit.groupId;
          logEvent("info", "Toggled density group", {
            groupId: hit.groupId,
            open: Boolean(state.spiderfyGroupKey)
          });
          scheduleRender();
          return;
        }
      }
      if (hit.type === "marker" || hit.type === "spiderfy-item") {
        const aircraft = state.renderedAircraftByMarkerId.get(hit.markerId) || null;
        if (aircraft) {
          selectAircraft(aircraft);
        }
      }
    }
    function applySnapshot(payload, meta = {}) {
      const aircraft = normalizeAircraft(payload);
      const previousMap = state.aircraftById;
      const nextMap = new Map(aircraft.map((entry) => [entry.id, entry]));
      state.previousAircraftById = previousMap;
      state.aircraftById = nextMap;
      state.aircraft = aircraft;
      state.snapshotSequence += 1;
      updateInterpolationFromState(state, meta.timestamp || Date.now(), {
        transitionDurationMs: APP_CONFIG.interpolationDurationMs
      });
      updateTrailStoreFromState(state, meta.timestamp || Date.now(), {
        maxAgeMs: APP_CONFIG.trailExpireMs,
        maxPoints: APP_CONFIG.trailMaxPoints
      });
      updateSelectedAircraftSnapshot();
      scheduleRender();
    }
    function applyReplaySnapshot(snapshot) {
      if (!snapshot || !snapshot.payload || typeof snapshot.payload !== "object") {
        return;
      }
      if (snapshot.mapState && typeof snapshot.mapState === "object") {
        state.mapState = {
          centerLat: Number(snapshot.mapState.centerLat),
          centerLon: Number(snapshot.mapState.centerLon),
          zoom: Number(snapshot.mapState.zoom),
          zoomSource: cleanText(snapshot.mapState.zoomSource) || "replay",
          scaleMeters: Number.isFinite(Number(snapshot.mapState.scaleMeters)) ? Number(snapshot.mapState.scaleMeters) : null
        };
      }
      applySnapshot(snapshot.payload, { timestamp: snapshot.timestamp || Date.now() });
      setStatus("ok", `Replay: ${snapshot.label || snapshot.id}`);
    }
    function maybeAdvanceReplay() {
      if (!state.replayMode || state.replayFrames.length === 0) {
        return false;
      }
      const now = Date.now();
      if (now < state.nextReplayDueAt) {
        return true;
      }
      const snapshot = state.replayFrames[state.replayFrameIndex] || null;
      if (!snapshot) {
        return false;
      }
      applyReplaySnapshot(snapshot);
      state.replayFrameIndex = (state.replayFrameIndex + 1) % state.replayFrames.length;
      state.nextReplayDueAt = now + 1800;
      return true;
    }
    function importReplayFromText(text) {
      const parsed = debug.importReplayPayload(text);
      state.replayFrames = parsed.snapshots || [];
      state.replayMode = state.replayFrames.length > 0;
      state.replayFrameIndex = 0;
      state.nextReplayDueAt = 0;
      logEvent("info", "Imported replay payload", {
        snapshots: state.replayFrames.length
      });
      if (state.replayMode) {
        applyReplaySnapshot(state.replayFrames[0]);
      }
      if (ui) {
        ui.updateDebugPanel();
      }
    }
    function clearReplay() {
      state.replayFrames = [];
      state.replayMode = false;
      state.replayFrameIndex = 0;
      state.nextReplayDueAt = 0;
      logEvent("info", "Cleared replay data");
      setStatus("ok", "Replay cleared");
      if (ui) {
        ui.updateDebugPanel();
      }
    }
    const appContext = {
      window,
      document,
      version: VERSION,
      versionHistory: VERSION_HISTORY,
      state,
      settings: state.settings,
      storage,
      debug,
      logEvent,
      setStatus,
      scheduleRender,
      saveSettings: saveSettingsNow,
      copyLogsToClipboard,
      clearLogs,
      copyDebugExport,
      copyReplayExport,
      copySettingsExport,
      fillSettingsExport,
      importSettingsFromText,
      importReplayFromText,
      clearReplay,
      buildDebugContext
    };
    ui = createUiController(appContext);
    mapController = createMapController({
      ...appContext,
      refreshAllUi() {
        if (ui) {
          ui.refreshAll();
        }
      }
    });
    liveData = createLiveDataController({
      ...appContext,
      onAircraftData: ({ aircraft, payload, request, previousAircraftById, nextAircraftById, fetchedAt }) => {
        state.previousAircraftById = previousAircraftById;
        state.aircraftById = nextAircraftById;
        state.aircraft = aircraft;
        updateInterpolationFromState(state, fetchedAt, {
          transitionDurationMs: APP_CONFIG.interpolationDurationMs
        });
        updateTrailStoreFromState(state, fetchedAt, {
          maxAgeMs: APP_CONFIG.trailExpireMs,
          maxPoints: APP_CONFIG.trailMaxPoints
        });
        state.lastFetchSummary = {
          ok: true,
          url: request.url,
          radiusNm: request.radiusNm,
          aircraftCount: aircraft.length,
          startedAt: state.lastFetchStartedAt,
          completedAt: fetchedAt
        };
        debug.capturePayloadSnapshot({
          id: `fetch-${fetchedAt}`,
          label: `Fetch ${new Date(fetchedAt).toLocaleTimeString()}`,
          timestamp: fetchedAt,
          aircraftCount: aircraft.length,
          payload,
          mapState: state.mapState,
          viewport: state.viewportRect
        }, { source: "airplanes.live" });
        state.replayFrames = debug.store.replaySnapshots;
        updateSelectedAircraftSnapshot();
      },
      onFetchError: (error, meta) => {
        state.lastFetchSummary = {
          ok: false,
          url: meta.request.url,
          radiusNm: meta.request.radiusNm,
          aircraftCount: state.aircraft.length,
          startedAt: state.lastFetchStartedAt,
          completedAt: Date.now(),
          error: error instanceof Error ? error.message : String(error),
          rateLimited: meta.isRateLimited,
          backoffUntil: meta.backoffUntil
        };
      }
    });
    function ensureEnrichmentService() {
      if (enrichment && enrichmentPhotoMode === state.settings.photoMode) {
        return enrichment;
      }
      enrichment = createEnrichmentService({
        requestJson: (url) => requestJson(url, {
          logEvent,
          label: "Requesting enrichment data",
          timeoutMs: APP_CONFIG.fetchTimeoutMs
        }),
        storage,
        photoMode: state.settings.photoMode,
        logEvent
      });
      enrichmentPhotoMode = state.settings.photoMode;
      return enrichment;
    }
    ensureEnrichmentService();
    function registerTampermonkeyMenuCommands() {
      if (typeof GM_registerMenuCommand !== "function") {
        logEvent("warn", "GM_registerMenuCommand is unavailable");
        return;
      }
      try {
        GM_registerMenuCommand("Open Flight Overlay Menu", () => {
          state.settings.panelVisibility.menu = true;
          if (ui) {
            ui.syncPanelOpenState();
            ui.refreshAll();
          }
          void saveSettingsNow();
          setStatus("ok", "Opened menu from Tampermonkey");
        }, {
          title: "Open the Google Maps Flight Overlay menu",
          id: "gm-flight-overlay-open-menu",
          autoClose: true
        });
        GM_registerMenuCommand("Toggle Flight Overlay Logs", () => {
          state.settings.panelVisibility.logs = !state.settings.panelVisibility.logs;
          if (ui) {
            ui.syncPanelOpenState();
            ui.refreshAll();
          }
          void saveSettingsNow();
          setStatus("ok", state.settings.panelVisibility.logs ? "Opened logs from Tampermonkey" : "Collapsed logs from Tampermonkey");
        }, {
          title: "Open or collapse the Google Maps Flight Overlay log panel",
          id: "gm-flight-overlay-toggle-logs",
          autoClose: true
        });
        GM_registerMenuCommand("Copy Flight Overlay Logs", () => {
          void copyLogsToClipboard();
        }, {
          title: "Copy the Google Maps Flight Overlay log dump to the clipboard",
          id: "gm-flight-overlay-copy-logs",
          autoClose: true
        });
        logEvent("info", "Registered Tampermonkey menu commands");
      } catch (error) {
        logEvent("error", "Failed to register Tampermonkey menu commands", error);
      }
    }
    function onMouseMove(event) {
      state.mouseX = event.clientX;
      state.mouseY = event.clientY;
      updateHoverState();
    }
    function onVisibilityChange() {
      if (!document.hidden) {
        logEvent("info", "Tab became visible, forcing refresh");
        state.nextFetchDueAt = 0;
        setStatus("warn", "Visible again, refreshing");
        void liveData.maybeFetchAircraft();
        scheduleRender();
      } else {
        logEvent("info", "Tab hidden, pausing refresh loop");
        setStatus("warn", "Paused while tab is hidden");
        if (ui) {
          ui.hideTooltip();
        }
        scheduleRender();
      }
    }
    function installObservers() {
      window.addEventListener("error", (event) => {
        logEvent("error", "Unhandled window error", {
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          error: event.error
        });
      });
      window.addEventListener("unhandledrejection", (event) => {
        logEvent("error", "Unhandled promise rejection", event.reason);
      });
      window.addEventListener("resize", () => {
        mapController.kickInteractionRender("resize");
        mapController.refreshViewportBinding("force");
        scheduleRender();
      }, { passive: true });
      window.addEventListener("popstate", () => {
        mapController.kickInteractionRender("popstate");
        mapController.syncMapStateFromUrl();
        scheduleRender();
      }, { passive: true });
      window.addEventListener("wheel", () => {
        mapController.kickInteractionRender("wheel");
      }, { passive: true });
      window.addEventListener("pointerdown", () => {
        mapController.kickInteractionRender("pointerdown");
      }, { passive: true });
      window.addEventListener("pointermove", () => {
        if (state.lastMapInteractionAt && Date.now() - state.lastMapInteractionAt < APP_CONFIG.interactionRenderDurationMs) {
          mapController.kickInteractionRender("pointermove");
        }
      }, { passive: true });
      window.addEventListener("touchstart", () => {
        mapController.kickInteractionRender("touchstart");
      }, { passive: true });
      window.addEventListener("keydown", (event) => {
        if (event.key === "+" || event.key === "-" || event.key === "=" || event.key === "_") {
          mapController.kickInteractionRender("keydown");
        }
      }, { passive: true });
      window.addEventListener("click", handleMapClick, true);
      window.addEventListener("mousemove", onMouseMove, { passive: true });
      document.addEventListener("visibilitychange", onVisibilityChange, { passive: true });
      state.domObserver = new MutationObserver(() => {
        mapController.scheduleViewportRefresh();
      });
      state.domObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
    function heartbeat() {
      const hrefChanged = mapController.syncMapStateFromUrl();
      if (hrefChanged || !state.viewportEl || !state.viewportEl.isConnected || Date.now() - state.lastViewportScanAt >= APP_CONFIG.viewportPollIntervalMs) {
        mapController.refreshViewportBinding("force");
      } else if (mapController.updateViewportRect()) {
        scheduleRender();
      }
      if (maybeAdvanceReplay()) {
        return;
      }
      if (!document.hidden) {
        void liveData.maybeFetchAircraft();
      }
    }
    ui.ensureHud();
    registerTampermonkeyMenuCommands();
    logEvent("info", "Starting userscript", {
      version: VERSION,
      href: window.location.href
    });
    setStatus("boot", "Booting");
    if (APP_CONFIG.autoOpenMenuOnBoot) {
      state.settings.panelVisibility.menu = true;
    }
    mapController.syncMapStateFromUrl();
    mapController.refreshViewportBinding("force");
    installObservers();
    fillSettingsExport();
    state.nextFetchDueAt = 0;
    state.nextReplayDueAt = 0;
    state.heartbeatTimer = window.setInterval(
      heartbeat,
      Math.min(APP_CONFIG.urlPollIntervalMs, APP_CONFIG.viewportPollIntervalMs)
    );
    heartbeat();
    scheduleRender();
  }
  run();
})();

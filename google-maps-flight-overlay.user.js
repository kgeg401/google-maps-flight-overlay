// ==UserScript==
// @name         Google Maps Flight Overlay
// @namespace    https://github.com/kgeg401/google-maps-flight-overlay
// @version      0.9.0
// @description  Overlay live aircraft markers on Google Maps using Airplanes.live.
// @match        https://www.google.com/maps/*
// @noframes
// @run-at       document-body
// @sandbox      DOM
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM.xmlHttpRequest
// @connect      api.airplanes.live
// @connect      api.adsbdb.com
// @homepageURL  https://github.com/kgeg401/google-maps-flight-overlay
// @supportURL   https://github.com/kgeg401/google-maps-flight-overlay/issues
// @updateURL    https://raw.githubusercontent.com/kgeg401/google-maps-flight-overlay/main/google-maps-flight-overlay.user.js
// @downloadURL  https://raw.githubusercontent.com/kgeg401/google-maps-flight-overlay/main/google-maps-flight-overlay.user.js
// ==/UserScript==

(function () {
  "use strict";

  const VERSION = "0.9.0";
  const VERSION_HISTORY = [
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
  const TILE_SIZE = 256;
  const WORLD_RESOLUTION_MPP = 156543.03392804097;
  const DEG_TO_RAD = Math.PI / 180;

  const CONFIG = {
    refreshIntervalMs: 5000,
    fetchTimeoutMs: 8000,
    minFetchGapMs: 1000,
    interactionRenderDurationMs: 1600,
    interactionSettleDelayMs: 900,
    maxQueryRadiusNm: 100,
    minQueryRadiusNm: 10,
    logBufferSize: 500,
    rateLimitBackoffMs: 30000,
    viewportPollIntervalMs: 1000,
    urlPollIntervalMs: 400,
    domWatchDebounceMs: 150,
    hoverHitRadiusPx: 14,
    renderMarginPx: 36,
    markerSizePx: 10,
    markerFillColor: "#59d7ff",
    markerStrokeColor: "#07111d",
    markerHighlightColor: "#ffd166",
    markerShadowColor: "rgba(7, 17, 29, 0.28)",
    autoOpenMenuOnBoot: true,
    debug: false,
  };

  const state = {
    aircraft: [],
    badgeEl: null,
    canvasEl: null,
    canvasCtx: null,
    detailsPanelBodyEl: null,
    detailsPanelEl: null,
    detailsPanelOpen: false,
    domObserver: null,
    drawnMarkers: [],
    heartbeatTimer: 0,
    hoverMarkerId: null,
    hudRootEl: null,
    interactionFrameHandle: 0,
    interactionRenderUntil: 0,
    isFetching: false,
    lastError: "",
    lastFetchCompletedAt: 0,
    lastFetchStartedAt: 0,
    lastMapInteractionAt: 0,
    lastLocationHref: window.location.href,
    lastLoggedMapStateKey: "",
    lastLoggedViewportKey: "",
    lastPauseReason: "",
    lastSuccessAt: 0,
    lastViewportScanAt: 0,
    menuButtonEl: null,
    menuInfoEl: null,
    menuOpen: false,
    menuPanelEl: null,
    logPanelBodyEl: null,
    logPanelEl: null,
    logPanelOpen: false,
    logs: [],
    mapState: null,
    mouseX: 0,
    mouseY: 0,
    nextFetchDueAt: 0,
    overlayRootEl: null,
    pendingViewportRefresh: 0,
    rateLimitBackoffUntil: 0,
    renderScheduled: false,
    selectedAircraftDetails: null,
    selectedAircraftDetailsCache: new Map(),
    selectedAircraftDetailsError: "",
    selectedAircraftDetailsKey: "",
    selectedAircraftDetailsLoading: false,
    selectedAircraftId: null,
    selectedAircraftSnapshot: null,
    statusLevel: "boot",
    statusText: "Booting",
    tooltipEl: null,
    viewportEl: null,
    viewportRect: null,
  };

  GM_addStyle(`
    #gm-flight-overlay-root {
      position: fixed;
      inset: 0;
      z-index: 2147483645;
      pointer-events: none;
      font-family: "Segoe UI", Tahoma, sans-serif;
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
      right: 12px;
      top: 12px;
      max-width: 360px;
      pointer-events: none;
      user-select: none;
      border: 1px solid rgba(120, 190, 255, 0.22);
      background: rgba(6, 10, 18, 0.88);
      color: #f3f7ff;
      border-radius: 10px;
      padding: 8px 10px;
      box-shadow: 0 12px 24px rgba(0, 0, 0, 0.24);
      backdrop-filter: blur(8px);
      line-height: 1.35;
      letter-spacing: 0.01em;
      font-size: 12px;
      white-space: pre-line;
    }

    #gm-flight-overlay-menu-button {
      position: fixed;
      left: 16px;
      bottom: 16px;
      min-width: 116px;
      height: 56px;
      padding: 0 16px 0 14px;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 10px;
      pointer-events: auto;
      cursor: pointer;
      border: 1px solid rgba(120, 190, 255, 0.26);
      border-radius: 999px;
      background: linear-gradient(180deg, rgba(10, 18, 31, 0.94), rgba(6, 10, 18, 0.98));
      color: #f3f7ff;
      box-shadow: 0 12px 24px rgba(0, 0, 0, 0.28);
      backdrop-filter: blur(8px);
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 0.02em;
      line-height: 1;
      user-select: none;
    }

    #gm-flight-overlay-menu-button[data-open="true"] {
      border-color: rgba(89, 215, 255, 0.44);
      box-shadow: 0 12px 24px rgba(0, 0, 0, 0.28), 0 0 0 3px rgba(89, 215, 255, 0.14);
    }

    .gm-flight-overlay-menu-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 999px;
      background: rgba(89, 215, 255, 0.14);
      font-size: 18px;
      line-height: 1;
    }

    .gm-flight-overlay-menu-label {
      display: inline-block;
      font-size: 14px;
      line-height: 1;
      white-space: nowrap;
    }

    #gm-flight-overlay-menu-panel {
      position: fixed;
      left: 16px;
      bottom: 84px;
      width: min(320px, calc(100vw - 24px));
      display: none;
      flex-direction: column;
      gap: 10px;
      pointer-events: auto;
      border: 1px solid rgba(120, 190, 255, 0.22);
      background: rgba(6, 10, 18, 0.94);
      color: #f3f7ff;
      border-radius: 14px;
      padding: 12px;
      box-shadow: 0 12px 24px rgba(0, 0, 0, 0.28);
      backdrop-filter: blur(8px);
    }

    #gm-flight-overlay-menu-panel[data-open="true"] {
      display: flex;
    }

    .gm-flight-overlay-menu-title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.03em;
    }

    .gm-flight-overlay-menu-info {
      border: 1px solid rgba(120, 190, 255, 0.14);
      background: rgba(255, 255, 255, 0.03);
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 12px;
      line-height: 1.4;
      white-space: pre-line;
    }

    .gm-flight-overlay-menu-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .gm-flight-overlay-menu-button {
      border: 1px solid rgba(120, 190, 255, 0.22);
      background: rgba(255, 255, 255, 0.05);
      color: #f3f7ff;
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 12px;
      line-height: 1.2;
      text-align: left;
      cursor: pointer;
    }

    .gm-flight-overlay-menu-button:hover {
      background: rgba(89, 215, 255, 0.12);
    }

    #gm-flight-overlay-log-panel {
      position: fixed;
      right: 12px;
      top: 112px;
      width: min(520px, calc(100vw - 24px));
      max-height: min(52vh, 420px);
      display: none;
      flex-direction: column;
      pointer-events: auto;
      border: 1px solid rgba(120, 190, 255, 0.22);
      background: rgba(6, 10, 18, 0.94);
      color: #f3f7ff;
      border-radius: 12px;
      box-shadow: 0 12px 24px rgba(0, 0, 0, 0.28);
      backdrop-filter: blur(8px);
      overflow: hidden;
    }

    #gm-flight-overlay-log-panel[data-open="true"] {
      display: flex;
    }

    .gm-flight-overlay-log-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(120, 190, 255, 0.14);
      background: rgba(255, 255, 255, 0.03);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }

    .gm-flight-overlay-log-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .gm-flight-overlay-log-button {
      border: 1px solid rgba(120, 190, 255, 0.22);
      background: rgba(255, 255, 255, 0.05);
      color: #f3f7ff;
      border-radius: 8px;
      padding: 4px 8px;
      font-size: 11px;
      line-height: 1.2;
      cursor: pointer;
    }

    .gm-flight-overlay-log-button:hover {
      background: rgba(89, 215, 255, 0.12);
    }

    #gm-flight-overlay-log-body {
      overflow: auto;
      padding: 10px 12px;
      font-family: Consolas, "Courier New", monospace;
      font-size: 11px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }

    #gm-flight-overlay-badge[data-level="ok"] {
      border-color: rgba(83, 216, 141, 0.32);
    }

    #gm-flight-overlay-badge[data-level="warn"] {
      border-color: rgba(255, 209, 102, 0.34);
    }

    #gm-flight-overlay-badge[data-level="error"] {
      border-color: rgba(255, 107, 107, 0.36);
    }

    #gm-flight-overlay-tooltip {
      position: fixed;
      left: 0;
      top: 0;
      display: none;
      min-width: 160px;
      max-width: 260px;
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

    #gm-flight-overlay-details-panel {
      position: fixed;
      right: 12px;
      bottom: 12px;
      width: min(360px, calc(100vw - 24px));
      max-height: min(62vh, 560px);
      display: none;
      flex-direction: column;
      pointer-events: auto;
      border: 1px solid rgba(120, 190, 255, 0.22);
      background: rgba(6, 10, 18, 0.96);
      color: #f3f7ff;
      border-radius: 14px;
      box-shadow: 0 12px 24px rgba(0, 0, 0, 0.28);
      backdrop-filter: blur(8px);
      overflow: hidden;
    }

    #gm-flight-overlay-details-panel[data-open="true"] {
      display: flex;
    }

    .gm-flight-overlay-details-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(120, 190, 255, 0.14);
      background: rgba(255, 255, 255, 0.03);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.03em;
    }

    .gm-flight-overlay-details-close {
      border: 1px solid rgba(120, 190, 255, 0.22);
      background: rgba(255, 255, 255, 0.05);
      color: #f3f7ff;
      border-radius: 8px;
      padding: 4px 8px;
      font-size: 11px;
      line-height: 1.2;
      cursor: pointer;
    }

    .gm-flight-overlay-details-close:hover {
      background: rgba(89, 215, 255, 0.12);
    }

    #gm-flight-overlay-details-body {
      overflow: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      font-size: 12px;
      line-height: 1.45;
    }

    .gm-flight-overlay-details-card {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .gm-flight-overlay-details-photo {
      width: 100%;
      max-height: 180px;
      object-fit: cover;
      border-radius: 10px;
      border: 1px solid rgba(120, 190, 255, 0.16);
      background: rgba(255, 255, 255, 0.04);
    }

    .gm-flight-overlay-details-photo-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 120px;
      border-radius: 10px;
      border: 1px dashed rgba(120, 190, 255, 0.18);
      background: rgba(255, 255, 255, 0.03);
      color: rgba(243, 247, 255, 0.72);
      text-align: center;
      padding: 12px;
    }

    .gm-flight-overlay-details-title {
      font-size: 16px;
      font-weight: 700;
      line-height: 1.2;
    }

    .gm-flight-overlay-details-subtitle {
      color: rgba(243, 247, 255, 0.78);
      font-size: 12px;
    }

    .gm-flight-overlay-details-grid {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 6px 10px;
    }

    .gm-flight-overlay-details-key {
      color: rgba(243, 247, 255, 0.72);
      white-space: nowrap;
    }

    .gm-flight-overlay-details-value {
      color: #f3f7ff;
      min-width: 0;
      word-break: break-word;
    }

    .gm-flight-overlay-details-note {
      color: rgba(243, 247, 255, 0.72);
      font-size: 11px;
    }
  `);

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

  function firstFiniteNumber() {
    for (const value of arguments) {
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
      return `~z${mapState.zoom.toFixed(2)} from ${Math.round(mapState.scaleMeters)}m`;
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

  function formatAge(updatedAt) {
    if (!isFiniteNumber(updatedAt)) {
      return "n/a";
    }
    const deltaSec = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
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
    return (
      cleanText(aircraft.callsign) ||
      cleanText(details && details.registration) ||
      cleanText(aircraft.registration) ||
      cleanText(aircraft.id) ||
      "Selected aircraft"
    );
  }

  function formatAircraftSubtitle(aircraft, details) {
    const parts = [
      cleanText(details && details.manufacturer),
      cleanText(details && details.type),
      cleanText(aircraft.aircraftType),
    ].filter(Boolean);

    if (parts.length > 0) {
      return parts.join(" ");
    }

    return "Live aircraft details";
  }

  function serializeLogValue(value, depth) {
    const nextDepth = depth + 1;
    if (depth >= 3) {
      return "[max-depth]";
    }
    if (value === null || value === undefined) {
      return value;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack || null,
      };
    }
    if (Array.isArray(value)) {
      return value.slice(0, 12).map((item) => serializeLogValue(item, nextDepth));
    }
    if (typeof value === "object") {
      const output = {};
      const entries = Object.entries(value).slice(0, 16);
      for (const [key, entryValue] of entries) {
        output[key] = serializeLogValue(entryValue, nextDepth);
      }
      return output;
    }
    return String(value);
  }

  function logEvent(level, message, details) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      message,
      details: details === undefined ? null : serializeLogValue(details, 0),
    };

    state.logs.push(entry);
    if (state.logs.length > CONFIG.logBufferSize) {
      state.logs.splice(0, state.logs.length - CONFIG.logBufferSize);
    }

    const consolePrefix = `[gm-flight-overlay][${level}] ${message}`;
    if (level === "error") {
      console.error(consolePrefix, entry.details);
    } else if (level === "warn") {
      console.warn(consolePrefix, entry.details);
    } else if (CONFIG.debug || level !== "debug") {
      console.log(consolePrefix, entry.details);
    }

    updateLogPanel();
  }

  function getLogDump() {
    const lines = [
      "Google Maps Flight Overlay log dump",
      `version: ${VERSION}`,
      `generatedAt: ${new Date().toISOString()}`,
      `href: ${window.location.href}`,
      `status: ${state.statusLevel} ${state.statusText}`,
      `aircraftCount: ${state.aircraft.length}`,
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

    for (const entry of state.logs) {
      lines.push(`[${entry.ts}] ${entry.level.toUpperCase()} ${entry.message}`);
      if (entry.details !== null) {
        try {
          lines.push(JSON.stringify(entry.details, null, 2));
        } catch (_error) {
          lines.push(String(entry.details));
        }
      }
    }

    return lines.join("\n");
  }

  async function copyLogsToClipboard() {
    const text = getLogDump();

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function openOverlayMenuFromCommand() {
    ensureHud();
    setMenuOpen(true);
    logEvent("info", "Opened overlay menu from Tampermonkey command");
    setStatus("ok", "Opened menu from Tampermonkey");
  }

  function toggleLogsFromCommand() {
    const nextOpen = !state.logPanelOpen;
    setLogPanelOpen(nextOpen);
    logEvent("info", "Toggled log panel from Tampermonkey command", {
      open: nextOpen,
    });
    setStatus("ok", nextOpen ? "Opened logs from Tampermonkey" : "Collapsed logs from Tampermonkey");
  }

  async function copyLogsFromCommand() {
    try {
      await copyLogsToClipboard();
      logEvent("info", "Copied logs from Tampermonkey command");
      setStatus("ok", "Copied logs from Tampermonkey");
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      logEvent("error", "Failed to copy logs from Tampermonkey command", error);
      setStatus("error", "Failed to copy logs from Tampermonkey");
    }
  }

  function registerTampermonkeyMenuCommands() {
    if (typeof GM_registerMenuCommand !== "function") {
      logEvent("warn", "GM_registerMenuCommand is unavailable");
      return;
    }

    try {
      GM_registerMenuCommand("Open Flight Overlay Menu", openOverlayMenuFromCommand, {
        title: "Open the Google Maps Flight Overlay menu",
        id: "gm-flight-overlay-open-menu",
        autoClose: true,
      });
      GM_registerMenuCommand("Toggle Flight Overlay Logs", toggleLogsFromCommand, {
        title: "Open or collapse the Google Maps Flight Overlay log panel",
        id: "gm-flight-overlay-toggle-logs",
        autoClose: true,
      });
      GM_registerMenuCommand("Copy Flight Overlay Logs", () => {
        void copyLogsFromCommand();
      }, {
        title: "Copy the Google Maps Flight Overlay log dump to the clipboard",
        id: "gm-flight-overlay-copy-logs",
        autoClose: true,
      });
      logEvent("info", "Registered Tampermonkey menu commands");
    } catch (error) {
      logEvent("error", "Failed to register Tampermonkey menu commands", error);
    }
  }

  function formatLogEntry(entry) {
    const lines = [`[${entry.ts}] ${entry.level.toUpperCase()} ${entry.message}`];

    if (entry.details !== null) {
      try {
        lines.push(JSON.stringify(entry.details, null, 2));
      } catch (_error) {
        lines.push(String(entry.details));
      }
    }

    return lines.join("\n");
  }

  function updateLogPanel() {
    if (!state.logPanelEl || !state.logPanelBodyEl) {
      return;
    }

    state.logPanelEl.dataset.open = state.logPanelOpen ? "true" : "false";

    const bodyLines = [
      `Status: ${state.statusLevel} ${state.statusText}`,
      state.mapState
        ? `Map: ${state.mapState.centerLat}, ${state.mapState.centerLon}, ${formatZoomSummary(state.mapState)}`
        : "Map: null",
      state.viewportRect
        ? `Viewport: ${Math.round(state.viewportRect.left)}, ${Math.round(state.viewportRect.top)}, ${Math.round(state.viewportRect.width)} x ${Math.round(state.viewportRect.height)}`
        : "Viewport: null",
      `Aircraft: ${state.aircraft.length}`,
      `Entries: ${state.logs.length}/${CONFIG.logBufferSize}`,
      "",
      ...state.logs.map(formatLogEntry),
    ];

    state.logPanelBodyEl.textContent = bodyLines.join("\n\n");
    if (state.logPanelOpen) {
      state.logPanelBodyEl.scrollTop = state.logPanelBodyEl.scrollHeight;
    }
  }

  function updateMenuPanel() {
    if (!state.menuPanelEl || !state.menuButtonEl || !state.menuInfoEl) {
      return;
    }

    state.menuPanelEl.dataset.open = state.menuOpen ? "true" : "false";
    state.menuButtonEl.dataset.open = state.menuOpen ? "true" : "false";
    state.menuButtonEl.title = state.menuOpen ? "Close flight overlay menu" : "Open flight overlay menu";

    const lines = [
      `Version: ${VERSION}`,
      `Status: ${state.statusLevel} ${state.statusText}`,
      state.mapState
        ? `Map: ${formatZoomSummary(state.mapState)} @ ${formatLatLon(state.mapState.centerLat, state.mapState.centerLon)}`
        : "Map: n/a",
      state.viewportRect
        ? `Viewport: ${Math.round(state.viewportRect.width)} x ${Math.round(state.viewportRect.height)}`
        : "Viewport: n/a",
      `Aircraft: ${state.aircraft.length}`,
      `Logs: ${state.logPanelOpen ? "open" : "collapsed"} (${state.logs.length})`,
      `Latest: ${VERSION_HISTORY[0].changes[0]}`,
    ];

    state.menuInfoEl.textContent = lines.join("\n");
  }

  function setMenuOpen(open) {
    state.menuOpen = Boolean(open);
    updateMenuPanel();
  }

  function toggleMenu() {
    setMenuOpen(!state.menuOpen);
  }

  function setLogPanelOpen(open) {
    state.logPanelOpen = Boolean(open);
    updateLogPanel();
    updateBadge();
    updateMenuPanel();
  }

  function toggleLogPanel() {
    setLogPanelOpen(!state.logPanelOpen);
  }

  function setStatus(level, text) {
    state.statusLevel = level;
    state.statusText = text;
    updateBadge();
    updateLogPanel();
    updateMenuPanel();
  }

  function updateBadge() {
    if (!state.badgeEl) {
      return;
    }

    let summary = `Flight Overlay v${VERSION}\n${state.statusText}`;

    if (state.mapState) {
      summary += `\nMap: ${formatZoomSummary(state.mapState)} @ ${formatLatLon(state.mapState.centerLat, state.mapState.centerLon)}`;
    }

    if (state.viewportRect) {
      summary += `\nViewport: ${Math.round(state.viewportRect.width)} x ${Math.round(state.viewportRect.height)}`;
    }

    if (state.aircraft.length > 0) {
      summary += `\nAircraft: ${state.aircraft.length}`;
    }

    if (state.lastError) {
      summary += `\nLast error: ${state.lastError}`;
    }

    if (CONFIG.debug) {
      summary += `\nDebug: fetch@${state.lastFetchCompletedAt || 0}`;
    }

    summary += state.logPanelOpen ? "\nLogs: open" : "\nLogs: collapsed";

    state.badgeEl.dataset.level = state.statusLevel;
    state.badgeEl.title = "Overlay status";
    state.badgeEl.textContent = summary;
  }

  function createPhotoFallback(message) {
    const placeholderEl = document.createElement("div");
    placeholderEl.className = "gm-flight-overlay-details-photo-placeholder";
    placeholderEl.textContent = message;
    return placeholderEl;
  }

  function updateDetailsPanel() {
    if (!state.detailsPanelEl || !state.detailsPanelBodyEl) {
      return;
    }

    const aircraft = state.selectedAircraftSnapshot;
    const open = Boolean(state.detailsPanelOpen && aircraft);
    state.detailsPanelEl.dataset.open = open ? "true" : "false";
    state.detailsPanelBodyEl.replaceChildren();

    if (!open || !aircraft) {
      return;
    }

    const details = state.selectedAircraftDetails;
    const wrapperEl = document.createElement("div");
    wrapperEl.className = "gm-flight-overlay-details-card";

    const titleEl = document.createElement("div");
    titleEl.className = "gm-flight-overlay-details-title";
    titleEl.textContent = formatAircraftTitle(aircraft, details);
    wrapperEl.appendChild(titleEl);

    const subtitleEl = document.createElement("div");
    subtitleEl.className = "gm-flight-overlay-details-subtitle";
    subtitleEl.textContent = formatAircraftSubtitle(aircraft, details);
    wrapperEl.appendChild(subtitleEl);

    const photoUrl = cleanText(details && (details.photoThumbnailUrl || details.photoUrl));
    if (photoUrl) {
      const imgEl = document.createElement("img");
      imgEl.className = "gm-flight-overlay-details-photo";
      imgEl.src = photoUrl;
      imgEl.alt = formatAircraftTitle(aircraft, details);
      imgEl.addEventListener("error", () => {
        imgEl.replaceWith(createPhotoFallback("Aircraft photo could not be loaded"));
      }, { once: true });
      wrapperEl.appendChild(imgEl);
    } else {
      wrapperEl.appendChild(
        createPhotoFallback(
          state.selectedAircraftDetailsLoading ? "Loading aircraft photo..." : "No aircraft photo available"
        )
      );
    }

    const gridEl = document.createElement("div");
    gridEl.className = "gm-flight-overlay-details-grid";

    const rows = [
      ["Callsign", cleanText(aircraft.callsign) || ""],
      ["Registration", cleanText(details && details.registration) || cleanText(aircraft.registration) || ""],
      ["Hex", cleanText(aircraft.id) || ""],
      ["Type", cleanText(details && details.type) || cleanText(details && details.icaoType) || cleanText(aircraft.aircraftType) || ""],
      ["Operator", cleanText(details && details.airlineName) || cleanText(details && details.owner) || ""],
      ["Altitude", formatAltitude(aircraft)],
      ["Speed", formatSpeed(aircraft.speedKt)],
      ["Heading", formatHeading(aircraft.heading)],
      ["Origin", formatRouteEndpoint(details && details.origin)],
      ["Destination", formatRouteEndpoint(details && details.destination)],
      ["Updated", formatAge(aircraft.updatedAt)],
    ];

    for (const [key, value] of rows) {
      const keyEl = document.createElement("div");
      keyEl.className = "gm-flight-overlay-details-key";
      keyEl.textContent = key;

      const valueEl = document.createElement("div");
      valueEl.className = "gm-flight-overlay-details-value";
      valueEl.textContent = value || "blank";

      gridEl.appendChild(keyEl);
      gridEl.appendChild(valueEl);
    }

    wrapperEl.appendChild(gridEl);

    const noteEl = document.createElement("div");
    noteEl.className = "gm-flight-overlay-details-note";
    if (state.selectedAircraftDetailsLoading) {
      noteEl.textContent = "Loading aircraft photo and route details...";
    } else if (state.selectedAircraftDetailsError) {
      noteEl.textContent = state.selectedAircraftDetailsError;
    } else if (!details || (!details.destination && !details.origin)) {
      noteEl.textContent = "No route information is available for this aircraft.";
    } else {
      noteEl.textContent = "Photo and route details are provided when available by adsbdb.";
    }
    wrapperEl.appendChild(noteEl);

    state.detailsPanelBodyEl.appendChild(wrapperEl);
  }

  function setDetailsPanelOpen(open) {
    state.detailsPanelOpen = Boolean(open);
    updateDetailsPanel();
  }

  function clearSelectedAircraft() {
    state.selectedAircraftId = null;
    state.selectedAircraftSnapshot = null;
    state.selectedAircraftDetails = null;
    state.selectedAircraftDetailsError = "";
    state.selectedAircraftDetailsKey = "";
    state.selectedAircraftDetailsLoading = false;
    setDetailsPanelOpen(false);
    scheduleRender();
  }

  function buildAircraftDetailsLookup(aircraft) {
    if (!aircraft) {
      return null;
    }

    const modeS = cleanText(aircraft.id) ? aircraft.id.replace(/^~/, "").toUpperCase() : null;
    const registration = cleanText(aircraft.registration);
    const identifier = /^[0-9A-F]{6}$/i.test(modeS || "") ? modeS : registration;
    if (!identifier) {
      return null;
    }

    const callsign = cleanText(aircraft.callsign)
      ? aircraft.callsign.replace(/\s+/g, "").toUpperCase()
      : null;

    const baseUrl = `https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(identifier)}`;
    const url = callsign
      ? `${baseUrl}?callsign=${encodeURIComponent(callsign)}`
      : baseUrl;

    return {
      key: `${identifier}|${callsign || ""}`,
      url,
    };
  }

  function normalizeAircraftDetailsPayload(payload) {
    const response = payload && payload.response ? payload.response : null;
    const aircraft = response && response.aircraft ? response.aircraft : null;
    const flightroute = response && response.flightroute ? response.flightroute : null;

    return {
      registration: cleanText(aircraft && aircraft.registration),
      manufacturer: cleanText(aircraft && aircraft.manufacturer),
      type: cleanText(aircraft && aircraft.type),
      icaoType: cleanText(aircraft && aircraft.icao_type),
      owner: cleanText(aircraft && aircraft.registered_owner),
      photoUrl: cleanText(aircraft && aircraft.url_photo),
      photoThumbnailUrl: cleanText(aircraft && aircraft.url_photo_thumbnail),
      airlineName: cleanText(flightroute && flightroute.airline && flightroute.airline.name),
      origin: flightroute && flightroute.origin ? {
        name: cleanText(flightroute.origin.name),
        municipality: cleanText(flightroute.origin.municipality),
        iataCode: cleanText(flightroute.origin.iata_code),
        icaoCode: cleanText(flightroute.origin.icao_code),
      } : null,
      destination: flightroute && flightroute.destination ? {
        name: cleanText(flightroute.destination.name),
        municipality: cleanText(flightroute.destination.municipality),
        iataCode: cleanText(flightroute.destination.iata_code),
        icaoCode: cleanText(flightroute.destination.icao_code),
      } : null,
    };
  }

  async function loadSelectedAircraftDetails() {
    const aircraft = state.selectedAircraftSnapshot;
    const lookup = buildAircraftDetailsLookup(aircraft);
    if (!aircraft || !lookup) {
      state.selectedAircraftDetails = null;
      state.selectedAircraftDetailsError = "No aircraft lookup key is available for photo or route data.";
      state.selectedAircraftDetailsLoading = false;
      updateDetailsPanel();
      return;
    }

    state.selectedAircraftDetailsKey = lookup.key;

    if (state.selectedAircraftDetailsCache.has(lookup.key)) {
      state.selectedAircraftDetails = state.selectedAircraftDetailsCache.get(lookup.key);
      state.selectedAircraftDetailsError = "";
      state.selectedAircraftDetailsLoading = false;
      updateDetailsPanel();
      return;
    }

    state.selectedAircraftDetailsLoading = true;
    state.selectedAircraftDetailsError = "";
    state.selectedAircraftDetails = null;
    updateDetailsPanel();

    try {
      const payload = await requestJson(lookup.url);
      const details = normalizeAircraftDetailsPayload(payload);
      state.selectedAircraftDetailsCache.set(lookup.key, details);

      if (state.selectedAircraftDetailsKey === lookup.key) {
        state.selectedAircraftDetails = details;
        state.selectedAircraftDetailsError = "";
        state.selectedAircraftDetailsLoading = false;
        updateDetailsPanel();
      }

      logEvent("info", "Loaded selected aircraft details", {
        key: lookup.key,
        hasPhoto: Boolean(details.photoUrl || details.photoThumbnailUrl),
        hasRoute: Boolean(details.origin || details.destination),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logEvent("warn", "Failed to load selected aircraft details", {
        key: lookup.key,
        message,
      });
      if (state.selectedAircraftDetailsKey === lookup.key) {
        state.selectedAircraftDetails = null;
        state.selectedAircraftDetailsLoading = false;
        state.selectedAircraftDetailsError = message.includes("404")
          ? "No extra photo or route details are available for this aircraft."
          : "Extra aircraft details could not be loaded right now.";
        updateDetailsPanel();
      }
    }
  }

  function selectAircraft(aircraft) {
    if (!aircraft) {
      return;
    }

    logEvent("info", "Selected aircraft for details", {
      id: aircraft.id,
      callsign: aircraft.callsign,
      registration: aircraft.registration,
    });
    state.selectedAircraftId = aircraft.id;
    state.selectedAircraftSnapshot = aircraft;
    state.selectedAircraftDetails = null;
    state.selectedAircraftDetailsError = "";
    state.selectedAircraftDetailsLoading = false;
    setDetailsPanelOpen(true);
    void loadSelectedAircraftDetails();
    scheduleRender();
  }

  function updateSelectedAircraftSnapshot() {
    if (!state.selectedAircraftId) {
      return;
    }

    const nextAircraft = state.aircraft.find((aircraft) => aircraft.id === state.selectedAircraftId) || null;
    if (!nextAircraft) {
      updateDetailsPanel();
      return;
    }

    state.selectedAircraftSnapshot = nextAircraft;
    const lookup = buildAircraftDetailsLookup(nextAircraft);
    if (lookup && lookup.key !== state.selectedAircraftDetailsKey) {
      state.selectedAircraftDetails = null;
      state.selectedAircraftDetailsError = "";
      state.selectedAircraftDetailsLoading = false;
      void loadSelectedAircraftDetails();
    } else {
      updateDetailsPanel();
    }
  }

  function ensureHud() {
    if (state.hudRootEl && state.hudRootEl.isConnected) {
      return;
    }

    const hudRootEl = document.createElement("div");
    hudRootEl.id = "gm-flight-overlay-root";

    const canvasEl = document.createElement("canvas");
    canvasEl.id = "gm-flight-overlay-canvas";

    const badgeEl = document.createElement("div");
    badgeEl.id = "gm-flight-overlay-badge";
    badgeEl.dataset.level = "boot";

    const menuButtonEl = document.createElement("button");
    menuButtonEl.type = "button";
    menuButtonEl.id = "gm-flight-overlay-menu-button";
    menuButtonEl.dataset.open = "false";
    menuButtonEl.title = "Open flight overlay menu";

    const launcherIconEl = document.createElement("span");
    launcherIconEl.className = "gm-flight-overlay-menu-icon";
    launcherIconEl.textContent = "✈";

    const launcherLabelEl = document.createElement("span");
    launcherLabelEl.className = "gm-flight-overlay-menu-label";
    launcherLabelEl.textContent = "Flights";

    menuButtonEl.appendChild(launcherIconEl);
    menuButtonEl.appendChild(launcherLabelEl);

    const menuPanelEl = document.createElement("div");
    menuPanelEl.id = "gm-flight-overlay-menu-panel";
    menuPanelEl.dataset.open = "false";

    const menuTitleEl = document.createElement("div");
    menuTitleEl.className = "gm-flight-overlay-menu-title";
    menuTitleEl.textContent = "Flight Overlay";

    const menuInfoEl = document.createElement("div");
    menuInfoEl.className = "gm-flight-overlay-menu-info";

    const menuActionsEl = document.createElement("div");
    menuActionsEl.className = "gm-flight-overlay-menu-actions";

    const toggleLogsButtonEl = document.createElement("button");
    toggleLogsButtonEl.type = "button";
    toggleLogsButtonEl.className = "gm-flight-overlay-menu-button";
    toggleLogsButtonEl.textContent = "Toggle Logs";

    const copyLogsMenuButtonEl = document.createElement("button");
    copyLogsMenuButtonEl.type = "button";
    copyLogsMenuButtonEl.className = "gm-flight-overlay-menu-button";
    copyLogsMenuButtonEl.textContent = "Copy Logs";

    const clearLogsMenuButtonEl = document.createElement("button");
    clearLogsMenuButtonEl.type = "button";
    clearLogsMenuButtonEl.className = "gm-flight-overlay-menu-button";
    clearLogsMenuButtonEl.textContent = "Clear Logs";

    const closeMenuButtonEl = document.createElement("button");
    closeMenuButtonEl.type = "button";
    closeMenuButtonEl.className = "gm-flight-overlay-menu-button";
    closeMenuButtonEl.textContent = "Close Menu";

    menuActionsEl.appendChild(toggleLogsButtonEl);
    menuActionsEl.appendChild(copyLogsMenuButtonEl);
    menuActionsEl.appendChild(clearLogsMenuButtonEl);
    menuActionsEl.appendChild(closeMenuButtonEl);
    menuPanelEl.appendChild(menuTitleEl);
    menuPanelEl.appendChild(menuInfoEl);
    menuPanelEl.appendChild(menuActionsEl);

    const tooltipEl = document.createElement("div");
    tooltipEl.id = "gm-flight-overlay-tooltip";

    const detailsPanelEl = document.createElement("div");
    detailsPanelEl.id = "gm-flight-overlay-details-panel";
    detailsPanelEl.dataset.open = "false";

    const detailsHeaderEl = document.createElement("div");
    detailsHeaderEl.className = "gm-flight-overlay-details-header";
    detailsHeaderEl.textContent = "Selected Flight";

    const detailsCloseButtonEl = document.createElement("button");
    detailsCloseButtonEl.type = "button";
    detailsCloseButtonEl.className = "gm-flight-overlay-details-close";
    detailsCloseButtonEl.textContent = "Hide";

    const detailsBodyEl = document.createElement("div");
    detailsBodyEl.id = "gm-flight-overlay-details-body";

    detailsHeaderEl.appendChild(detailsCloseButtonEl);
    detailsPanelEl.appendChild(detailsHeaderEl);
    detailsPanelEl.appendChild(detailsBodyEl);

    const logPanelEl = document.createElement("div");
    logPanelEl.id = "gm-flight-overlay-log-panel";
    logPanelEl.dataset.open = "false";

    const logHeaderEl = document.createElement("div");
    logHeaderEl.className = "gm-flight-overlay-log-header";
    logHeaderEl.textContent = "Overlay Logs";

    const logActionsEl = document.createElement("div");
    logActionsEl.className = "gm-flight-overlay-log-actions";

    const copyLogsButtonEl = document.createElement("button");
    copyLogsButtonEl.type = "button";
    copyLogsButtonEl.className = "gm-flight-overlay-log-button";
    copyLogsButtonEl.textContent = "Copy";

    const clearLogsButtonEl = document.createElement("button");
    clearLogsButtonEl.type = "button";
    clearLogsButtonEl.className = "gm-flight-overlay-log-button";
    clearLogsButtonEl.textContent = "Clear";

    const collapseLogsButtonEl = document.createElement("button");
    collapseLogsButtonEl.type = "button";
    collapseLogsButtonEl.className = "gm-flight-overlay-log-button";
    collapseLogsButtonEl.textContent = "Hide";

    const logBodyEl = document.createElement("div");
    logBodyEl.id = "gm-flight-overlay-log-body";

    logActionsEl.appendChild(copyLogsButtonEl);
    logActionsEl.appendChild(clearLogsButtonEl);
    logActionsEl.appendChild(collapseLogsButtonEl);
    logHeaderEl.appendChild(logActionsEl);
    logPanelEl.appendChild(logHeaderEl);
    logPanelEl.appendChild(logBodyEl);

    hudRootEl.appendChild(canvasEl);
    hudRootEl.appendChild(badgeEl);
    hudRootEl.appendChild(menuButtonEl);
    hudRootEl.appendChild(menuPanelEl);
    hudRootEl.appendChild(tooltipEl);
    hudRootEl.appendChild(detailsPanelEl);
    hudRootEl.appendChild(logPanelEl);
    (document.body || document.documentElement).appendChild(hudRootEl);

    state.hudRootEl = hudRootEl;
    state.canvasEl = canvasEl;
    state.canvasCtx = canvasEl.getContext("2d");
    state.badgeEl = badgeEl;
    state.detailsPanelBodyEl = detailsBodyEl;
    state.detailsPanelEl = detailsPanelEl;
    state.menuButtonEl = menuButtonEl;
    state.menuInfoEl = menuInfoEl;
    state.menuPanelEl = menuPanelEl;
    state.logPanelBodyEl = logBodyEl;
    state.logPanelEl = logPanelEl;
    state.tooltipEl = tooltipEl;

    menuButtonEl.addEventListener("click", () => {
      toggleMenu();
    });

    toggleLogsButtonEl.addEventListener("click", () => {
      toggleLogPanel();
    });

    const handleCopyLogs = async () => {
      try {
        await copyLogsToClipboard();
        logEvent("info", "Copied logs to clipboard");
        setStatus("ok", "Logs copied to clipboard");
      } catch (error) {
        state.lastError = error instanceof Error ? error.message : String(error);
        logEvent("error", "Failed to copy logs", error);
        setStatus("error", "Failed to copy logs");
      }
    };

    copyLogsButtonEl.addEventListener("click", handleCopyLogs);
    copyLogsMenuButtonEl.addEventListener("click", handleCopyLogs);

    const handleClearLogs = () => {
      state.logs = [];
      logEvent("info", "Cleared log panel");
      setStatus("ok", "Logs cleared");
    };

    clearLogsButtonEl.addEventListener("click", handleClearLogs);
    clearLogsMenuButtonEl.addEventListener("click", handleClearLogs);

    collapseLogsButtonEl.addEventListener("click", () => {
      setLogPanelOpen(false);
    });

    closeMenuButtonEl.addEventListener("click", () => {
      setMenuOpen(false);
    });

    detailsCloseButtonEl.addEventListener("click", () => {
      clearSelectedAircraft();
    });

    updateBadge();
    updateDetailsPanel();
    updateLogPanel();
    updateMenuPanel();
  }

  function isVisibleElement(element) {
    if (!element || !(element instanceof HTMLElement)) {
      return false;
    }

    if (state.hudRootEl && (element === state.hudRootEl || state.hudRootEl.contains(element))) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < 280 || rect.height < 280) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }

    return true;
  }

  function scoreViewportCandidate(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const signalText = `${element.id || ""} ${element.className || ""} ${element.getAttribute("role") || ""} ${element.getAttribute("aria-label") || ""}`.toLowerCase();

    let score = rect.width * rect.height;

    if (signalText.includes("scene")) {
      score += 1_000_000;
    }
    if (signalText.includes("map")) {
      score += 600_000;
    }
    if (signalText.includes("widget")) {
      score += 250_000;
    }
    if (element.querySelector("canvas, img, svg")) {
      score += 250_000;
    }
    if (style.overflow === "hidden" || style.overflowX === "hidden" || style.overflowY === "hidden") {
      score += 100_000;
    }
    if (rect.right >= window.innerWidth - 8) {
      score += 80_000;
    }
    if (rect.bottom >= window.innerHeight - 8) {
      score += 60_000;
    }
    if (rect.left > 0) {
      score += 40_000;
    }
    if (rect.left >= window.innerWidth * 0.1) {
      score += 40_000;
    }
    if (rect.width === window.innerWidth && rect.height === window.innerHeight) {
      score -= 180_000;
    }

    return score;
  }

  function findViewportElement() {
    const preferredSelectors = [
      "#scene",
      ".widget-scene",
      "div[aria-label*='Map']",
      "div[role='main']",
      "main",
    ];

    for (const selector of preferredSelectors) {
      const element = document.querySelector(selector);
      if (isVisibleElement(element)) {
        return element;
      }
    }

    const candidates = document.querySelectorAll("div, main, section");
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
      height: rect.height,
    };

    const prevRect = state.viewportRect;
    state.viewportRect = nextRect;

    return !prevRect ||
      prevRect.left !== nextRect.left ||
      prevRect.top !== nextRect.top ||
      prevRect.width !== nextRect.width ||
      prevRect.height !== nextRect.height;
  }

  function refreshViewportBinding(reason) {
    const now = Date.now();
    if (now - state.lastViewportScanAt < CONFIG.domWatchDebounceMs && reason !== "force") {
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
          className: nextViewportEl.className || null,
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
      window.clearTimeout(state.pendingViewportRefresh);
    }

    state.pendingViewportRefresh = window.setTimeout(() => {
      state.pendingViewportRefresh = 0;
      refreshViewportBinding("force");
    }, CONFIG.domWatchDebounceMs);
  }

  function kickInteractionRender(reason) {
    const now = Date.now();
    state.lastMapInteractionAt = now;
    state.interactionRenderUntil = Math.max(
      state.interactionRenderUntil,
      now + CONFIG.interactionRenderDurationMs
    );

    if (state.interactionFrameHandle) {
      return;
    }

    const tick = () => {
      state.interactionFrameHandle = 0;
      const stillActive = Date.now() < state.interactionRenderUntil;
      if (!stillActive) {
        return;
      }

      syncMapStateFromUrl();
      if (!state.viewportEl || !state.viewportEl.isConnected) {
        refreshViewportBinding("force");
      } else {
        updateViewportRect();
      }
      scheduleRender();

      state.interactionFrameHandle = window.requestAnimationFrame(tick);
    };

    logEvent("debug", "Starting interaction render loop", { reason });
    state.interactionFrameHandle = window.requestAnimationFrame(tick);
  }

  function parseMapStateFromUrl(href) {
    const zoomMatch = href.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/i);
    if (zoomMatch) {
      const centerLat = Number(zoomMatch[1]);
      const centerLon = Number(zoomMatch[2]);
      const zoom = Number(zoomMatch[3]);
      if (!Number.isFinite(centerLat) || !Number.isFinite(centerLon) || !Number.isFinite(zoom)) {
        return null;
      }

      return {
        centerLat,
        centerLon,
        zoom,
        zoomSource: "zoom",
        scaleMeters: null,
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
        (state.viewportRect && state.viewportRect.height) ||
        window.innerHeight ||
        document.documentElement.clientHeight ||
        900
      )
    );
    const zoom = Math.log2(
      (Math.cos(centerLat * DEG_TO_RAD) * WORLD_RESOLUTION_MPP * viewportHeight) / scaleMeters
    );

    if (
      !Number.isFinite(centerLat) ||
      !Number.isFinite(centerLon) ||
      !Number.isFinite(scaleMeters) ||
      scaleMeters <= 0 ||
      !Number.isFinite(zoom)
    ) {
      return null;
    }

    return {
      centerLat,
      centerLon,
      zoom: clamp(zoom, 0, 22),
      zoomSource: "meters-estimate",
      scaleMeters,
    };
  }

  function syncMapStateFromUrl() {
    const nextHref = window.location.href;
    const hrefChanged = nextHref !== state.lastLocationHref;
    state.lastLocationHref = nextHref;

    const prevMapState = state.mapState;
    const nextMapState = parseMapStateFromUrl(nextHref);
    if (!nextMapState) {
      state.mapState = null;
      const pauseReason = "url-unreadable";
      if (state.lastPauseReason !== pauseReason) {
        state.lastPauseReason = pauseReason;
        logEvent("warn", "Paused because URL does not expose @lat,lon,zoomz or @lat,lon,metersm", { href: nextHref });
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

    const changed = !prevMapState ||
      prevMapState.centerLat !== nextMapState.centerLat ||
      prevMapState.centerLon !== nextMapState.centerLon ||
      prevMapState.zoom !== nextMapState.zoom;

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

  function metersPerPixel(latitude, zoom) {
    return Math.cos(latitude * DEG_TO_RAD) * WORLD_RESOLUTION_MPP / Math.pow(2, zoom);
  }

  function deriveQueryRadiusNm(mapState, viewportRect) {
    const diagonalPx = Math.hypot(viewportRect.width, viewportRect.height);
    const resolution = metersPerPixel(mapState.centerLat, mapState.zoom);
    const radiusMeters = diagonalPx * 0.5 * resolution * 1.15;
    const radiusNm = radiusMeters / 1852;

    return clamp(Math.ceil(radiusNm), CONFIG.minQueryRadiusNm, CONFIG.maxQueryRadiusNm);
  }

  function latLonToWorld(lat, lon, zoom) {
    const scale = TILE_SIZE * Math.pow(2, zoom);
    const sinLat = clamp(Math.sin(lat * DEG_TO_RAD), -0.9999, 0.9999);

    return {
      x: ((lon + 180) / 360) * scale,
      y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
      worldSize: scale,
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
      y: viewportRect.height / 2 + dy,
    };
  }

  function resizeCanvas() {
    if (!state.canvasEl || !state.viewportRect) {
      return false;
    }

    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(state.viewportRect.width));
    const height = Math.max(1, Math.round(state.viewportRect.height));
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));

    state.canvasEl.style.left = `${Math.round(state.viewportRect.left)}px`;
    state.canvasEl.style.top = `${Math.round(state.viewportRect.top)}px`;
    state.canvasEl.style.width = `${width}px`;
    state.canvasEl.style.height = `${height}px`;

    if (state.canvasEl.width !== pixelWidth || state.canvasEl.height !== pixelHeight) {
      state.canvasEl.width = pixelWidth;
      state.canvasEl.height = pixelHeight;
      state.canvasCtx.setTransform(1, 0, 0, 1, 0, 0);
      state.canvasCtx.scale(dpr, dpr);
      return true;
    }

    return false;
  }

  function clearCanvas() {
    if (!state.canvasCtx || !state.viewportRect) {
      return;
    }
    state.canvasCtx.clearRect(0, 0, state.viewportRect.width, state.viewportRect.height);
  }

  function drawMarker(ctx, marker, highlighted) {
    const size = CONFIG.markerSizePx;
    const aircraft = marker.aircraft;

    ctx.save();
    ctx.translate(marker.x, marker.y);

    if (isFiniteNumber(aircraft.heading)) {
      ctx.rotate((((aircraft.heading % 360) + 360) % 360) * DEG_TO_RAD);
    }

    if (highlighted) {
      ctx.beginPath();
      ctx.arc(0, 0, size + 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 209, 102, 0.18)";
      ctx.fill();
    }

    ctx.shadowBlur = 10;
    ctx.shadowColor = CONFIG.markerShadowColor;
    ctx.lineWidth = highlighted ? 2.25 : 1.5;
    ctx.strokeStyle = CONFIG.markerStrokeColor;
    ctx.fillStyle = highlighted ? CONFIG.markerHighlightColor : CONFIG.markerFillColor;

    if (isFiniteNumber(aircraft.heading)) {
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
      `Updated: ${formatAge(marker.aircraft.updatedAt)}`,
    ];

    state.tooltipEl.textContent = lines.join("\n");
    state.tooltipEl.style.display = "block";

    const tooltipWidth = 220;
    const tooltipHeight = 124;
    const offset = 14;
    const left = clamp(state.mouseX + offset, 8, Math.max(8, window.innerWidth - tooltipWidth - 8));
    const top = clamp(state.mouseY + offset, 8, Math.max(8, window.innerHeight - tooltipHeight - 8));
    state.tooltipEl.style.left = `${Math.round(left)}px`;
    state.tooltipEl.style.top = `${Math.round(top)}px`;
  }

  function hideTooltip() {
    if (!state.tooltipEl) {
      return;
    }
    state.tooltipEl.style.display = "none";
  }

  function findMarkerAtClientPoint(clientX, clientY, hitRadiusPx) {
    if (!state.viewportRect || state.drawnMarkers.length === 0) {
      return null;
    }

    const localX = clientX - state.viewportRect.left;
    const localY = clientY - state.viewportRect.top;
    if (
      localX < 0 ||
      localY < 0 ||
      localX > state.viewportRect.width ||
      localY > state.viewportRect.height
    ) {
      return null;
    }

    let bestMarker = null;
    let bestDistanceSq = hitRadiusPx * hitRadiusPx;

    for (const marker of state.drawnMarkers) {
      const dx = marker.x - localX;
      const dy = marker.y - localY;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq <= bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestMarker = marker;
      }
    }

    return bestMarker;
  }

  function updateHoverState() {
    if (!state.viewportRect || state.drawnMarkers.length === 0) {
      const hadHover = state.hoverMarkerId !== null;
      state.hoverMarkerId = null;
      hideTooltip();
      if (hadHover) {
        scheduleRender();
      }
      return;
    }

    const bestMarker = findMarkerAtClientPoint(state.mouseX, state.mouseY, CONFIG.hoverHitRadiusPx);
    if (!bestMarker) {
      if (state.hoverMarkerId !== null) {
        state.hoverMarkerId = null;
        scheduleRender();
      }
      hideTooltip();
      return;
    }

    const nextHoverId = bestMarker.aircraft.id;
    if (nextHoverId !== state.hoverMarkerId) {
      state.hoverMarkerId = nextHoverId;
      scheduleRender();
    }

    renderTooltip(bestMarker);
  }

  function renderFrame() {
    state.renderScheduled = false;

    if (!state.canvasEl || !state.canvasCtx) {
      return;
    }

    syncMapStateFromUrl();

    if (!state.viewportEl || !state.viewportEl.isConnected) {
      refreshViewportBinding("force");
    } else {
      updateViewportRect();
    }

    resizeCanvas();
    clearCanvas();
    state.drawnMarkers = [];

    if (!state.viewportRect || !state.mapState) {
      updateBadge();
      hideTooltip();
      return;
    }

    const ctx = state.canvasCtx;
    const margin = CONFIG.renderMarginPx;

    for (const aircraft of state.aircraft) {
      const point = projectToViewport(state.mapState, state.viewportRect, aircraft.lat, aircraft.lon);

      if (
        point.x < -margin ||
        point.y < -margin ||
        point.x > state.viewportRect.width + margin ||
        point.y > state.viewportRect.height + margin
      ) {
        continue;
      }

      state.drawnMarkers.push({
        x: point.x,
        y: point.y,
        aircraft,
      });
    }

    for (const marker of state.drawnMarkers) {
      drawMarker(ctx, marker, marker.aircraft.id === state.hoverMarkerId);
    }

    updateHoverState();
    updateBadge();
  }

  function scheduleRender() {
    if (state.renderScheduled) {
      return;
    }

    state.renderScheduled = true;
    window.requestAnimationFrame(renderFrame);
  }

  function deriveUpdatedAtMs(record, nowSec) {
    const seenPos = firstFiniteNumber(record.seen_pos, record.seen);
    if (isFiniteNumber(nowSec) && isFiniteNumber(seenPos)) {
      return Math.round((nowSec - seenPos) * 1000);
    }
    if (isFiniteNumber(nowSec)) {
      return Math.round(nowSec * 1000);
    }
    return Date.now();
  }

  function normalizeAircraft(payload) {
    const nowSec = toFiniteNumber(payload.now);
    const records = Array.isArray(payload.ac)
      ? payload.ac
      : Array.isArray(payload.aircraft)
        ? payload.aircraft
        : [];

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
        onGround,
      });
    }

    return normalized;
  }

  function buildRequestUrl() {
    if (!state.mapState || !state.viewportRect) {
      return null;
    }

    const radiusNm = deriveQueryRadiusNm(state.mapState, state.viewportRect);
    return {
      radiusNm,
      url: `https://api.airplanes.live/v2/point/${state.mapState.centerLat.toFixed(6)}/${state.mapState.centerLon.toFixed(6)}/${radiusNm}`,
    };
  }

  async function requestJson(url) {
    logEvent("debug", "Requesting flight data", { url });
    const response = await GM.xmlHttpRequest({
      method: "GET",
      url,
      timeout: CONFIG.fetchTimeoutMs,
      headers: {
        Accept: "application/json",
      },
    });

    if (!response || response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response ? response.status : "request_failed"}`);
    }

    return JSON.parse(response.responseText);
  }

  async function maybeFetchAircraft() {
    if (document.hidden || state.isFetching || !state.mapState || !state.viewportRect) {
      return;
    }

    const now = Date.now();
    if (now < state.rateLimitBackoffUntil) {
      return;
    }

    if (now - state.lastMapInteractionAt < CONFIG.interactionSettleDelayMs) {
      return;
    }

    if (now < state.nextFetchDueAt) {
      return;
    }

    if (now - state.lastFetchStartedAt < CONFIG.minFetchGapMs) {
      state.nextFetchDueAt = state.lastFetchStartedAt + CONFIG.minFetchGapMs;
      return;
    }

    const request = buildRequestUrl();
    if (!request) {
      return;
    }

    state.isFetching = true;
    state.lastFetchStartedAt = now;
    logEvent("info", "Starting flight data refresh", request);
    setStatus("warn", `Fetching ${request.radiusNm}nm`);

    try {
      const payload = await requestJson(request.url);
      const aircraft = normalizeAircraft(payload);

      state.aircraft = aircraft;
      state.lastSuccessAt = Date.now();
      state.lastFetchCompletedAt = state.lastSuccessAt;
      state.lastError = "";
      state.rateLimitBackoffUntil = 0;
      state.nextFetchDueAt = Date.now() + CONFIG.refreshIntervalMs;
       logEvent("info", "Flight data refresh succeeded", {
        radiusNm: request.radiusNm,
        aircraftCount: aircraft.length,
      });
      updateSelectedAircraftSnapshot();
      setStatus("ok", `Live: ${aircraft.length} aircraft from Airplanes.live`);
      scheduleRender();
    } catch (error) {
      state.lastFetchCompletedAt = Date.now();
      state.lastError = error instanceof Error ? error.message : String(error);
      const isRateLimited = state.lastError.includes("429");
      state.rateLimitBackoffUntil = isRateLimited ? Date.now() + CONFIG.rateLimitBackoffMs : 0;
      state.nextFetchDueAt = Date.now() + (isRateLimited ? CONFIG.rateLimitBackoffMs : CONFIG.refreshIntervalMs);
      logEvent("error", "Flight data refresh failed", error);

      if (!isRateLimited && Date.now() - state.lastSuccessAt > CONFIG.refreshIntervalMs * 2) {
        state.aircraft = [];
      }

      setStatus(
        "error",
        isRateLimited ? "Rate limited, backing off before next refresh" : "Fetch failed, showing last good frame"
      );
      scheduleRender();
    } finally {
      state.isFetching = false;
      updateBadge();
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
      void maybeFetchAircraft();
      scheduleRender();
    } else {
      logEvent("info", "Tab hidden, pausing refresh loop");
      setStatus("warn", "Paused while tab is hidden");
      hideTooltip();
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
        error: event.error,
      });
    });

    window.addEventListener("unhandledrejection", (event) => {
      logEvent("error", "Unhandled promise rejection", event.reason);
    });

    window.addEventListener("resize", () => {
      kickInteractionRender("resize");
      refreshViewportBinding("force");
      scheduleRender();
    }, { passive: true });

    window.addEventListener("popstate", () => {
      kickInteractionRender("popstate");
      syncMapStateFromUrl();
      scheduleRender();
    }, { passive: true });

    window.addEventListener("wheel", () => {
      kickInteractionRender("wheel");
    }, { passive: true });

    window.addEventListener("pointerdown", () => {
      kickInteractionRender("pointerdown");
    }, { passive: true });

    window.addEventListener("pointermove", () => {
      if (state.lastMapInteractionAt && Date.now() - state.lastMapInteractionAt < CONFIG.interactionRenderDurationMs) {
        kickInteractionRender("pointermove");
      }
    }, { passive: true });

    window.addEventListener("touchstart", () => {
      kickInteractionRender("touchstart");
    }, { passive: true });

    window.addEventListener("keydown", (event) => {
      if (event.key === "+" || event.key === "-" || event.key === "=" || event.key === "_") {
        kickInteractionRender("keydown");
      }
    }, { passive: true });

    window.addEventListener("click", (event) => {
      if (state.hudRootEl && event.target instanceof Node && state.hudRootEl.contains(event.target)) {
        return;
      }

      const marker = findMarkerAtClientPoint(event.clientX, event.clientY, CONFIG.hoverHitRadiusPx + 6);
      if (marker) {
        selectAircraft(marker.aircraft);
      }
    }, true);

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange, { passive: true });

    state.domObserver = new MutationObserver(() => {
      scheduleViewportRefresh();
    });

    state.domObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function heartbeat() {
    const hrefChanged = syncMapStateFromUrl();

    if (
      hrefChanged ||
      !state.viewportEl ||
      !state.viewportEl.isConnected ||
      Date.now() - state.lastViewportScanAt >= CONFIG.viewportPollIntervalMs
    ) {
      refreshViewportBinding("force");
    } else if (updateViewportRect()) {
      scheduleRender();
    }

    if (!document.hidden) {
      void maybeFetchAircraft();
    }
  }

  function start() {
    ensureHud();
    registerTampermonkeyMenuCommands();
    logEvent("info", "Starting userscript", {
      version: VERSION,
      href: window.location.href,
    });
    setStatus("boot", "Booting");
    if (CONFIG.autoOpenMenuOnBoot) {
      setMenuOpen(true);
    }
    syncMapStateFromUrl();
    refreshViewportBinding("force");
    installObservers();
    state.nextFetchDueAt = 0;
    state.heartbeatTimer = window.setInterval(heartbeat, Math.min(CONFIG.urlPollIntervalMs, CONFIG.viewportPollIntervalMs));
    heartbeat();
  }

  start();
})();

import { APP_CONFIG, VERSION, VERSION_HISTORY } from "./config.js";
import { loadSettings, saveSettings, importSettings, createStorage } from "./storage.js";
import { createState } from "./state.js";
import {
  cleanText,
  copyTextToClipboard,
  formatLatLon,
  formatZoomSummary,
} from "./utils.js";
import { createDebugService } from "./debug.js";
import { createMapController, projectToViewport } from "./map.js";
import { createLiveDataController, normalizeAircraft, requestJson } from "./data/live.js";
import { createEnrichmentService } from "./data/enrichment.js";
import { buildDensityScene, findSceneTargetAtPoint } from "./render/density.js";
import {
  createInterpolationState,
  sampleInterpolatedAircraft,
  updateInterpolationFromState,
} from "./render/interpolation.js";
import {
  collectRenderableTrails,
  createTrailStore,
  updateTrailStoreFromState,
} from "./render/trails.js";
import {
  clearCanvas,
  DEFAULT_CANVAS_THEME,
  drawAircraftLabel,
  drawAircraftMarker,
  drawClusterBubble,
  drawSpiderfyLayout,
  drawTrail,
  resizeCanvasForViewport,
  shouldRenderAircraftLabel,
} from "./render/canvas.js";
import { createUiController } from "./ui/index.js";

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
    transitionDurationMs: APP_CONFIG.interpolationDurationMs,
  });
  state.trailStore = createTrailStore({
    maxAgeMs: APP_CONFIG.trailExpireMs,
    maxPoints: APP_CONFIG.trailMaxPoints,
  });

  let ui = null;
  let mapController = null;
  let liveData = null;
  let enrichment = null;
  let enrichmentPhotoMode = null;

  const debug = createDebugService({
    level: settings.debugLevel,
    logBufferSize: APP_CONFIG.logBufferSize,
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
          hoveredAircraftId: state.hoverMarkerId,
        }).length,
      },
      selectedAircraft: state.selectedAircraftSnapshot,
      selectedAircraftDetails: state.selectedAircraftDetails,
      enrichment: {
        source: state.selectedAircraftDetails ? state.selectedAircraftDetails.source : "none",
        loading: state.selectedAircraftDetailsLoading,
        hasPhoto: Boolean(
          state.selectedAircraftDetails &&
          (state.selectedAircraftDetails.photoUrl || state.selectedAircraftDetails.photoThumbnailUrl)
        ),
        hasRoute: Boolean(
          state.selectedAircraftDetails &&
          (state.selectedAircraftDetails.origin || state.selectedAircraftDetails.destination)
        ),
        error: state.selectedAircraftDetailsError || null,
        advisory: Boolean(state.selectedAircraftDetails && state.selectedAircraftDetails.routeAdvisory),
      },
      viewport: {
        bound: Boolean(state.viewportRect),
        rect: state.viewportRect,
        reason: state.lastPauseReason || "",
        viewportId: state.viewportEl ? state.viewportEl.id || null : null,
        className: state.viewportEl ? state.viewportEl.className || null : null,
        lastScanAt: state.lastViewportScanAt,
      },
      replay: {
        active: state.replayMode,
        mode: state.replayMode ? "replay" : "inactive",
        currentIndex: state.replayFrameIndex,
      },
      replaySnapshots: state.replayFrames,
      lastFetch: state.lastFetchSummary,
      logs: debug.store.logs,
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
      trailSelectedColor: APP_CONFIG.selectedTrailStrokeColor,
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
        hasRoute: Boolean(details.origin || details.destination),
      });
    } catch (error) {
      state.selectedAircraftDetailsLoading = false;
      state.selectedAircraftDetailsError = error instanceof Error ? error.message : String(error);
      logEvent("warn", "Failed to load selected aircraft details", {
        message: state.selectedAircraftDetailsError,
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
      registration: aircraft.registration,
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
      if (
        point.x < -margin ||
        point.y < -margin ||
        point.x > viewportRect.width + margin ||
        point.y > viewportRect.height + margin
      ) {
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
        isHovered: aircraft.id === state.hoverMarkerId,
      });
    }

    return projected;
  }

  function projectTrailPoints(trail) {
    if (!state.mapState || !state.viewportRect) {
      return [];
    }

    return trail.points
      .map((point) => ({
        ...point,
        ...projectToViewport(state.mapState, state.viewportRect, point.lat, point.lon),
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  }

  function renderDensityScene(ctx, densityScene) {
    const theme = getTheme();
    state.drawnMarkers = [];
    state.renderedAircraftByMarkerId = new Map();

    const displayAircraftById = new Map(
      state.interpolatedAircraftList.map((aircraft) => [aircraft.id, aircraft])
    );

    const trails = collectRenderableTrails(state.trailStore, {
      mode: state.settings.trailMode,
      selectedAircraftId: state.selectedAircraftId,
      hoveredAircraftId: state.hoverMarkerId,
    });

    for (const trail of trails) {
      const points = projectTrailPoints(trail);
      if (points.length < 2) {
        continue;
      }
      drawTrail(ctx, points, {
        selected: trail.selected,
        theme,
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
              const aircraft = displayAircraftById.get(item.marker.aircraftId || item.marker.id) || null;
              if (aircraft) {
                state.drawnMarkers.push({
                  aircraft,
                  x: item.x,
                  y: item.y,
                  markerId: item.marker.id,
                  type: "spiderfy-item",
                });
                state.renderedAircraftByMarkerId.set(item.marker.id, aircraft);
              }
              return {
                x: item.x,
                y: item.y,
                heading: aircraft ? aircraft.heading : item.marker.heading,
                selected: item.isSelected,
                highlighted: item.isHovered,
                label: shouldRenderAircraftLabel(item.marker.id, {
                  mode: state.settings.labelMode,
                  selectedAircraftId: state.selectedAircraftId,
                  hoveredAircraftId: state.hoverMarkerId,
                  zoom: state.mapState ? state.mapState.zoom : null,
                  minZoomForLabels: APP_CONFIG.highZoomLabelsThreshold,
                  isVisible: true,
                })
                  ? cleanText(aircraft && aircraft.callsign) || cleanText(aircraft && aircraft.registration) || item.marker.id
                  : null,
              };
            }),
          },
          {
            theme,
            memberRadiusPx: state.settings.markerSizePx,
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
          selected: group.selectedCount > 0,
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
        type: "marker",
      });
      state.renderedAircraftByMarkerId.set(member.id, aircraft);

      drawAircraftMarker(ctx, {
        aircraft,
        x: group.center.x,
        y: group.center.y,
        heading: aircraft.heading,
        selected: member.isSelected,
        highlighted: member.isHovered,
      }, {
        sizePx: state.settings.markerSizePx,
        theme,
      });

      if (shouldRenderAircraftLabel(member.id, {
        mode: state.settings.labelMode,
        selectedAircraftId: state.selectedAircraftId,
        hoveredAircraftId: state.hoverMarkerId,
        zoom: state.mapState ? state.mapState.zoom : null,
        minZoomForLabels: APP_CONFIG.highZoomLabelsThreshold,
        isVisible: true,
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
      staleAfterMs: APP_CONFIG.refreshIntervalMs * 3,
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
      spiderfyHitPaddingPx: state.settings.hoverHitRadiusPx,
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
    if (
      localX < 0 ||
      localY < 0 ||
      localX > state.viewportRect.width ||
      localY > state.viewportRect.height
    ) {
      return null;
    }

    return findSceneTargetAtPoint(state.densityScene, { x: localX, y: localY }, {
      singleHitRadiusPx: state.settings.hoverHitRadiusPx,
      clusterHitPaddingPx: Math.max(6, Math.round(state.settings.hoverHitRadiusPx * 0.45)),
      spiderfyHitPaddingPx: state.settings.hoverHitRadiusPx,
    });
  }

  function updateHoverState() {
    const hit = resolveHitAtClientPoint(state.mouseX, state.mouseY);
    if (!hit || (hit.type !== "marker" && hit.type !== "spiderfy-item")) {
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
          open: Boolean(state.spiderfyGroupKey),
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
      transitionDurationMs: APP_CONFIG.interpolationDurationMs,
    });
    updateTrailStoreFromState(state, meta.timestamp || Date.now(), {
      maxAgeMs: APP_CONFIG.trailExpireMs,
      maxPoints: APP_CONFIG.trailMaxPoints,
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
        scaleMeters: Number.isFinite(Number(snapshot.mapState.scaleMeters))
          ? Number(snapshot.mapState.scaleMeters)
          : null,
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
      snapshots: state.replayFrames.length,
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
    buildDebugContext,
  };

  ui = createUiController(appContext);
  mapController = createMapController({
    ...appContext,
    refreshAllUi() {
      if (ui) {
        ui.refreshAll();
      }
    },
  });
  liveData = createLiveDataController({
    ...appContext,
    onAircraftData: ({ aircraft, payload, request, previousAircraftById, nextAircraftById, fetchedAt }) => {
      state.previousAircraftById = previousAircraftById;
      state.aircraftById = nextAircraftById;
      state.aircraft = aircraft;
      updateInterpolationFromState(state, fetchedAt, {
        transitionDurationMs: APP_CONFIG.interpolationDurationMs,
      });
      updateTrailStoreFromState(state, fetchedAt, {
        maxAgeMs: APP_CONFIG.trailExpireMs,
        maxPoints: APP_CONFIG.trailMaxPoints,
      });
      state.lastFetchSummary = {
        ok: true,
        url: request.url,
        radiusNm: request.radiusNm,
        aircraftCount: aircraft.length,
        startedAt: state.lastFetchStartedAt,
        completedAt: fetchedAt,
      };
      debug.capturePayloadSnapshot({
        id: `fetch-${fetchedAt}`,
        label: `Fetch ${new Date(fetchedAt).toLocaleTimeString()}`,
        timestamp: fetchedAt,
        aircraftCount: aircraft.length,
        payload,
        mapState: state.mapState,
        viewport: state.viewportRect,
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
        backoffUntil: meta.backoffUntil,
      };
    },
  });
  function ensureEnrichmentService() {
    if (enrichment && enrichmentPhotoMode === state.settings.photoMode) {
      return enrichment;
    }

    enrichment = createEnrichmentService({
      requestJson: (url) => requestJson(url, {
        logEvent,
        label: "Requesting enrichment data",
        timeoutMs: APP_CONFIG.fetchTimeoutMs,
      }),
      storage,
      photoMode: state.settings.photoMode,
      logEvent,
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
        autoClose: true,
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
        autoClose: true,
      });
      GM_registerMenuCommand("Copy Flight Overlay Logs", () => {
        void copyLogsToClipboard();
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
        error: event.error,
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
      subtree: true,
    });
  }

  function heartbeat() {
    const hrefChanged = mapController.syncMapStateFromUrl();

    if (
      hrefChanged ||
      !state.viewportEl ||
      !state.viewportEl.isConnected ||
      Date.now() - state.lastViewportScanAt >= APP_CONFIG.viewportPollIntervalMs
    ) {
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
    href: window.location.href,
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

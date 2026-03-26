import { OVERLAY_STYLES } from "../styles.js";
import {
  copyTextToClipboard,
  formatAge,
  formatAircraftSubtitle,
  formatAircraftTitle,
  formatAltitude,
  formatHeading,
  formatLatLon,
  formatRouteEndpoint,
  formatSpeed,
  formatZoomSummary,
} from "../utils.js";

function applyPanelPosition(el, position) {
  if (!el || !position) {
    return;
  }

  for (const prop of ["left", "right", "top", "bottom"]) {
    if (position[prop] === null || position[prop] === undefined) {
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
    bodyEl,
  };
}

function installDragHandler(context, panelKey, panelEl, handleEl) {
  const { state, saveSettings } = context;

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
      bottom: null,
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
    void saveSettings();
  };

  handleEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    const rect = panelEl.getBoundingClientRect();
    state.panelDrag = {
      key: panelKey,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
  });
}

export function createUiController(context) {
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
    launcherEl.innerHTML = `<span class="gm-flight-overlay-launcher-icon">✈</span><span>Flights</span>`;

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
      debug: debugPanel,
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
      { key: "debugLevel", label: "Debug Level", type: "select", options: ["off", "basic", "trace"] },
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

    const backoffSeconds = state.rateLimitBackoffUntil > Date.now()
      ? Math.ceil((state.rateLimitBackoffUntil - Date.now()) / 1000)
      : 0;
    let summary = `Flight Overlay v${version}\n${state.statusText}`;
    if (state.mapState) {
      summary += `\nMap: ${formatZoomSummary(state.mapState)} @ ${formatLatLon(state.mapState.centerLat, state.mapState.centerLon)}`;
    }
    if (state.viewportRect) {
      summary += `\nViewport: ${Math.round(state.viewportRect.width)} x ${Math.round(state.viewportRect.height)}`;
    }
    summary += `\nVisible: ${state.aircraft.length}`;
    if (state.densityScene && state.densityScene.stats) {
      summary += `\nGroups: ${state.densityScene.stats.groupCount}`;
    }
    if (backoffSeconds > 0) {
      summary += `\nBackoff: ${backoffSeconds}s`;
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
      state.mapState
        ? `Map: ${formatZoomSummary(state.mapState)} @ ${formatLatLon(state.mapState.centerLat, state.mapState.centerLon)}`
        : "Map: n/a",
      state.viewportRect
        ? `Viewport: ${Math.round(state.viewportRect.width)} x ${Math.round(state.viewportRect.height)}`
        : "Viewport: n/a",
      state.densityScene
        ? `Density: ${state.densityScene.mode} (${state.densityScene.stats.groupCount} groups)`
        : "Density: n/a",
      `Logs: ${debug.store.logs.length}`,
      `Latest: ${versionHistory[0].changes[0]}`,
    ];
    state.menuInfoEl.textContent = lines.join("\n");
    syncPanelOpenState();
  }

  function updateLogPanel() {
    if (!state.logPanelBodyEl) {
      return;
    }
    state.logPanelBodyEl.textContent = debug.store.logs
      .map((entry) => {
        const lines = [`[${entry.ts}] ${entry.level.toUpperCase()} ${entry.message}`];
        if (entry.details !== null) {
          lines.push(JSON.stringify(entry.details, null, 2));
        }
        return lines.join("\n");
      })
      .join("\n\n");
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
      ["Registration", (details && details.registration) || aircraft.registration || "blank"],
      ["Hex", aircraft.id || "blank"],
      ["Type", (details && (details.type || details.icaoType)) || aircraft.aircraftType || "blank"],
      ["Operator", (details && (details.airlineName || details.owner)) || "blank"],
      ["Origin", formatRouteEndpoint(details && details.origin) || "blank"],
      ["Destination", formatRouteEndpoint(details && details.destination) || "blank"],
      ["Altitude", formatAltitude(aircraft)],
      ["Speed", formatSpeed(aircraft.speedKt)],
      ["Heading", formatHeading(aircraft.heading)],
      ["Updated", formatAge(aircraft.updatedAt)],
      ["Source", details && details.source ? details.source : "live"],
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
    state.debugPanelBodyEl.textContent = debug.store.logs
      .slice(-12)
      .map((entry) => {
        const lines = [`[${entry.ts}] ${entry.level.toUpperCase()} ${entry.message}`];
        if (entry.details !== null) {
          lines.push(JSON.stringify(entry.details, null, 2));
        }
        return lines.join("\n");
      })
      .join("\n\n");
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
    copyDebugExport,
  };
}

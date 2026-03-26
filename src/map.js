import {
  APP_CONFIG,
  DEG_TO_RAD,
  TILE_SIZE,
  WORLD_RESOLUTION_MPP,
} from "./config.js";
import { clamp } from "./utils.js";

export function createMapController(context) {
  const { state, window, document, logEvent, scheduleRender, setStatus } = context;

  function isVisibleElement(element) {
    if (!element || !(element instanceof window.HTMLElement)) {
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
    if (signalText.includes("globe")) {
      score += 150_000;
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
      "div[aria-label*='Satellite']",
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

    return (
      !prevRect ||
      prevRect.left !== nextRect.left ||
      prevRect.top !== nextRect.top ||
      prevRect.width !== nextRect.width ||
      prevRect.height !== nextRect.height
    );
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
        logEvent("warn", "Paused because URL does not expose @lat,lon,zoomz or @lat,lon,metersm", {
          href: nextHref,
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

    const changed = (
      !prevMapState ||
      prevMapState.centerLat !== nextMapState.centerLat ||
      prevMapState.centerLon !== nextMapState.centerLon ||
      prevMapState.zoom !== nextMapState.zoom
    );

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
    projectToViewport,
  };
}

export function metersPerPixel(latitude, zoom) {
  return Math.cos(latitude * DEG_TO_RAD) * WORLD_RESOLUTION_MPP / Math.pow(2, zoom);
}

export function deriveQueryRadiusNm(mapState, viewportRect) {
  const diagonalPx = Math.hypot(viewportRect.width, viewportRect.height);
  const resolution = metersPerPixel(mapState.centerLat, mapState.zoom);
  const radiusMeters = diagonalPx * 0.5 * resolution * 1.15;
  const radiusNm = radiusMeters / 1852;

  return clamp(Math.ceil(radiusNm), APP_CONFIG.minQueryRadiusNm, APP_CONFIG.maxQueryRadiusNm);
}

export function latLonToWorld(lat, lon, zoom) {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const sinLat = clamp(Math.sin(lat * DEG_TO_RAD), -0.9999, 0.9999);

  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
    worldSize: scale,
  };
}

export function projectToViewport(mapState, viewportRect, lat, lon) {
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

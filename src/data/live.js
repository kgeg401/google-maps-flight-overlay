import { APP_CONFIG } from "../config.js";
import { deriveQueryRadiusNm } from "../map.js";
import {
  cleanText,
  firstFiniteNumber,
  isFiniteNumber,
  toFiniteNumber,
} from "../utils.js";

export async function requestJson(url, options = {}) {
  const {
    accept = "application/json",
    timeoutMs = APP_CONFIG.fetchTimeoutMs,
    logEvent,
    label = "Requesting JSON",
  } = options;

  if (typeof logEvent === "function") {
    logEvent("debug", label, { url });
  }

  const response = await GM.xmlHttpRequest({
    method: "GET",
    url,
    timeout: timeoutMs,
    headers: {
      Accept: accept,
    },
  });

  if (!response || response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response ? response.status : "request_failed"}`);
  }

  return JSON.parse(response.responseText);
}

export function deriveUpdatedAtMs(record, nowSec) {
  const seenPos = firstFiniteNumber(record.seen_pos, record.seen);
  if (isFiniteNumber(nowSec) && isFiniteNumber(seenPos)) {
    return Math.round((nowSec - seenPos) * 1000);
  }
  if (isFiniteNumber(nowSec)) {
    return Math.round(nowSec * 1000);
  }
  return Date.now();
}

export function normalizeAircraft(payload) {
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

export function buildRequestUrl(mapState, viewportRect) {
  if (!mapState || !viewportRect) {
    return null;
  }

  const radiusNm = deriveQueryRadiusNm(mapState, viewportRect);
  return {
    radiusNm,
    url: `https://api.airplanes.live/v2/point/${mapState.centerLat.toFixed(6)}/${mapState.centerLon.toFixed(6)}/${radiusNm}`,
  };
}

export function createLiveDataController(context) {
  const {
    state,
    document,
    logEvent,
    setStatus,
    scheduleRender,
    onAircraftData,
    onFetchError,
  } = context;

  async function maybeFetchAircraft() {
    if (state.replayMode || document.hidden || state.isFetching || !state.mapState || !state.viewportRect) {
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
        label: "Requesting flight data",
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
        source: "airplanes.live",
      };

      logEvent("info", "Flight data refresh succeeded", {
        radiusNm: request.radiusNm,
        aircraftCount: aircraft.length,
      });

      if (typeof onAircraftData === "function") {
        await onAircraftData({
          aircraft,
          payload,
          request,
          previousAircraftById: previousMap,
          nextAircraftById: nextMap,
          fetchedAt: state.lastSuccessAt,
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
        backoffUntil: state.rateLimitBackoffUntil || null,
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
          backoffUntil: state.rateLimitBackoffUntil,
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
    requestJson,
  };
}

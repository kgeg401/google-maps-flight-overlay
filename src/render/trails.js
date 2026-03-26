const DEFAULT_TRAIL_OPTIONS = {
  maxAgeMs: 60000,
  maxPoints: 36,
  minMovementMeters: 200,
  minSampleSpacingMs: 800,
  retainMissingMs: 45000,
};

export const TRAIL_MODE_VALUES = ["selected-only", "selected-and-hovered", "off"];

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

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function haversineDistanceMeters(startLat, startLon, endLat, endLon) {
  const earthRadiusM = 6371008.8;
  const phi1 = toRadians(startLat);
  const phi2 = toRadians(endLat);
  const deltaPhi = toRadians(endLat - startLat);
  const deltaLambda = toRadians(endLon - startLon);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusM * c;
}

function createTrailStore(options = {}) {
  return {
    byId: new Map(),
    options: {
      ...DEFAULT_TRAIL_OPTIONS,
      ...options,
    },
  };
}

function isValidTrailAircraft(aircraft) {
  return Boolean(
    aircraft &&
      aircraft.id !== undefined &&
      aircraft.id !== null &&
      isFiniteNumber(aircraft.lat) &&
      isFiniteNumber(aircraft.lon)
  );
}

function getOrCreateTrail(store, aircraftId) {
  let trail = store.byId.get(aircraftId);
  if (!trail) {
    trail = {
      aircraftId,
      lastSeenAtMs: 0,
      lastSampleAtMs: 0,
      points: [],
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

  const movementMeters = haversineDistanceMeters(lastPoint.lat, lastPoint.lon, aircraft.lat, aircraft.lon);
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
    ...(store.options || {}),
    ...options,
  };
  const nowMs = isFiniteNumber(sampleAtMs) ? sampleAtMs : Date.now();
  const aircraftId = String(aircraft.id);
  const trail = getOrCreateTrail(store, aircraftId);
  trail.lastSeenAtMs = nowMs;
  trail.lastSampleAtMs = nowMs;

  if (shouldAppendTrailPoint(trail, aircraft, nowMs, resolvedOptions)) {
    trail.points.push({
      aircraftId,
      heading: isFiniteNumber(aircraft.heading) ? aircraft.heading : null,
      lat: aircraft.lat,
      lon: aircraft.lon,
      onGround: Boolean(aircraft.onGround),
      sampledAtMs: nowMs,
      speedKt: isFiniteNumber(aircraft.speedKt) ? aircraft.speedKt : null,
      updatedAtMs: isFiniteNumber(aircraft.updatedAt) ? aircraft.updatedAt : null,
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
    ...(store.options || {}),
    ...options,
  };
  const nowMs = isFiniteNumber(sampleAtMs) ? sampleAtMs : Date.now();

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
    ...(store.options || {}),
    ...options,
  };
  const cutoff = (isFiniteNumber(nowMs) ? nowMs : Date.now()) - Math.max(0, resolvedOptions.retainMissingMs);

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

function getTrailPoints(store, aircraftId) {
  if (!store || !(store.byId instanceof Map)) {
    return [];
  }

  const trail = store.byId.get(String(aircraftId));
  if (!trail || !Array.isArray(trail.points)) {
    return [];
  }

  return trail.points.map((point) => ({ ...point }));
}

function shouldRenderTrailForAircraft(aircraftId, context = {}) {
  const mode = context.mode || "selected-only";
  const selectedAircraftId = context.selectedAircraftId ?? null;
  const hoveredAircraftId = context.hoveredAircraftId ?? null;
  const normalizedAircraftId = aircraftId === undefined || aircraftId === null ? null : String(aircraftId);
  const normalizedSelectedId =
    selectedAircraftId === undefined || selectedAircraftId === null ? null : String(selectedAircraftId);
  const normalizedHoveredId =
    hoveredAircraftId === undefined || hoveredAircraftId === null ? null : String(hoveredAircraftId);

  switch (mode) {
    case "off":
      return false;
    case "all":
      return true;
    case "hovered-only":
      return normalizedHoveredId !== null && normalizedAircraftId === normalizedHoveredId;
    case "selected-and-hovered":
      return (
        (normalizedSelectedId !== null && normalizedAircraftId === normalizedSelectedId) ||
        (normalizedHoveredId !== null && normalizedAircraftId === normalizedHoveredId)
      );
    case "selected-only":
    default:
      return normalizedSelectedId !== null && normalizedAircraftId === normalizedSelectedId;
  }
}

function normalizeTrailMode(mode) {
  return TRAIL_MODE_VALUES.includes(mode) ? mode : "selected-only";
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
      selected: context.selectedAircraftId !== null && String(context.selectedAircraftId) === String(aircraftId),
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

function getTrailBounds(trailPoints) {
  if (!Array.isArray(trailPoints) || trailPoints.length === 0) {
    return null;
  }

  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;

  for (const point of trailPoints) {
    if (!isFiniteNumber(point.lat) || !isFiniteNumber(point.lon)) {
      continue;
    }

    minLat = Math.min(minLat, point.lat);
    minLon = Math.min(minLon, point.lon);
    maxLat = Math.max(maxLat, point.lat);
    maxLon = Math.max(maxLon, point.lon);
  }

  if (!Number.isFinite(minLat) || !Number.isFinite(minLon) || !Number.isFinite(maxLat) || !Number.isFinite(maxLon)) {
    return null;
  }

  return {
    maxLat,
    maxLon,
    minLat,
    minLon,
  };
}

export {
  collectRenderableTrails,
  createTrailStore,
  getTrailBounds,
  getTrailPoints,
  haversineDistanceMeters,
  normalizeTrailMode,
  pruneTrailStore,
  recordTrailSample,
  recordTrailSnapshot,
  recordTrailSnapshotFromState,
  updateTrailStoreFromState,
  shouldRenderTrailForAircraft,
};

const EARTH_RADIUS_M = 6371008.8;

const DEFAULT_INTERPOLATION_OPTIONS = {
  transitionDurationMs: 1600,
  maxTeleportDistanceNm: 20,
  staleAfterMs: 15000,
};

export const INTERPOLATION_MODE_VALUES = ["animate", "snap"];

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

function normalizeHeadingDegrees(value) {
  if (!isFiniteNumber(value)) {
    return null;
  }

  return ((value % 360) + 360) % 360;
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
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}

function haversineDistanceMeters(startLat, startLon, endLat, endLon) {
  const phi1 = toRadians(startLat);
  const phi2 = toRadians(endLat);
  const deltaPhi = toRadians(endLat - startLat);
  const deltaLambda = toRadians(endLon - startLon);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_M * c;
}

function distanceNm(start, end) {
  const distanceMeters = haversineDistanceMeters(start.lat, start.lon, end.lat, end.lon);
  return distanceMeters / 1852;
}

function isStaleAircraft(aircraft, frameTimeMs, staleAfterMs) {
  const updatedAtMs = toFiniteNumber(aircraft && aircraft.updatedAt);
  if (!isFiniteNumber(updatedAtMs) || !isFiniteNumber(frameTimeMs) || !isFiniteNumber(staleAfterMs)) {
    return false;
  }

  return frameTimeMs - updatedAtMs > staleAfterMs;
}

function isValidPositionRecord(aircraft) {
  return Boolean(
    aircraft &&
      aircraft.id !== undefined &&
      aircraft.id !== null &&
      isFiniteNumber(aircraft.lat) &&
      isFiniteNumber(aircraft.lon)
  );
}

function cloneAircraftRecord(aircraft) {
  return {
    ...aircraft,
    interpolation: aircraft.interpolation ? { ...aircraft.interpolation } : null,
  };
}

function indexAircraftById(aircraftList) {
  const byId = new Map();

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
    ...options,
  };

  return {
    currentById: new Map(),
    currentSampleAtMs: 0,
    generation: 0,
    lastFrameAtMs: 0,
    options: resolvedOptions,
    previousById: new Map(),
    previousSampleAtMs: 0,
    transitionDurationMs: resolvedOptions.transitionDurationMs,
    transitionEndAtMs: 0,
    transitionStartAtMs: 0,
  };
}

function commitAircraftSnapshot(state, aircraftList, sampleAtMs, options = {}) {
  const resolvedState = state || createInterpolationState(options);
  const resolvedOptions = {
    ...DEFAULT_INTERPOLATION_OPTIONS,
    ...(resolvedState.options || {}),
    ...options,
  };
  const nextSampleAtMs = isFiniteNumber(sampleAtMs) ? sampleAtMs : Date.now();

  resolvedState.previousById = resolvedState.currentById instanceof Map ? resolvedState.currentById : new Map();
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
      distanceNm: distanceNm(previous, current),
    };
    return interpolated;
  }

  interpolated.interpolation = {
    frameTimeMs,
    progress: 1,
    teleported: Boolean(teleported),
    interpolated: false,
    distanceNm: previous ? distanceNm(previous, current) : null,
  };

  return interpolated;
}

function sampleInterpolatedAircraft(state, frameTimeMs, options = {}) {
  const resolvedState = state || createInterpolationState(options);
  const resolvedOptions = {
    ...DEFAULT_INTERPOLATION_OPTIONS,
    ...(resolvedState.options || {}),
    ...options,
  };
  const frameAtMs = isFiniteNumber(frameTimeMs) ? frameTimeMs : Date.now();
  const currentById = resolvedState.currentById instanceof Map ? resolvedState.currentById : new Map();
  const previousById = resolvedState.previousById instanceof Map ? resolvedState.previousById : new Map();
  const transitionDurationMs = Math.max(0, resolvedState.transitionDurationMs || resolvedOptions.transitionDurationMs);
  const transitionStartAtMs = isFiniteNumber(resolvedState.transitionStartAtMs)
    ? resolvedState.transitionStartAtMs
    : frameAtMs;
  const transitionEndAtMs = isFiniteNumber(resolvedState.transitionEndAtMs)
    ? resolvedState.transitionEndAtMs
    : transitionStartAtMs + transitionDurationMs;
  const progress =
    transitionEndAtMs > transitionStartAtMs
      ? clamp((frameAtMs - transitionStartAtMs) / (transitionEndAtMs - transitionStartAtMs), 0, 1)
      : 1;

  const aircraft = [];
  const stats = {
    carriedForward: 0,
    dropped: 0,
    interpolated: 0,
    newAircraft: 0,
    stale: 0,
    teleported: 0,
    total: 0,
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
    stats,
  };
}

function interpolateAircraftSnapshots(previousAircraftList, currentAircraftList, frameTimeMs, options = {}) {
  const state = createInterpolationState(options);
  state.previousById = indexAircraftById(previousAircraftList);
  state.currentById = indexAircraftById(currentAircraftList);
  state.previousSampleAtMs = isFiniteNumber(options.previousSampleAtMs) ? options.previousSampleAtMs : 0;
  state.currentSampleAtMs = isFiniteNumber(options.currentSampleAtMs) ? options.currentSampleAtMs : 0;
  state.transitionStartAtMs = isFiniteNumber(options.transitionStartAtMs)
    ? options.transitionStartAtMs
    : state.currentSampleAtMs || (isFiniteNumber(frameTimeMs) ? frameTimeMs : Date.now());
  state.transitionDurationMs = Math.max(0, options.transitionDurationMs ?? state.transitionDurationMs);
  state.transitionEndAtMs = state.transitionStartAtMs + state.transitionDurationMs;

  return sampleInterpolatedAircraft(state, frameTimeMs, options);
}

function advanceInterpolationState(state, aircraftList, sampleAtMs, options = {}) {
  return commitAircraftSnapshot(state, aircraftList, sampleAtMs, options);
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

export {
  advanceInterpolationState,
  clamp,
  commitAircraftSnapshot,
  createInterpolationState,
  distanceNm,
  haversineDistanceMeters,
  indexAircraftById,
  interpolateAircraftSnapshots,
  lerp,
  lerpAngleDegrees,
  normalizeHeadingDegrees,
  sampleInterpolatedAircraft,
  updateInterpolationFromState,
};

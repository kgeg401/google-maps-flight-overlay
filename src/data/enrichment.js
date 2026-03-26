// Primary enrichment source: adsbdb for aircraft metadata, photo URLs, and flight routes.
// Optional fallback: adsb.lol for advisory route/photo gaps only.
// Source notes:
// - https://github.com/mrjackwills/adsbdb
// - https://github.com/adsblol/api

import {
  createAirportResolver,
  resolveAirportReference as resolveAirportReferenceFromFallback,
} from "./airportFallback.js";

export const ADSBDB_API_BASE_URL = "https://api.adsbdb.com/v0";
export const ADSBL_API_BASE_URL = "https://api.adsb.lol/v2";
export const SELECTED_AIRCRAFT_DETAILS_CACHE_VERSION = 1;
export const DEFAULT_SELECTED_AIRCRAFT_DETAILS_STORAGE_KEY =
  "gm-flight-overlay:selected-aircraft-details-cache:v1";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function cleanLookupKeyPart(value) {
  const text = cleanText(value);
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
      raw: value,
    };
  }

  if (!isObject(value)) {
    return null;
  }

  return {
    name: cleanText(value.name),
    municipality: cleanText(value.municipality),
    iataCode: cleanLookupKeyPart(value.iataCode || value.iata_code || value.iata),
    icaoCode: cleanLookupKeyPart(value.icaoCode || value.icao_code || value.icao),
    code: cleanLookupKeyPart(
      value.iataCode || value.iata_code || value.iata || value.icaoCode || value.icao_code || value.icao
    ),
    source: cleanText(value.source) || null,
    raw: value,
  };
}

function pickText(...values) {
  for (const value of values) {
    const text = cleanText(value);
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

export function buildAircraftDetailsLookup(aircraft, options = {}) {
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
    adsblolCandidates: buildAdsblolLookupCandidates({ identifier, callsign }, options),
  };
}

export function buildAdsbdbLookupUrl(identifier, callsign = null, options = {}) {
  const baseUrl = cleanText(options.baseUrl) || ADSBDB_API_BASE_URL;
  const encodedIdentifier = encodeURIComponent(identifier);
  const baseUrlPath = `${baseUrl}/aircraft/${encodedIdentifier}`;
  if (!callsign) {
    return baseUrlPath;
  }

  return `${baseUrlPath}?callsign=${encodeURIComponent(callsign)}`;
}

export function buildAdsblolLookupCandidates(lookup, options = {}) {
  const baseUrl = cleanText(options.baseUrl) || ADSBL_API_BASE_URL;
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

export function createEmptyAircraftDetails(lookupKey = null, now = Date.now) {
  return {
    lookupKey: cleanText(lookupKey),
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
      owner: null,
    },
    route: {
      airlineName: null,
      airlineIcao: null,
      airlineIata: null,
      airlineCallsign: null,
      origin: null,
      destination: null,
    },
  };
}

function normalizeAirportEndpoint(value, role, context = {}) {
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
      icaoCode: airport.icaoCode,
    },
    role
  ) || resolveAirportReferenceFromFallback(
    {
      name: airport.name,
      municipality: airport.municipality,
      iataCode: airport.iataCode,
      icaoCode: airport.icaoCode,
    },
    role
  );

  return {
    name: airport.name || (resolved && resolved.name) || null,
    municipality: airport.municipality || (resolved && resolved.municipality) || null,
    iataCode: airport.iataCode || (resolved && resolved.iataCode) || null,
    icaoCode: airport.icaoCode || (resolved && resolved.icaoCode) || null,
  };
}

function resolveRouteEndpoint(routeData, role, context = {}) {
  if (!routeData) {
    return null;
  }

  if (typeof routeData === "string") {
    return normalizeAirportEndpoint(routeData, role, context);
  }

  if (Array.isArray(routeData)) {
    const index = role === "origin" ? 0 : routeData.length - 1;
    return normalizeAirportEndpoint(routeData[index], role, context);
  }

  return normalizeAirportEndpoint(routeData, role, context);
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
    flightroute,
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
    route,
  };
}

function normalizePhotoValue(value) {
  const text = cleanText(value);
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
  const photoUrl = photoMode === "disabled"
    ? null
    : normalizePhotoValue(
        aircraftData.url_photo ||
        aircraftData.photo ||
        aircraftData.image ||
        aircraftData.url ||
        aircraftData.photo_url
      );
  const photoThumbnailUrl = photoMode === "disabled"
    ? null
    : normalizePhotoValue(
        aircraftData.url_photo_thumbnail ||
        aircraftData.photo_thumbnail ||
        aircraftData.thumbnail ||
        aircraftData.thumbnail_url
      );

  return {
    lookupKey: cleanText(lookup.lookupKey || context.lookupKey) || null,
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
      owner,
    },
    route: {
      airlineName,
      airlineIcao,
      airlineIata,
      airlineCallsign,
      origin,
      destination,
    },
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
  const photoUrl = photoMode === "disabled"
    ? null
    : normalizePhotoValue(
        routeData.photo ||
        routeData.image ||
        routeData.url_photo ||
        routeData.embed_image ||
        routeData.thumbnail
      );
  const photoThumbnailUrl = photoMode === "disabled"
    ? null
    : normalizePhotoValue(routeData.thumbnail || routeData.photo_thumbnail || routeData.url_photo_thumbnail);

  return {
    lookupKey: cleanText(lookup.lookupKey || context.lookupKey) || null,
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
      owner: pickText(routeData.owner, routeData.operator, routeData.registered_owner),
    },
    route: {
      airlineName,
      airlineIcao,
      airlineIata,
      airlineCallsign,
      origin,
      destination,
    },
  };
}

export function shouldUseAdsblolFallback(details, context = {}) {
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

export function mergeAircraftDetails(primary, fallback, context = {}) {
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
  base.source = base.source === "adsbdb" && extra.source === "adsblol"
    ? "adsbdb+adsblol"
    : base.source || extra.source || "unknown";
  base.fetchedAt = Math.max(base.fetchedAt || 0, extra.fetchedAt || 0);

  if (extra.notes && Array.isArray(extra.notes)) {
    for (const note of extra.notes) {
      const text = cleanText(note);
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
    owner: base.owner || null,
  };
  base.route = {
    airlineName: base.airlineName || null,
    airlineIcao: base.airlineIcao || null,
    airlineIata: base.airlineIata || null,
    airlineCallsign: base.airlineCallsign || null,
    origin: base.origin || null,
    destination: base.destination || null,
  };

  return base;
}

export function prunePhotoDetails(details, photoMode = "enabled") {
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
    photoMode: "disabled",
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

export function createGMValueStorage(prefix = "gm-flight-overlay") {
  const getFn = typeof GM_getValue === "function" ? GM_getValue : null;
  const setFn = typeof GM_setValue === "function" ? GM_setValue : null;
  const deleteFn = typeof GM_deleteValue === "function" ? GM_deleteValue : null;

  return {
    getValue(key, fallback = null) {
      if (!getFn) {
        return fallback;
      }
      return getFn(`${prefix}:${key}`, fallback);
    },
    setValue(key, value) {
      if (setFn) {
        setFn(`${prefix}:${key}`, value);
      }
    },
    removeValue(key) {
      if (deleteFn) {
        deleteFn(`${prefix}:${key}`);
      }
    },
  };
}

export function createSelectedAircraftDetailsCache(options = {}) {
  const storage = options.storage || null;
  const storageKey = cleanText(options.storageKey) || DEFAULT_SELECTED_AIRCRAFT_DETAILS_STORAGE_KEY;
  const now = typeof options.now === "function" ? options.now : Date.now;
  const memoryTtlMs = Number.isFinite(options.memoryTtlMs) ? options.memoryTtlMs : 5 * 60 * 1000;
  const sessionTtlMs = Number.isFinite(options.sessionTtlMs) ? options.sessionTtlMs : 24 * 60 * 60 * 1000;
  const maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : 32;
  const memory = new Map();
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
      if (oldestKey === undefined) {
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
        sessionExpiresAt: Math.max(sessionExpiresAt, nowAt + sessionTtlMs),
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
        value: cloneDetails(entry.value),
      })),
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
    set(key, value, options = {}) {
      hydrate();
      const persistValue = options.persist !== false;
      const nowAt = nowMsFrom(now);
      memory.set(key, {
        value: cloneDetails(value),
        expiresAt: nowAt + memoryTtlMs,
        sessionExpiresAt: nowAt + sessionTtlMs,
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
        hydrated,
      };
    },
  };
}

async function tryRequestJson(requestJson, url) {
  return requestJson(url);
}

async function loadFallbackPayload(requestJson, lookup, context = {}) {
  const explicitUrls = Array.isArray(context.adsblolLookupUrls) ? context.adsblolLookupUrls : null;
  const urls = explicitUrls && explicitUrls.length > 0
    ? explicitUrls
    : buildAdsblolLookupCandidates(lookup, context);

  let lastError = null;
  for (const url of urls) {
    try {
      return await tryRequestJson(requestJson, url);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("ADSb.lol fallback lookup failed");
}

export function createEnrichmentService(context = {}) {
  const requestJson = typeof context.requestJson === "function" ? context.requestJson : null;
  const airportResolver = context.airportResolver || createAirportResolver();
  const photoMode = context.photoMode === "disabled" ? "disabled" : "enabled";
  const cache = createSelectedAircraftDetailsCache({
    storage: context.storage || null,
    storageKey: context.storageKey,
    now: context.now,
    memoryTtlMs: context.memoryTtlMs,
    sessionTtlMs: context.sessionTtlMs,
    maxEntries: context.maxEntries,
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
        airportResolver,
      }),
      photoMode
    );
  }

  function normalizeAdsblolPayload(payload, aircraft = null) {
    return prunePhotoDetails(
      normalizeAdsblolDetailsPayload(payload, aircraft, {
        ...context,
        photoMode,
        airportResolver,
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

    if (!requestJson) {
      const empty = createEmptyAircraftDetails(lookup.lookupKey, context.now);
      empty.photoMode = photoMode;
      empty.notes = ["No requestJson() handler was provided for enrichment."];
      return empty;
    }

    emit("trace", "Selected aircraft details cache miss", {
      lookupKey: lookup.lookupKey,
      adsbdbUrl: lookup.adsbdbUrl,
    });

    const primaryPayload = await requestJson(lookup.adsbdbUrl);
    let details = normalizeAdsbdbPayload(primaryPayload, aircraft);

    if (shouldUseAdsblolFallback(details, { photoMode })) {
      try {
        const fallbackPayload = await loadFallbackPayload(requestJson, lookup, {
          ...context,
          photoMode,
        });
        const fallbackDetails = normalizeAdsblolPayload(fallbackPayload, aircraft);
        details = mergeAircraftDetails(details, fallbackDetails, { photoMode, now: context.now });
        emit("trace", "Applied ADSB.lol advisory fallback", {
          lookupKey: lookup.lookupKey,
          hasPhoto: Boolean(details.photoUrl || details.photoThumbnailUrl),
          hasRoute: Boolean(details.origin || details.destination),
        });
      } catch (error) {
        emit("warn", "ADSB.lol fallback lookup failed", {
          lookupKey: lookup.lookupKey,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const finalDetails = prunePhotoDetails({
      ...details,
      lookupKey: lookup.lookupKey,
      fetchedAt: nowMsFrom(context.now),
      photoMode,
    }, photoMode);

    cache.set(lookup.lookupKey, finalDetails, {
      persist: context.persistSelectedDetails !== false,
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
        cache: cache.snapshot(),
      };
    },
  };
}

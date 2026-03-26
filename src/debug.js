const DEBUG_LEVELS = Object.freeze({
  OFF: "off",
  BASIC: "basic",
  TRACE: "trace",
});

const DEFAULT_LOG_BUFFER_SIZE = 500;
const DEFAULT_REPLAY_BUFFER_SIZE = 50;

function clampNumber(value, min, max) {
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
  if (value === null || value === undefined) {
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
      stack: value.stack || null,
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
        serializeDebugValue(entryValue, depth + 1),
      ]),
    };
  }
  if (value instanceof Set) {
    return {
      type: "Set",
      values: Array.from(value.values()).slice(0, 32).map((item) => serializeDebugValue(item, depth + 1)),
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

function safeJsonParse(text, fallback = null) {
  if (typeof text !== "string") {
    return fallback;
  }
  try {
    return JSON.parse(text);
  } catch (_error) {
    return fallback;
  }
}

function formatNumber(value, digits = 0) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return digits > 0 ? value.toFixed(digits) : `${Math.round(value)}`;
}

function formatCompactDuration(ms) {
  const totalMs = Math.max(0, Math.floor(Number(ms) || 0));
  const totalSeconds = Math.ceil(totalMs / 1000);
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
    remainingSeconds: Math.ceil(remainingMs / 1000),
    label: active ? `Backoff ${formatCompactDuration(remainingMs)} remaining` : "No backoff",
    severity: active ? "warn" : "ok",
  });
}

function deriveDensityStats(input = {}) {
  const visibleAircraftCount = clampNumber(input.visibleAircraftCount ?? input.aircraftCount, 0, Number.MAX_SAFE_INTEGER);
  const drawnAircraftCount = clampNumber(input.drawnAircraftCount, 0, Number.MAX_SAFE_INTEGER);
  const groupedCount = clampNumber(input.groupedCount ?? input.clusterCount, 0, Number.MAX_SAFE_INTEGER);
  const overlappedCount = clampNumber(input.overlappedCount, 0, Number.MAX_SAFE_INTEGER);
  const spiderfiedCount = clampNumber(input.spiderfiedCount, 0, Number.MAX_SAFE_INTEGER);
  const trailCount = clampNumber(input.trailCount, 0, Number.MAX_SAFE_INTEGER);

  return Object.freeze({
    mode: String(input.mode || "normal"),
    visibleAircraftCount,
    drawnAircraftCount,
    groupedCount,
    overlappedCount,
    spiderfiedCount,
    trailCount,
    densityLabel: `${visibleAircraftCount} visible, ${drawnAircraftCount} drawn`,
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
    subtitle: subtitleParts.join(" • "),
    callsign: callsign || null,
    registration: registration || null,
    type: type || null,
    operator: operator || null,
    origin,
    destination,
    hasPhoto: Boolean(enriched.photoUrl || enriched.photoThumbnailUrl),
    hasRoute: Boolean(origin || destination),
    isStale: Boolean(aircraft.isStale || enriched.isStale),
  });
}

function normalizeAirportEndpoint(value) {
  if (value === null || value === undefined) {
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
    label: `${source}:${status}`,
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
    scanAgeMs: Number.isFinite(Number(input.lastScanAt)) ? Math.max(0, Date.now() - Number(input.lastScanAt)) : null,
  });
}

function deriveLastFetchSummary(input = {}) {
  const startedAt = Number(input.startedAt || input.lastFetchStartedAt || 0);
  const completedAt = Number(input.completedAt || input.lastFetchCompletedAt || 0);
  const durationMs = Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt >= startedAt
    ? completedAt - startedAt
    : null;

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
    backoffUntil: Number.isFinite(Number(input.backoffUntil || input.rateLimitBackoffUntil))
      ? Number(input.backoffUntil || input.rateLimitBackoffUntil)
      : null,
  });
}

function deriveReplayState(input = {}, snapshots = []) {
  const replaySnapshots = Array.isArray(snapshots) ? snapshots : [];
  const currentIndex = Number.isFinite(Number(input.currentIndex)) ? Number(input.currentIndex) : -1;
  const currentSnapshot = currentIndex >= 0 && currentIndex < replaySnapshots.length ? replaySnapshots[currentIndex] : null;

  return Object.freeze({
    mode: String(input.mode || "inactive"),
    active: Boolean(input.active ?? (replaySnapshots.length > 0)),
    imported: Boolean(input.imported),
    exported: Boolean(input.exported),
    cursor: currentIndex,
    totalSnapshots: replaySnapshots.length,
    currentSnapshotId: currentSnapshot ? currentSnapshot.id || null : null,
    currentSnapshotLabel: currentSnapshot ? currentSnapshot.label || null : null,
    lastCapturedAt: replaySnapshots.length > 0 ? replaySnapshots[replaySnapshots.length - 1].capturedAt || null : null,
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
      replaySnapshots: Array.isArray(context.replaySnapshots) ? context.replaySnapshots.length : 0,
    }),
  });
}

function buildDebugExport(context = {}) {
  const replaySnapshots = Array.isArray(context.replaySnapshots) ? context.replaySnapshots : [];
  const summary = summarizeDebugContext({
    ...context,
    replaySnapshots,
  });

  return Object.freeze({
    generatedAt: new Date((context.nowMs || Date.now())).toISOString(),
    version: String(context.version || context.debugVersion || "unknown"),
    level: normalizeDebugLevel(context.level),
    settings: serializeDebugValue(context.settings || {}, 0),
    status: {
      level: String(context.statusLevel || context.status?.level || "unknown"),
      text: String(context.statusText || context.status?.text || ""),
    },
    lastFetchSummary: deriveLastFetchSummary(context.lastFetch || context.fetch || context),
    selection: deriveSelectedAircraftSummary(context.selectedAircraft || context.aircraft || null, context.selectedAircraftDetails || context.details || null),
    densitySummary: deriveDensityStats(context.density || context),
    enrichmentStatus: deriveEnrichmentStatus(context.enrichment || context),
    viewportDiagnostics: deriveViewportBindingDiagnostics(context.viewport || context),
    replayState: deriveReplayState(context.replay || context, replaySnapshots),
    summary,
    logs: Array.isArray(context.logs) ? context.logs.map((entry) => ({ ...entry })) : [],
    replaySnapshots: replaySnapshots.map((snapshot) => ({ ...snapshot })),
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

function formatDebugLogEntry(entry) {
  const lines = [`[${entry.ts}] ${String(entry.level || "info").toUpperCase()} ${entry.message}`];
  if (entry.details !== null && entry.details !== undefined) {
    try {
      lines.push(JSON.stringify(entry.details, null, 2));
    } catch (_error) {
      lines.push(String(entry.details));
    }
  }
  return lines.join("\n");
}

function serializeDebugDump(dump) {
  return JSON.stringify(dump, null, 2);
}

function parseReplayInput(input) {
  if (Array.isArray(input)) {
    return input;
  }
  if (typeof input === "string") {
    const parsed = safeJsonParse(input, null);
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
      currentIndex: Number.isFinite(Number(meta.currentIndex)) ? Number(meta.currentIndex) : 0,
    },
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
    aircraftCount: Number.isFinite(Number(snapshot.aircraftCount)) ? Number(snapshot.aircraftCount) : (Array.isArray(snapshot.aircraft) ? snapshot.aircraft.length : 0),
    viewport: snapshot.viewport ? serializeDebugValue(snapshot.viewport, 0) : null,
    mapState: snapshot.mapState ? serializeDebugValue(snapshot.mapState, 0) : null,
    selectedAircraft: snapshot.selectedAircraft ? serializeDebugValue(snapshot.selectedAircraft, 0) : null,
    enrichment: snapshot.enrichment ? serializeDebugValue(snapshot.enrichment, 0) : null,
    density: snapshot.density ? serializeDebugValue(snapshot.density, 0) : null,
    payload: snapshot.payload !== undefined ? serializeDebugValue(snapshot.payload, 0) : serializeDebugValue(snapshot, 0),
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
    capturedAt: nowMs,
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
        currentSnapshotId: snapshots[index] ? snapshots[index].id || null : null,
      };
    },
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
      ts: new Date((meta.nowMs || Date.now())).toISOString(),
      level: normalizeLogLevel(levelName),
      message: String(message || ""),
      category: meta.category || null,
      details: details === undefined ? null : serializeDebugValue(details, 0),
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
      replaySnapshots,
    });

    return Object.freeze({
      generatedAt: new Date((context.nowMs || Date.now())).toISOString(),
      level: currentLevel,
      summary,
      logs: logs.map((entry) => ({ ...entry })),
      replaySnapshots: replaySnapshots.map((snapshot) => ({ ...snapshot })),
      context: serializeDebugValue(context, 0),
    });
  }

  function buildSummary(context = {}) {
    return summarizeDebugContext({
      ...context,
      level: currentLevel,
      logs,
      replaySnapshots,
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
        generatedAt: new Date().toISOString(),
        level: currentLevel,
        snapshots: replaySnapshots.slice(),
      });
    },
    buildExport,
    buildSummary,
    buildSummaryText(context = {}) {
      return formatDebugSummary(buildSummary(context));
    },
  });
}

function createDebugService(context = {}) {
  const store = createDebugStore({
    level: context.level ?? context.debugLevel,
    logBufferSize: context.logBufferSize,
    replayBufferSize: context.replayBufferSize,
    onLog: context.onLog,
  });
  let runtimeContext = { ...context };

  function mergeContext(nextContext = {}) {
    runtimeContext = {
      ...runtimeContext,
      ...nextContext,
    };
    return runtimeContext;
  }

  function buildContext(overrides = {}) {
    return {
      ...runtimeContext,
      ...overrides,
      level: store.getLevel(),
      logs: store.logs,
      replaySnapshots: store.replaySnapshots,
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
          ...(runtimeContext.replay || {}),
          ...parsed.replayState,
        },
      });
      return parsed;
    },
    exportReplayPayload() {
      return {
        generatedAt: new Date().toISOString(),
        replayState: deriveReplayState(runtimeContext.replay || {}, store.replaySnapshots),
        snapshots: store.replaySnapshots,
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
    },
  });
}

export {
  DEBUG_LEVELS,
  buildDebugExport,
  captureReplaySnapshot,
  createDebugService,
  createDebugStore,
  createReplayPlayback,
  deriveBackoffCountdown,
  deriveDensityStats,
  deriveLastFetchSummary,
  deriveEnrichmentStatus,
  deriveSelectedAircraftSummary,
  deriveReplayState,
  deriveViewportBindingDiagnostics,
  formatDebugLogEntry,
  formatDebugSummary,
  normalizeDebugLevel,
  normalizeReplaySnapshot,
  parseReplayInput,
  parseReplayPayload,
  serializeDebugDump,
  serializeDebugValue,
  summarizeDebugContext,
};

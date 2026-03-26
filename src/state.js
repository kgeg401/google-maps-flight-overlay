import { DEFAULT_SETTINGS } from "./config.js";

/**
 * @typedef {Object} AircraftSnapshot
 * @property {string} id
 * @property {number} lat
 * @property {number} lon
 * @property {number|null} heading
 * @property {number|null} altitudeFt
 * @property {string|null} callsign
 * @property {string|null} registration
 * @property {string|null} aircraftType
 * @property {number|null} speedKt
 * @property {string} source
 * @property {number} updatedAt
 * @property {boolean} onGround
 */

/**
 * @typedef {Object} InterpolatedAircraft
 * @property {AircraftSnapshot} aircraft
 * @property {number} x
 * @property {number} y
 * @property {number} heading
 * @property {number} progress
 * @property {boolean} isInterpolated
 */

/**
 * @typedef {Object} SelectedAircraftDetails
 * @property {string|null} registration
 * @property {string|null} manufacturer
 * @property {string|null} type
 * @property {string|null} icaoType
 * @property {string|null} owner
 * @property {string|null} airlineName
 * @property {string|null} photoUrl
 * @property {string|null} photoThumbnailUrl
 * @property {{name: string|null, municipality: string|null, iataCode: string|null, icaoCode: string|null}|null} origin
 * @property {{name: string|null, municipality: string|null, iataCode: string|null, icaoCode: string|null}|null} destination
 * @property {string|null} source
 * @property {boolean} routeAdvisory
 * @property {string|null} lookupKey
 * @property {number|null} fetchedAt
 */

/**
 * @typedef {Object} DensityGroup
 * @property {string} key
 * @property {"single"|"overlap"|"cluster"} kind
 * @property {number} x
 * @property {number} y
 * @property {Array<InterpolatedAircraft>} members
 * @property {boolean} isExpanded
 */

/**
 * @typedef {Object} DebugEvent
 * @property {string} ts
 * @property {"debug"|"info"|"warn"|"error"} level
 * @property {string} message
 * @property {unknown} details
 */

export function createState(window, settings = DEFAULT_SETTINGS) {
  return {
    aircraft: [],
    aircraftById: new Map(),
    previousAircraftById: new Map(),
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
    lastLocationHref: window.location.href,
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
    renderedAircraftByMarkerId: new Map(),
    replayFrameIndex: 0,
    replayFrames: [],
    replayMode: false,
    replayName: "",
    replayPanelEl: null,
    replayPanelOpen: Boolean(settings.replayPanelOpen),
    selectedAircraftDetails: null,
    selectedAircraftDetailsCache: new Map(),
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
    trailsById: new Map(),
    viewportEl: null,
    viewportRect: null,
  };
}

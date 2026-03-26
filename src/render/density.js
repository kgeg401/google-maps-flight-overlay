// Density grouping and spiderfy math for the canvas overlay.
// This is an original rewrite inspired by the interaction patterns used by
// OverlappingMarkerSpiderfier and markercluster-style clustering, but adapted
// to projected canvas coordinates instead of Google Maps API marker objects.

const TAU = Math.PI * 2;

export const DENSITY_MODES = Object.freeze({
  NORMAL: "normal",
  SPIDERFY: "spiderfy",
  DECLUTTER: "declutter",
});

export const DEFAULT_DENSITY_OPTIONS = Object.freeze({
  mode: "auto",
  overlapRadiusPx: 14,
  overlapCountThreshold: 2,
  declutterZoomThreshold: 8,
  declutterMarkerCountThreshold: 40,
  declutterDensityThreshold: 48,
  declutterRadiusMultiplier: 2.2,
  declutterMinRadiusPx: 18,
  clusterHitPaddingPx: 8,
  spiderfyCircleRadiusPx: 36,
  spiderfyCircleMaxItems: 8,
  spiderfySpiralStepPx: 7,
  spiderfySpiralAngleStep: Math.PI * (3 - Math.sqrt(5)),
  spiderfyHitPaddingPx: 10,
});

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function toFiniteNumber(value, fallback = null) {
  return isFiniteNumber(value) ? value : fallback;
}

function pickString(value, fallback) {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }
  return fallback;
}

function readPoint(source) {
  if (!source || typeof source !== "object") {
    return null;
  }

  const directX = toFiniteNumber(source.x);
  const directY = toFiniteNumber(source.y);
  if (directX !== null && directY !== null) {
    return { x: directX, y: directY };
  }

  const fallbackPairs = [
    [source.baseX, source.baseY],
    [source.point && source.point.x, source.point && source.point.y],
    [source.position && source.position.x, source.position && source.position.y],
    [source.center && source.center.x, source.center && source.center.y],
  ];

  for (const [xValue, yValue] of fallbackPairs) {
    const x = toFiniteNumber(xValue);
    const y = toFiniteNumber(yValue);
    if (x !== null && y !== null) {
      return { x, y };
    }
  }

  return null;
}

function roundCoord(value) {
  return Math.round(value * 1000) / 1000;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function pointDistanceSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function makeBounds() {
  return {
    left: Infinity,
    top: Infinity,
    right: -Infinity,
    bottom: -Infinity,
  };
}

function updateBounds(bounds, point) {
  bounds.left = Math.min(bounds.left, point.x);
  bounds.top = Math.min(bounds.top, point.y);
  bounds.right = Math.max(bounds.right, point.x);
  bounds.bottom = Math.max(bounds.bottom, point.y);
}

function finalizeBounds(bounds) {
  if (!Number.isFinite(bounds.left)) {
    return {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
    };
  }

  return {
    left: bounds.left,
    top: bounds.top,
    right: bounds.right,
    bottom: bounds.bottom,
    width: bounds.right - bounds.left,
    height: bounds.bottom - bounds.top,
  };
}

function averagePoint(markers) {
  if (markers.length === 0) {
    return { x: 0, y: 0 };
  }

  let sumX = 0;
  let sumY = 0;

  for (const marker of markers) {
    sumX += marker.x;
    sumY += marker.y;
  }

  return {
    x: sumX / markers.length,
    y: sumY / markers.length,
  };
}

function resolveOptions(options = {}) {
  return {
    ...DEFAULT_DENSITY_OPTIONS,
    ...options,
  };
}

function attachHiddenProperty(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

export function normalizeProjectedMarker(marker, index = 0) {
  const point = readPoint(marker);
  if (!point) {
    return null;
  }

  const aircraft = marker && typeof marker.aircraft === "object" ? marker.aircraft : null;
  const summary = {
    id: pickString(marker.id, `marker-${index}`),
    aircraftId: pickString(
      aircraft && (aircraft.id || aircraft.hex || aircraft.registration),
      pickString(marker.aircraftId, pickString(marker.aircraftHex, pickString(marker.callsign, `marker-${index}`)))
    ),
    x: point.x,
    y: point.y,
    baseX: toFiniteNumber(marker.baseX, point.x) ?? point.x,
    baseY: toFiniteNumber(marker.baseY, point.y) ?? point.y,
    heading: isFiniteNumber(marker.heading) ? marker.heading : null,
    isSelected: Boolean(marker.isSelected),
    isHovered: Boolean(marker.isHovered),
    weight: Math.max(1, toFiniteNumber(marker.weight, 1) ?? 1),
    index,
  };

  const callsign = aircraft && pickString(aircraft.callsign || aircraft.flight, null);
  const registration = aircraft && pickString(aircraft.registration, null);
  const type = aircraft && pickString(aircraft.type, null);

  if (callsign !== null) {
    summary.callsign = callsign;
  }
  if (registration !== null) {
    summary.registration = registration;
  }
  if (type !== null) {
    summary.type = type;
  }

  attachHiddenProperty(summary, "source", marker);
  if (aircraft) {
    attachHiddenProperty(summary, "aircraft", aircraft);
  }

  return summary;
}

export function normalizeProjectedMarkers(markers) {
  const list = Array.isArray(markers) ? markers : [];
  const normalized = [];

  for (let index = 0; index < list.length; index += 1) {
    const marker = normalizeProjectedMarker(list[index], index);
    if (marker) {
      normalized.push(marker);
    }
  }

  return normalized;
}

export function decideDensityMode(input = {}) {
  const options = resolveOptions(input);
  const zoom = toFiniteNumber(input.zoom, 0) ?? 0;
  const markerCount = Math.max(0, Math.trunc(toFiniteNumber(input.markerCount, 0) ?? 0));
  const viewportWidth = Math.max(0, toFiniteNumber(input.viewportWidth, 0) ?? 0);
  const viewportHeight = Math.max(0, toFiniteNumber(input.viewportHeight, 0) ?? 0);
  const areaMp = Math.max(1, (viewportWidth * viewportHeight) / 1_000_000);
  const density = markerCount / areaMp;

  if (options.mode && options.mode !== "auto") {
    return {
      densityMode: options.mode,
      mode: options.mode,
      reason: "forced",
      markerCount,
      density,
    };
  }

  if (markerCount <= 1) {
    return {
      densityMode: DENSITY_MODES.NORMAL,
      mode: DENSITY_MODES.NORMAL,
      reason: "sparse",
      markerCount,
      density,
    };
  }

  if (
    zoom <= options.declutterZoomThreshold ||
    markerCount >= options.declutterMarkerCountThreshold ||
    density >= options.declutterDensityThreshold
  ) {
    return {
      densityMode: DENSITY_MODES.DECLUTTER,
      mode: DENSITY_MODES.DECLUTTER,
      reason: zoom <= options.declutterZoomThreshold ? "low-zoom" : "dense",
      markerCount,
      density,
    };
  }

  if (markerCount >= options.overlapCountThreshold) {
    return {
      densityMode: DENSITY_MODES.SPIDERFY,
      mode: DENSITY_MODES.SPIDERFY,
      reason: "dense-enough",
      markerCount,
      density,
    };
  }

  return {
    densityMode: DENSITY_MODES.NORMAL,
    mode: DENSITY_MODES.NORMAL,
    reason: "sparse",
    markerCount,
    density,
  };
}

function buildSpatialHash(markers, cellSizePx) {
  const cells = new Map();

  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const cellX = Math.floor(marker.x / cellSizePx);
    const cellY = Math.floor(marker.y / cellSizePx);
    const key = `${cellX}:${cellY}`;

    if (!cells.has(key)) {
      cells.set(key, []);
    }
    cells.get(key).push(index);
  }

  return cells;
}

function collectComponent(markers, startIndex, radiusPx, cellSizePx, cells, visited) {
  const component = [];
  const queue = [startIndex];
  const radiusSq = radiusPx * radiusPx;

  while (queue.length > 0) {
    const currentIndex = queue.pop();
    if (visited.has(currentIndex)) {
      continue;
    }

    visited.add(currentIndex);
    const current = markers[currentIndex];
    component.push(current);

    const cellX = Math.floor(current.x / cellSizePx);
    const cellY = Math.floor(current.y / cellSizePx);

    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const key = `${cellX + offsetX}:${cellY + offsetY}`;
        const candidates = cells.get(key);
        if (!candidates) {
          continue;
        }

        for (const candidateIndex of candidates) {
          if (visited.has(candidateIndex)) {
            continue;
          }
          const candidate = markers[candidateIndex];
          if (pointDistanceSq(current, candidate) <= radiusSq) {
            queue.push(candidateIndex);
          }
        }
      }
    }
  }

  return component;
}

function groupId(mode, markers, center) {
  const sample = markers
    .slice(0, 4)
    .map((marker) => marker.id)
    .join(",");
  const payload = `${mode}:${markers.length}:${roundCoord(center.x)}:${roundCoord(center.y)}:${sample}`;
  return `${mode}:${hashString(payload)}`;
}

function summarizeGroupMembers(markers) {
  return markers.map((marker) => ({
    id: marker.id,
    aircraftId: marker.aircraftId,
    x: marker.x,
    y: marker.y,
    baseX: marker.baseX,
    baseY: marker.baseY,
    heading: marker.heading,
    isSelected: marker.isSelected,
    isHovered: marker.isHovered,
    weight: marker.weight,
    index: marker.index,
    callsign: marker.callsign ?? null,
    registration: marker.registration ?? null,
    type: marker.type ?? null,
  }));
}

function createSingleGroup(marker) {
  return {
    id: `marker:${marker.id}`,
    kind: "marker",
    mode: DENSITY_MODES.NORMAL,
    markerCount: 1,
    members: summarizeGroupMembers([marker]),
    center: { x: marker.x, y: marker.y },
    bounds: {
      left: marker.x,
      top: marker.y,
      right: marker.x,
      bottom: marker.y,
      width: 0,
      height: 0,
    },
    radiusPx: 0,
    hitRadiusPx: 0,
    label: null,
    weight: marker.weight,
    selectedCount: marker.isSelected ? 1 : 0,
    hoveredCount: marker.isHovered ? 1 : 0,
    memberIds: [marker.id],
  };
}

function createClusterGroup(mode, markers, radiusPx, hitPaddingPx) {
  const center = averagePoint(markers);
  const bounds = makeBounds();
  let totalWeight = 0;
  const selectedIds = [];
  const hoveredIds = [];

  for (const marker of markers) {
    updateBounds(bounds, marker);
    totalWeight += marker.weight;
    if (marker.isSelected) {
      selectedIds.push(marker.id);
    }
    if (marker.isHovered) {
      hoveredIds.push(marker.id);
    }
  }

  const maxDistance = markers.reduce((accumulator, marker) => {
    const dx = marker.x - center.x;
    const dy = marker.y - center.y;
    return Math.max(accumulator, Math.sqrt(dx * dx + dy * dy));
  }, 0);

  const clusterRadiusPx = Math.max(radiusPx, maxDistance);

  return {
    id: groupId(mode, markers, center),
    kind: "cluster",
    mode,
    markerCount: markers.length,
    members: summarizeGroupMembers(markers),
    center,
    bounds: finalizeBounds(bounds),
    radiusPx: clusterRadiusPx,
    hitRadiusPx: clusterRadiusPx + hitPaddingPx,
    label: String(markers.length),
    weight: totalWeight,
    selectedCount: selectedIds.length,
    hoveredCount: hoveredIds.length,
    memberIds: markers.map((marker) => marker.id),
    selectedMarkerIds: selectedIds,
    hoveredMarkerIds: hoveredIds,
    densityScore: markers.length / Math.max(1, finalizeBounds(bounds).width * finalizeBounds(bounds).height),
  };
}

function clusterByRadius(markers, radiusPx, mode, hitPaddingPx) {
  const cellSizePx = Math.max(1, radiusPx);
  const cells = buildSpatialHash(markers, cellSizePx);
  const visited = new Set();
  const groups = [];

  for (let index = 0; index < markers.length; index += 1) {
    if (visited.has(index)) {
      continue;
    }

    const component = collectComponent(markers, index, radiusPx, cellSizePx, cells, visited);
    if (component.length <= 1) {
      groups.push(createSingleGroup(component[0]));
      continue;
    }

    groups.push(createClusterGroup(mode, component, radiusPx, hitPaddingPx));
  }

  return groups;
}

function maybeExpandSelectedGroup(group, options) {
  const expandGroupId = options.spiderfyGroupId ?? options.expandedGroupId ?? null;
  if (!expandGroupId || group.id !== expandGroupId || group.markerCount <= 1) {
    return group;
  }

  return {
    ...group,
    expanded: expandSpiderfyGroup(group, options),
  };
}

/**
 * Build a serializable density scene for the current marker set.
 */
export function buildDensityScene(markers, options = {}) {
  const normalizedMarkers = normalizeProjectedMarkers(markers);
  const decision = decideDensityMode({
    zoom: options.zoom,
    markerCount: normalizedMarkers.length,
    viewportWidth: options.viewportWidth,
    viewportHeight: options.viewportHeight,
    ...options,
  });

  if (normalizedMarkers.length === 0) {
    return {
      densityMode: DENSITY_MODES.NORMAL,
      mode: DENSITY_MODES.NORMAL,
      reason: decision.reason,
      markerCount: 0,
      density: 0,
      viewport: {
        width: Math.max(0, toFiniteNumber(options.viewportWidth, 0) ?? 0),
        height: Math.max(0, toFiniteNumber(options.viewportHeight, 0) ?? 0),
        zoom: toFiniteNumber(options.zoom, null),
      },
      options: {
        overlapRadiusPx: DEFAULT_DENSITY_OPTIONS.overlapRadiusPx,
      },
      groups: [],
      stats: {
        groupCount: 0,
        clusterCount: 0,
        markerCount: 0,
        selectedCount: 0,
        hoveredCount: 0,
      },
    };
  }

  let groups;
  let radiusPx = 0;
  let hitPaddingPx = toFiniteNumber(options.clusterHitPaddingPx, DEFAULT_DENSITY_OPTIONS.clusterHitPaddingPx) ?? DEFAULT_DENSITY_OPTIONS.clusterHitPaddingPx;

  if (decision.mode === DENSITY_MODES.NORMAL) {
    groups = normalizedMarkers.map((marker) => createSingleGroup(marker));
  } else {
    radiusPx = decision.mode === DENSITY_MODES.DECLUTTER
      ? Math.max(
          toFiniteNumber(options.declutterMinRadiusPx, DEFAULT_DENSITY_OPTIONS.declutterMinRadiusPx) ?? DEFAULT_DENSITY_OPTIONS.declutterMinRadiusPx,
          (toFiniteNumber(options.overlapRadiusPx, DEFAULT_DENSITY_OPTIONS.overlapRadiusPx) ?? DEFAULT_DENSITY_OPTIONS.overlapRadiusPx) *
            (toFiniteNumber(options.declutterRadiusMultiplier, DEFAULT_DENSITY_OPTIONS.declutterRadiusMultiplier) ?? DEFAULT_DENSITY_OPTIONS.declutterRadiusMultiplier)
        )
      : (toFiniteNumber(options.overlapRadiusPx, DEFAULT_DENSITY_OPTIONS.overlapRadiusPx) ?? DEFAULT_DENSITY_OPTIONS.overlapRadiusPx);
    groups = clusterByRadius(normalizedMarkers, radiusPx, decision.mode, hitPaddingPx);
  }

  groups = groups.map((group) => maybeExpandSelectedGroup(group, options));

  const selectedCount = normalizedMarkers.filter((marker) => marker.isSelected).length;
  const hoveredCount = normalizedMarkers.filter((marker) => marker.isHovered).length;
  const clusterCount = groups.filter((group) => group.kind === "cluster").length;

  return {
    densityMode: decision.mode,
    mode: decision.mode,
    reason: decision.reason,
    markerCount: normalizedMarkers.length,
    density: decision.density,
    viewport: {
      width: Math.max(0, toFiniteNumber(options.viewportWidth, 0) ?? 0),
      height: Math.max(0, toFiniteNumber(options.viewportHeight, 0) ?? 0),
      zoom: toFiniteNumber(options.zoom, null),
    },
    options: {
      overlapRadiusPx: radiusPx || DEFAULT_DENSITY_OPTIONS.overlapRadiusPx,
      spiderfyGroupId: options.spiderfyGroupId ?? null,
      expandedGroupId: options.expandedGroupId ?? null,
    },
    groups,
    stats: {
      groupCount: groups.length,
      clusterCount,
      markerCount: normalizedMarkers.length,
      selectedCount,
      hoveredCount,
    },
  };
}

export function groupProjectedMarkers(markers, options = {}) {
  return buildDensityScene(markers, options);
}

function orderSpiderfyMembers(members) {
  return members.slice().sort((a, b) => {
    const aScore = (a.isSelected ? 0 : 2) + (a.isHovered ? 0 : 1);
    const bScore = (b.isSelected ? 0 : 2) + (b.isHovered ? 0 : 1);
    if (aScore !== bScore) {
      return aScore - bScore;
    }
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * Expand a cluster into a spiderfied scene suitable for canvas rendering.
 * Circle layout is used for small groups; a spiral is used when the group is
 * larger so the result remains readable without needing DOM-specific logic.
 */
export function expandSpiderfyGroup(group, options = {}) {
  if (!group || !Array.isArray(group.members) || group.members.length === 0) {
    return null;
  }

  const center = readPoint(group.center) || averagePoint(group.members);
  const members = orderSpiderfyMembers(group.members);
  const maxCircleItems = Math.max(1, Math.trunc(toFiniteNumber(options.spiderfyCircleMaxItems, DEFAULT_DENSITY_OPTIONS.spiderfyCircleMaxItems) ?? DEFAULT_DENSITY_OPTIONS.spiderfyCircleMaxItems));
  const circleRadiusPx = Math.max(1, toFiniteNumber(options.spiderfyCircleRadiusPx, DEFAULT_DENSITY_OPTIONS.spiderfyCircleRadiusPx) ?? DEFAULT_DENSITY_OPTIONS.spiderfyCircleRadiusPx);
  const spiralStepPx = Math.max(1, toFiniteNumber(options.spiderfySpiralStepPx, DEFAULT_DENSITY_OPTIONS.spiderfySpiralStepPx) ?? DEFAULT_DENSITY_OPTIONS.spiderfySpiralStepPx);
  const spiralAngleStep = toFiniteNumber(options.spiderfySpiralAngleStep, DEFAULT_DENSITY_OPTIONS.spiderfySpiralAngleStep) ?? DEFAULT_DENSITY_OPTIONS.spiderfySpiralAngleStep;
  const hitPaddingPx = Math.max(0, toFiniteNumber(options.spiderfyHitPaddingPx, DEFAULT_DENSITY_OPTIONS.spiderfyHitPaddingPx) ?? DEFAULT_DENSITY_OPTIONS.spiderfyHitPaddingPx);
  const useCircle = members.length <= maxCircleItems;
  const items = [];
  let maxDistancePx = 0;

  for (let index = 0; index < members.length; index += 1) {
    const marker = members[index];
    let angle;
    let distancePx;

    if (useCircle) {
      angle = -Math.PI / 2 + (TAU * index) / members.length;
      distancePx = circleRadiusPx;
    } else {
      angle = spiralAngleStep * index;
      distancePx = circleRadiusPx + spiralStepPx * Math.sqrt(index + 1);
    }

    const x = center.x + distancePx * Math.cos(angle);
    const y = center.y + distancePx * Math.sin(angle);

    maxDistancePx = Math.max(maxDistancePx, distancePx);
    items.push({
      id: `${marker.id}:${index}`,
      marker,
      x,
      y,
      angle,
      distancePx,
      baseX: marker.baseX,
      baseY: marker.baseY,
      isSelected: marker.isSelected,
      isHovered: marker.isHovered,
      aircraftId: marker.aircraftId,
    });
  }

  const bounds = makeBounds();
  updateBounds(bounds, center);
  for (const item of items) {
    updateBounds(bounds, item);
  }

  const expanded = {
    id: `${group.id}:spiderfy`,
    groupId: group.id,
    kind: "spiderfy",
    mode: useCircle ? "circle" : "spiral",
    center,
    members,
    items,
    bounds: finalizeBounds(bounds),
    radiusPx: maxDistancePx + hitPaddingPx,
    hitRadiusPx: maxDistancePx + hitPaddingPx,
    label: String(members.length),
    markerCount: members.length,
    selectedCount: members.filter((marker) => marker.isSelected).length,
    hoveredCount: members.filter((marker) => marker.isHovered).length,
    memberIds: members.map((marker) => marker.id),
  };

  attachHiddenProperty(expanded, "sourceGroup", group);
  return expanded;
}

export const expandSpiderfiedPositions = expandSpiderfyGroup;

function normalizeSceneInput(sceneOrGroups) {
  if (Array.isArray(sceneOrGroups)) {
    return {
      densityMode: DENSITY_MODES.NORMAL,
      groups: sceneOrGroups,
    };
  }

  if (sceneOrGroups && typeof sceneOrGroups === "object" && Array.isArray(sceneOrGroups.groups)) {
    return sceneOrGroups;
  }

  return {
    densityMode: DENSITY_MODES.NORMAL,
    groups: [],
  };
}

function normalizeTargetPoint(point) {
  const resolved = readPoint(point);
  return resolved ? { x: resolved.x, y: resolved.y } : null;
}

/**
 * Hit-test a density scene against a pointer position.
 * Returns serializable metadata plus hidden references to the source objects.
 */
export function findSceneTargetAtPoint(sceneOrGroups, point, options = {}) {
  const scene = normalizeSceneInput(sceneOrGroups);
  const target = normalizeTargetPoint(point);
  if (!target || scene.groups.length === 0) {
    return null;
  }

  const clusterHitPaddingPx = Math.max(0, toFiniteNumber(options.clusterHitPaddingPx, DEFAULT_DENSITY_OPTIONS.clusterHitPaddingPx) ?? DEFAULT_DENSITY_OPTIONS.clusterHitPaddingPx);
  const spiderfyHitPaddingPx = Math.max(0, toFiniteNumber(options.spiderfyHitPaddingPx, DEFAULT_DENSITY_OPTIONS.spiderfyHitPaddingPx) ?? DEFAULT_DENSITY_OPTIONS.spiderfyHitPaddingPx);
  const singleHitRadiusPx = Math.max(1, toFiniteNumber(options.singleHitRadiusPx, options.hitRadiusPx) ?? 14);

  let bestHit = null;

  for (const group of scene.groups) {
    if (!group || typeof group !== "object") {
      continue;
    }

    const center = readPoint(group.center) || readPoint(group);
    if (!center) {
      continue;
    }

    const groupRadiusPx = Math.max(
      toFiniteNumber(group.hitRadiusPx, group.radiusPx) ?? 0,
      (toFiniteNumber(group.radiusPx, 0) ?? 0) + clusterHitPaddingPx
    );

    const expanded = group.expanded && Array.isArray(group.expanded.items) ? group.expanded : null;
    if (expanded) {
      for (const item of expanded.items) {
        const itemPoint = readPoint(item);
        if (!itemPoint) {
          continue;
        }

        const distanceSq = pointDistanceSq(target, itemPoint);
        if (distanceSq <= spiderfyHitPaddingPx * spiderfyHitPaddingPx && (!bestHit || distanceSq < bestHit.distanceSq)) {
          const result = {
            type: "spiderfy-item",
            densityMode: scene.densityMode,
            groupId: group.id,
            markerId: item.marker ? item.marker.id : item.id,
            itemId: item.id,
            point: itemPoint,
            distanceSq,
          };
          attachHiddenProperty(result, "group", group);
          attachHiddenProperty(result, "marker", item.marker || null);
          attachHiddenProperty(result, "item", item);
          attachHiddenProperty(result, "scene", scene);
          bestHit = result;
        }
      }
    }

    const isSingle = group.kind === "marker" || group.markerCount === 1;
    const radiusSq = (isSingle ? singleHitRadiusPx : groupRadiusPx) ** 2;
    const centerDistanceSq = pointDistanceSq(target, center);
    if (centerDistanceSq <= radiusSq && (!bestHit || centerDistanceSq < bestHit.distanceSq)) {
      const marker = Array.isArray(group.members) && group.members.length > 0 ? group.members[0] : null;
      const result = {
        type: isSingle ? "marker" : "cluster",
        densityMode: scene.densityMode,
        groupId: group.id,
        markerId: marker ? marker.id : null,
        point: center,
        distanceSq: centerDistanceSq,
      };
      attachHiddenProperty(result, "group", group);
      attachHiddenProperty(result, "marker", marker);
      attachHiddenProperty(result, "scene", scene);
      bestHit = result;
    }
  }

  return bestHit;
}

export const hitTestDensityGroups = findSceneTargetAtPoint;

export function layoutDensityGroups(markers, options = {}) {
  return buildDensityScene(markers, options);
}

export const clusterProjectedDensity = buildDensityScene;
export const spiderfyProjectedGroup = expandSpiderfyGroup;

export default {
  DENSITY_MODES,
  DEFAULT_DENSITY_OPTIONS,
  normalizeProjectedMarker,
  normalizeProjectedMarkers,
  decideDensityMode,
  buildDensityScene,
  groupProjectedMarkers,
  expandSpiderfyGroup,
  expandSpiderfiedPositions,
  findSceneTargetAtPoint,
  hitTestDensityGroups,
  layoutDensityGroups,
  clusterProjectedDensity,
  spiderfyProjectedGroup,
};

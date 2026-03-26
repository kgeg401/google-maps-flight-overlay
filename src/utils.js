export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function isFiniteNumber(value) {
  return Number.isFinite(value);
}

export function toFiniteNumber(value) {
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

export function firstFiniteNumber(...values) {
  for (const value of values) {
    const parsed = toFiniteNumber(value);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

export function cleanText(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

export function createMap() {
  return new Map();
}

export function formatLatLon(lat, lon) {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

export function formatZoomSummary(mapState) {
  if (!mapState) {
    return "n/a";
  }

  if (mapState.zoomSource === "meters-estimate") {
    return `~z${mapState.zoom.toFixed(2)} from ${Math.round(mapState.scaleMeters || 0)}m`;
  }

  return `z${mapState.zoom.toFixed(2)}`;
}

export function formatAltitude(aircraft) {
  if (aircraft.onGround) {
    return "GND";
  }
  if (!isFiniteNumber(aircraft.altitudeFt)) {
    return "n/a";
  }
  return `${Math.round(aircraft.altitudeFt).toLocaleString()} ft`;
}

export function formatSpeed(speedKt) {
  if (!isFiniteNumber(speedKt)) {
    return "n/a";
  }
  return `${Math.round(speedKt)} kt`;
}

export function formatHeading(heading) {
  if (!isFiniteNumber(heading)) {
    return "n/a";
  }
  return `${Math.round((heading % 360 + 360) % 360)} deg`;
}

export function formatAge(updatedAt, now = Date.now()) {
  if (!isFiniteNumber(updatedAt)) {
    return "n/a";
  }
  const deltaSec = Math.max(0, Math.round((now - updatedAt) / 1000));
  return `${deltaSec}s ago`;
}

export function formatRouteEndpoint(airport) {
  if (!airport) {
    return "";
  }

  const code = cleanText(airport.iataCode) || cleanText(airport.icaoCode) || null;
  const name = cleanText(airport.name) || cleanText(airport.municipality) || null;

  if (code && name) {
    return `${code} ${name}`;
  }
  return code || name || "";
}

export function formatAircraftTitle(aircraft, details) {
  return (
    cleanText(aircraft && aircraft.callsign) ||
    cleanText(details && details.registration) ||
    cleanText(aircraft && aircraft.registration) ||
    cleanText(aircraft && aircraft.id) ||
    "Selected aircraft"
  );
}

export function formatAircraftSubtitle(aircraft, details) {
  const parts = [
    cleanText(details && details.manufacturer),
    cleanText(details && details.type),
    cleanText(aircraft && aircraft.aircraftType),
  ].filter(Boolean);

  if (parts.length > 0) {
    return parts.join(" ");
  }

  return "Live aircraft details";
}

export function serializeLogValue(value, depth = 0) {
  const nextDepth = depth + 1;
  if (depth >= 4) {
    return "[max-depth]";
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack || null,
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 24).map((item) => serializeLogValue(item, nextDepth));
  }
  if (value instanceof Map) {
    return Object.fromEntries(
      Array.from(value.entries())
        .slice(0, 24)
        .map(([key, entryValue]) => [key, serializeLogValue(entryValue, nextDepth)])
    );
  }
  if (typeof value === "object") {
    const output = {};
    const entries = Object.entries(value).slice(0, 24);
    for (const [key, entryValue] of entries) {
      output[key] = serializeLogValue(entryValue, nextDepth);
    }
    return output;
  }
  return String(value);
}

export function mergeDeep(base, override) {
  if (!override || typeof override !== "object") {
    return structuredClone(base);
  }

  const output = Array.isArray(base) ? [...base] : { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      output[key] = mergeDeep(base[key], value);
    } else {
      output[key] = value;
    }
  }

  return output;
}

export function pickDefinedEntries(entries) {
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

export function copyTextToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    return navigator.clipboard.writeText(text);
  }

  return new Promise((resolve, reject) => {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "readonly");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const succeeded = document.execCommand("copy");
      textarea.remove();
      if (!succeeded) {
        reject(new Error("copy_failed"));
        return;
      }
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

export function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

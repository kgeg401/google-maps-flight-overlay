import {
  DEFAULT_SETTINGS,
  DETAILS_CACHE_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  SETTINGS_VERSION,
} from "./config.js";
import { mergeDeep, safeJsonParse } from "./utils.js";

function hasFunction(name) {
  return typeof globalThis[name] === "function";
}

export function createStorage() {
  const memory = new Map();

  function getValue(name, fallback = null) {
    if (hasFunction("GM_getValue")) {
      return Promise.resolve(globalThis.GM_getValue(name, fallback));
    }
    return Promise.resolve(memory.has(name) ? memory.get(name) : fallback);
  }

  function setValue(name, value) {
    if (hasFunction("GM_setValue")) {
      return Promise.resolve(globalThis.GM_setValue(name, value));
    }
    memory.set(name, value);
    return Promise.resolve();
  }

  function removeValue(name) {
    if (hasFunction("GM_deleteValue")) {
      return Promise.resolve(globalThis.GM_deleteValue(name));
    }
    memory.delete(name);
    return Promise.resolve();
  }

  return {
    getValue,
    setValue,
    removeValue,
    async getJson(name, fallback = null) {
      const raw = await getValue(name, null);
      if (raw === null || raw === undefined || raw === "") {
        return fallback;
      }
      if (typeof raw === "object") {
        return raw;
      }
      return safeJsonParse(raw, fallback);
    },
    async setJson(name, value) {
      return setValue(name, JSON.stringify(value));
    },
  };
}

export function normalizeSettings(rawSettings) {
  const merged = mergeDeep(DEFAULT_SETTINGS, rawSettings || {});
  merged.settingsVersion = SETTINGS_VERSION;
  merged.markerSizePx = clampNumber(merged.markerSizePx, 6, 20, DEFAULT_SETTINGS.markerSizePx);
  merged.hoverHitRadiusPx = clampNumber(merged.hoverHitRadiusPx, 8, 42, DEFAULT_SETTINGS.hoverHitRadiusPx);
  merged.labelMode = pickAllowed(
    merged.labelMode,
    ["selected-and-hovered-only", "high-zoom-visible", "off"],
    DEFAULT_SETTINGS.labelMode
  );
  merged.trailMode = pickAllowed(
    merged.trailMode,
    ["selected-only", "selected-and-hovered", "off"],
    DEFAULT_SETTINGS.trailMode
  );
  merged.densityMode = pickAllowed(
    merged.densityMode,
    ["normal", "spiderfy", "declutter"],
    DEFAULT_SETTINGS.densityMode
  );
  merged.photoMode = pickAllowed(merged.photoMode, ["enabled", "disabled"], DEFAULT_SETTINGS.photoMode);
  merged.debugLevel = pickAllowed(merged.debugLevel, ["off", "basic", "trace"], DEFAULT_SETTINGS.debugLevel);
  return merged;
}

export async function loadSettings(storage) {
  const rawSettings = await storage.getJson(SETTINGS_STORAGE_KEY, null);
  return normalizeSettings(rawSettings);
}

export async function saveSettings(storage, settings) {
  return storage.setJson(SETTINGS_STORAGE_KEY, normalizeSettings(settings));
}

export async function exportSettings(storage) {
  const settings = await loadSettings(storage);
  return JSON.stringify(settings, null, 2);
}

export async function importSettings(storage, text) {
  const parsed = safeJsonParse(text, null);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid settings JSON");
  }
  const normalized = normalizeSettings(parsed);
  await saveSettings(storage, normalized);
  return normalized;
}

export async function loadSelectedAircraftCache(storage) {
  return storage.getJson(DETAILS_CACHE_STORAGE_KEY, {});
}

export async function saveSelectedAircraftCache(storage, cacheObject) {
  return storage.setJson(DETAILS_CACHE_STORAGE_KEY, cacheObject || {});
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function pickAllowed(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

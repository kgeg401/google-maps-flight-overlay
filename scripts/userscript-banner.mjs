export function formatUserscriptBanner(metadata) {
  const lines = ["// ==UserScript=="];

  for (const [key, rawValue] of metadata) {
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) {
        lines.push(`// @${key.padEnd(12)} ${value}`);
      }
      continue;
    }

    if (rawValue === "") {
      lines.push(`// @${key}`);
      continue;
    }

    lines.push(`// @${key.padEnd(12)} ${rawValue}`);
  }

  lines.push("// ==/UserScript==");
  return lines.join("\n");
}

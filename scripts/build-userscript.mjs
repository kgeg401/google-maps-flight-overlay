import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { formatUserscriptBanner } from "./userscript-banner.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJsonPath = path.join(repoRoot, "package.json");
const entryPoint = path.join(repoRoot, "src", "index.js");
const outDir = path.join(repoRoot, "dist");
const outFile = path.join(outDir, "google-maps-flight-overlay.user.js");
const rootOutFile = path.join(repoRoot, "google-maps-flight-overlay.user.js");

const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
const version = pkg.version;

await mkdir(outDir, { recursive: true });

const banner = formatUserscriptBanner([
  ["name", "Google Maps Flight Overlay"],
  ["namespace", "https://github.com/kgeg401/google-maps-flight-overlay"],
  ["version", version],
  ["description", "Overlay live aircraft markers on Google Maps using Airplanes.live."],
  ["match", "https://www.google.com/maps/*"],
  ["noframes", ""],
  ["run-at", "document-body"],
  ["sandbox", "DOM"],
  ["grant", "GM_addStyle"],
  ["grant", "GM_getValue"],
  ["grant", "GM_setValue"],
  ["grant", "GM_deleteValue"],
  ["grant", "GM_registerMenuCommand"],
  ["grant", "GM.xmlHttpRequest"],
  ["connect", "api.airplanes.live"],
  ["connect", "api.adsbdb.com"],
  ["connect", "api.adsb.lol"],
  ["homepageURL", "https://github.com/kgeg401/google-maps-flight-overlay"],
  ["supportURL", "https://github.com/kgeg401/google-maps-flight-overlay/issues"],
  ["updateURL", "https://raw.githubusercontent.com/kgeg401/google-maps-flight-overlay/main/google-maps-flight-overlay.user.js"],
  ["downloadURL", "https://raw.githubusercontent.com/kgeg401/google-maps-flight-overlay/main/google-maps-flight-overlay.user.js"],
]);

await build({
  entryPoints: [entryPoint],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  outfile: outFile,
  banner: { js: banner },
  legalComments: "none",
  sourcemap: false,
  write: true,
});

const built = await readFile(outFile, "utf8");
const normalized = built
  .replace(/const VERSION = "([^"]+)";/, `const VERSION = "${version}";`)
  .replace(/(@version\s+)([^\n]+)/, `$1${version}`);

if (normalized !== built) {
  await writeFile(outFile, normalized);
}

await copyFile(outFile, rootOutFile);

console.log(`Built ${path.relative(repoRoot, outFile)} (${version})`);

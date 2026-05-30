/* ============================================================
   Build / deploy-readiness + resilience tests.
   Runner: node --test (Node >= 22.18). Requires a prior `next build`
   (reads .next/static for the client-bundle check).
   ============================================================ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

// ---- D1: prebuild -> build:data hook + scripts present ----
test("package.json wires prebuild -> build:data and the data scripts", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts.prebuild, "npm run build:data", "prebuild must run build:data so Vercel regenerates JSON");
  assert.ok(pkg.scripts["build:data"]?.includes("build-data"), "build:data script missing");
  assert.ok(pkg.scripts["verify:data"]?.includes("verify-data"), "verify:data script missing");
  assert.ok(pkg.scripts.build === "next build");
});

// ---- D2: .gitignore ignores node_modules and .next; data ships ----
test(".gitignore ignores build artefacts but not committed data", () => {
  const gi = read(".gitignore");
  assert.match(gi, /node_modules/, ".gitignore must ignore node_modules");
  assert.match(gi, /\.next/, ".gitignore must ignore .next");
  // committed data + geo must NOT be ignored (the app fetches them at runtime)
  assert.ok(!/\/public\/data/.test(gi), "public/data must not be gitignored");
  assert.ok(!/\/data\/cer/.test(gi), "data/cer must not be gitignored");
  // the files actually exist on disk to ship
  for (const f of [
    "data/cer/sres-postcode-data-installations-2011-to-present-and-totals.xlsx",
    "public/data/data.json", "public/data/postcodes.json", "public/data/meta.json",
    "public/geo/aus-states.geojson", "data/geo/postcode-centroids.json",
  ]) assert.ok(existsSync(resolve(ROOT, f)), `missing shippable file: ${f}`);
});

// ---- D3: no client-side xlsx parsing shipped to the browser ----
test("the xlsx library is not in the client bundle", () => {
  const dir = resolve(ROOT, ".next/static");
  assert.ok(existsSync(dir), "run `next build` before this test");
  const jsFiles = walk(dir, [".js"]);
  assert.ok(jsFiles.length > 0, "no client JS found in .next/static");
  for (const f of jsFiles) {
    const txt = readFileSync(f, "utf8");
    assert.ok(!/sheetjs/i.test(txt), `SheetJS marker found in client bundle ${f}`);
    assert.ok(!txt.includes("XLSX.utils"), `XLSX.utils found in client bundle ${f}`);
    // the only legitimately-large chunk is the (lazy-loaded) MapLibre map. Any large
    // chunk MUST be MapLibre - if a 900KB+ chunk were NOT maplibre, xlsx likely leaked in.
    if (statSync(f).size > 500 * 1024) {
      assert.match(txt, /maplibre/i, `large client chunk ${f} is not MapLibre - a heavy dep may have leaked in`);
    }
  }
});

// ---- D4: the map is lazy-loaded (not in the initial bundle) ----
test("the MapLibre map is dynamically imported with ssr disabled", () => {
  const dash = read("components/Dashboard.tsx");
  assert.match(dash, /dynamic\(\s*\(\)\s*=>\s*import\(["']\.\/map\/AusMap["']\)/, "AusMap should be a dynamic import");
  assert.match(dash, /ssr:\s*false/, "AusMap dynamic import should set ssr:false");
});

// ---- D5: no absolute local paths or secrets committed ----
test("no absolute local paths or session paths are committed in source/data", () => {
  const files = [
    ...walk(resolve(ROOT, "app"), [".ts", ".tsx", ".css"]),
    ...walk(resolve(ROOT, "components"), [".ts", ".tsx"]),
    ...walk(resolve(ROOT, "lib"), [".ts"]),
    ...walk(resolve(ROOT, "scripts"), [".ts", ".mjs"]),
    ...walk(resolve(ROOT, "public/data"), [".json"]),
    ...["package.json", "tsconfig.json", "next.config.mjs", "postcss.config.mjs", "README.md", "global.d.ts"]
      .map((f) => resolve(ROOT, f)),
  ];
  const banned = [/local-agent-mode-sessions/, /AppData[\\/]+Local[\\/]+Packages[\\/]+Claude/, /C:[\\/]+Users[\\/]+TroyRowe/];
  for (const f of files) {
    const txt = readFileSync(f, "utf8");
    for (const re of banned) assert.ok(!re.test(txt), `committed file ${f} contains an absolute/session path (${re})`);
  }
});

// ---- E1: graceful when a postcode is missing from the centroid lookup ----
test("postcodes missing a centroid are emitted with null lng/lat (not dropped or crashed)", () => {
  const pc = JSON.parse(read("public/data/postcodes.json")) as {
    solar: { pc: string; lng: number | null; lat: number | null }[];
  };
  const withNull = pc.solar.filter((p) => p.lng === null || p.lat === null);
  const withCentroid = pc.solar.filter((p) => p.lng !== null && p.lat !== null);
  // there ARE a few unmatched postcodes (e.g. 0000/edge codes) - they must be present, not dropped
  assert.ok(withNull.length >= 1, "expected at least one null-centroid postcode to prove graceful handling");
  assert.ok(withCentroid.length / pc.solar.length > 0.9, "most postcodes should have centroids");
  // and the map layer must filter out the null ones rather than feed NaN coordinates to MapLibre
  const map = read("components/map/AusMap.tsx");
  assert.match(map, /p\.lat != null && p\.lng != null/, "map must skip null-centroid postcodes");
});

// ---- E2: every emitted number is finite (no NaN/Infinity from zero-install months) ----
test("no NaN or Infinity in the emitted data.json", () => {
  const raw = read("public/data/data.json");
  const data = JSON.parse(raw);
  let count = 0;
  const checkFinite = (v: unknown): void => {
    if (typeof v === "number") { assert.ok(Number.isFinite(v), "non-finite number in data.json"); count++; }
    else if (Array.isArray(v)) v.forEach(checkFinite);
    else if (v && typeof v === "object") Object.values(v).forEach(checkFinite);
  };
  checkFinite(data);
  assert.ok(count > 1000, `expected thousands of numbers, scanned ${count}`);
  // belt and braces: the serialised JSON contains no NaN/Infinity tokens
  assert.ok(!/\bNaN\b/.test(raw) && !/\bInfinity\b/.test(raw));
});

/* ============================================================
   One-time geo asset fetcher (run with: node scripts/fetch-geo.mjs)
   Produces two committed artefacts the dashboard map needs:
     - public/geo/aus-states.geojson      (state/territory polygons, props {code,name})
     - data/geo/postcode-centroids.json   ({ "<pc>": [lng, lat] })
   These rarely change; you do not need to re-run this for a monthly data refresh.
   ============================================================ */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_CANDIDATES = [
  "https://raw.githubusercontent.com/rowanhogan/australian-states/master/states.min.geojson",
  "https://raw.githubusercontent.com/rowanhogan/australian-states/master/states.geojson",
  "https://raw.githubusercontent.com/tonywr71/GeoJson-Data/master/australian-states.min.geojson",
  "https://raw.githubusercontent.com/tonywr71/GeoJson-Data/master/australian-states.json",
];
const POSTCODE_CSV =
  "https://raw.githubusercontent.com/matthewproctor/australianpostcodes/master/australian_postcodes.csv";

const NAME2CODE = {
  "new south wales": "NSW", nsw: "NSW",
  victoria: "VIC", vic: "VIC",
  queensland: "QLD", qld: "QLD",
  "western australia": "WA", wa: "WA",
  "south australia": "SA", sa: "SA",
  tasmania: "TAS", tas: "TAS",
  "australian capital territory": "ACT", act: "ACT",
  "northern territory": "NT", nt: "NT",
};
const CODE2NAME = {
  NSW: "New South Wales", VIC: "Victoria", QLD: "Queensland", WA: "Western Australia",
  SA: "South Australia", TAS: "Tasmania", ACT: "Australian Capital Territory", NT: "Northern Territory",
};

function codeFromProps(props) {
  for (const v of Object.values(props || {})) {
    if (v == null) continue;
    const code = NAME2CODE[String(v).trim().toLowerCase()];
    if (code) return code;
  }
  return null;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "resource-cer-dashboard/1.0" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.text();
}

async function buildStates() {
  for (const url of STATE_CANDIDATES) {
    try {
      const txt = await fetchText(url);
      const gj = JSON.parse(txt);
      const feats = gj.features || [];
      const out = [];
      const seen = new Set();
      for (const f of feats) {
        const code = codeFromProps(f.properties);
        if (!code || seen.has(code)) continue;
        seen.add(code);
        out.push({ type: "Feature", properties: { code, name: CODE2NAME[code] }, geometry: f.geometry });
      }
      if (out.length >= 6) {
        const fc = { type: "FeatureCollection", features: out };
        mkdirSync(resolve(ROOT, "public/geo"), { recursive: true });
        writeFileSync(resolve(ROOT, "public/geo/aus-states.geojson"), JSON.stringify(fc));
        console.log(`[states] OK from ${url} -> ${out.length} features: ${[...seen].join(", ")}`);
        return true;
      }
      console.log(`[states] ${url} only matched ${out.length} states, trying next`);
    } catch (e) {
      console.log(`[states] ${url} failed: ${e.message}`);
    }
  }
  console.error("[states] ERROR: no usable states GeoJSON source found");
  return false;
}

function parseCSVLine(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function buildCentroids() {
  let txt;
  try { txt = await fetchText(POSTCODE_CSV); }
  catch (e) { console.error("[centroids] ERROR fetching CSV: " + e.message); return false; }
  const lines = txt.split(/\r?\n/);
  const header = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
  const iPc = header.findIndex((h) => h === "postcode");
  const iLng = header.findIndex((h) => h === "long" || h === "longitude" || h === "lng");
  const iLat = header.findIndex((h) => h === "lat" || h === "latitude");
  if (iPc < 0 || iLng < 0 || iLat < 0) {
    console.error("[centroids] ERROR: could not locate postcode/long/lat columns in " + JSON.stringify(header.slice(0, 12)));
    return false;
  }
  const acc = new Map(); // pc -> {lng,lat,n}
  for (let r = 1; r < lines.length; r++) {
    if (!lines[r]) continue;
    const cols = parseCSVLine(lines[r]);
    const pcRaw = cols[iPc];
    if (pcRaw == null) continue;
    const pc = String(pcRaw).replace(/\D/g, "").padStart(4, "0");
    if (pc === "0000") continue;
    const lng = parseFloat(cols[iLng]);
    const lat = parseFloat(cols[iLat]);
    if (!isFinite(lng) || !isFinite(lat) || (lng === 0 && lat === 0)) continue;
    if (lat > -8 || lat < -45 || lng < 110 || lng > 156) continue; // crude AU bounds guard
    const cur = acc.get(pc) || { lng: 0, lat: 0, n: 0 };
    cur.lng += lng; cur.lat += lat; cur.n += 1;
    acc.set(pc, cur);
  }
  const out = {};
  for (const [pc, v] of acc) out[pc] = [Math.round((v.lng / v.n) * 1e5) / 1e5, Math.round((v.lat / v.n) * 1e5) / 1e5];
  mkdirSync(resolve(ROOT, "data/geo"), { recursive: true });
  writeFileSync(resolve(ROOT, "data/geo/postcode-centroids.json"), JSON.stringify(out));
  console.log(`[centroids] OK -> ${Object.keys(out).length} postcodes`);
  return true;
}

const okStates = await buildStates();
const okCentroids = await buildCentroids();
if (!okStates || !okCentroids) process.exit(1);
console.log("Geo assets ready.");

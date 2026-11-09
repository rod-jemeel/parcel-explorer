import fs from "node:fs";
import path from "node:path";
import geojsonvt from "geojson-vt";
import vtpbf from "vt-pbf";

const root = process.cwd();
const requestedRelease = process.argv[2];
if (requestedRelease && !/^bk-[a-f0-9]{12}$/.test(requestedRelease)) {
  throw new Error("Expected a Brooklyn release ID");
}
const manifest = requestedRelease
  ? { release_id: requestedRelease, storage_format: "sqlite-v1" }
  : JSON.parse(fs.readFileSync(path.join(root, "data/candidate.json"), "utf8"));
const release = manifest.release_id;
const directory = path.join(root, "apps/web/public/data", release);
const marker = path.join(directory, "tiles-ready.json");
if (fs.existsSync(marker)) {
  const ready = JSON.parse(fs.readFileSync(marker, "utf8"));
  if (ready.release_id === release && ready.count && ready.features === manifest.feature_count) {
    console.log(JSON.stringify(ready));
    process.exit(0);
  }
}
const raw = JSON.parse(
  fs.readFileSync(
    path.join(root, "data/releases", release, "geometry.geojson"),
    "utf8",
  ),
);
const properties =
  manifest.storage_format === "sqlite-v1"
    ? []
    : JSON.parse(fs.readFileSync(path.join(directory, "index.json"), "utf8"));
const byBBL = new Map(properties.map((p) => [p.bbl, p]));
const features =
  manifest.storage_format === "sqlite-v1"
    ? raw.features
    : raw.features.map((f) => {
        const bbl = String(Math.trunc(f.properties.BBL));
        const p = byBBL.get(bbl);
        if (!p) throw new Error("Missing normalized property " + bbl);
        return {
          type: "Feature",
          geometry: f.geometry,
          properties: {
            bbl,
            lot: p.lot,
            block: p.block,
            use: p.land_use || "",
            kind: p.entity_kind,
          },
        };
      });
function geometryBounds(features) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  function visit(coordinates) {
    if (typeof coordinates[0] !== "number") {
      for (const group of coordinates) visit(group);
      return;
    }
    const [lng, lat] = coordinates;
    bounds[0] = Math.min(bounds[0], lng);
    bounds[1] = Math.min(bounds[1], lat);
    bounds[2] = Math.max(bounds[2], lng);
    bounds[3] = Math.max(bounds[3], lat);
  }
  for (const feature of features) visit(feature.geometry.coordinates);
  return bounds;
}
const bounds = manifest.bounds ?? geometryBounds(features);
const buildingPath = path.join(
  root,
  "data/releases",
  release,
  "buildings.geojson",
);
const buildings = fs.existsSync(buildingPath)
  ? JSON.parse(fs.readFileSync(buildingPath, "utf8"))
  : { type: "FeatureCollection", features: [] };
const buildingIndex = geojsonvt(buildings, {
  maxZoom: 16,
  indexMaxZoom: 14,
  tolerance: 0.5,
  extent: 4096,
  buffer: 64,
});
const index = geojsonvt(
  { type: "FeatureCollection", features },
  {
    maxZoom: 16,
    indexMaxZoom: 14,
    tolerance: 1,
    extent: 4096,
    buffer: 64,
    promoteId: "bbl",
  },
);
function merc(lng, lat, z) {
  const n = 2 ** z;
  return [
    ((lng + 180) / 360) * n,
    ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n,
  ];
}
let count = 0,
  bytes = 0;
for (let z = 13; z <= 16; z++) {
  const nw = merc(bounds[0], bounds[3], z),
    se = merc(bounds[2], bounds[1], z);
  for (let x = Math.floor(nw[0]) - 1; x <= Math.floor(se[0]) + 1; x++) {
    for (let y = Math.floor(nw[1]) - 1; y <= Math.floor(se[1]) + 1; y++) {
      const tile = index.getTile(z, x, y);
      if (!tile?.features.length) continue;
      const buildingTile = buildingIndex.getTile(z, x, y);
      const layers = { parcels: tile };
      if (buildingTile?.features.length) layers.buildings = buildingTile;
      const data = vtpbf.fromGeojsonVt(layers, { version: 2, extent: 4096 });
      const tilePath = path.join(
        directory,
        "tiles",
        String(z),
        String(x),
        y + ".pbf",
      );
      fs.mkdirSync(path.dirname(tilePath), { recursive: true });
      fs.writeFileSync(tilePath, data);
      count++;
      bytes += data.length;
    }
  }
}
fs.writeFileSync(
  marker + ".tmp",
  JSON.stringify({
    release_id: release,
    count,
    bytes,
    minzoom: 13,
    maxzoom: 16,
    layer: "parcels",
    features: features.length,
  }),
);
fs.renameSync(marker + ".tmp", marker);
console.log(
  JSON.stringify({
    release_id: release,
    tiles: count,
    bytes,
    features: features.length,
  }),
);

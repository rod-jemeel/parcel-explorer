import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
fs.mkdirSync(path.join(root, "apps/web/public/vendor"), { recursive: true });
fs.copyFileSync(
  path.join(root, "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs"),
  path.join(root, "apps/web/public/vendor/maplibre-gl-worker.mjs"),
);

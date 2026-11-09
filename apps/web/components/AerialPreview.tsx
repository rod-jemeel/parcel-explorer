"use client";
import { useMemo, useState } from "react";
import { Expand, ImageOff } from "lucide-react";
import { PropertyProfile, PropertySummary } from "@/lib/model";
export const AERIAL_TILES =
  "https://tiles.arcgis.com/tiles/yG5s3afENB5iO9fj/arcgis/rest/services/NYC_Orthos_2024/MapServer/tile";
export const AERIAL_SOURCE =
  "https://www.arcgis.com/home/item.html?id=423f15185bd04f8dad8d99fba736772f";
const project = (lng: number, lat: number) => [
  (lng + 180) / 360,
  (1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2,
];
export default function AerialPreview({
  property,
  onOpen,
}: {
  property: PropertySummary | PropertyProfile;
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const view = useMemo(() => {
    const W = 384,
      H = 190,
      b = property.bounds,
      nw = project(b[0], b[3]),
      se = project(b[2], b[1]);
    const z = Math.max(
      13,
      Math.min(
        20,
        Math.floor(
          Math.log2(
            Math.min(
              W / (Math.max(se[0] - nw[0], 1e-8) * 256 * 1.7),
              H / (Math.max(se[1] - nw[1], 1e-8) * 256 * 1.7),
            ),
          ),
        ),
      ),
    );
    const n = 2 ** z,
      c = project(...property.center),
      left = c[0] * n * 256 - W / 2,
      top = c[1] * n * 256 - H / 2;
    const tiles = [];
    for (let x = Math.floor(left / 256); x <= Math.floor((left + W) / 256); x++)
      for (let y = Math.floor(top / 256); y <= Math.floor((top + H) / 256); y++)
        tiles.push({
          x: x * 256 - left,
          y: y * 256 - top,
          url: `${AERIAL_TILES}/${z}/${y}/${x}`,
        });
    const buildings =
      "building_records" in property ? property.building_records || [] : [];
    function path(g: GeoJSON.Geometry) {
      const polygons =
        g.type === "MultiPolygon"
          ? g.coordinates
          : g.type === "Polygon"
            ? [g.coordinates]
            : [];
      return polygons
        .flatMap((p) =>
          p.map(
            (r) =>
              r
                .map(([lng, lat], i) => {
                  const [x, y] = project(lng, lat);
                  return `${i ? "L" : "M"}${(x * n * 256 - left).toFixed(2)},${(y * n * 256 - top).toFixed(2)}`;
                })
                .join(" ") + " Z",
          ),
        )
        .join(" ");
    }
    return {
      tiles,
      paths: buildings
        .filter((b) => b.geometry)
        .map((b) => ({ id: b.id, path: path(b.geometry) })),
      W,
      H,
    };
  }, [property]);
  return (
    <figure className="aerial-preview">
      <div className="aerial-image">
        {failed ? (
          <div className="aerial-unavailable">
            <ImageOff size={23} />
            <span>Official aerial image temporarily unavailable</span>
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${view.W} ${view.H}`}
            role="img"
            aria-label={`Official 2024 aerial image around ${property.address}; blue outlines are imported building footprints`}
          >
            <title>
              NYC OTI aerial imagery, 2024. Building footprints are a separate
              source observation.
            </title>
            {view.tiles.map((t, i) => (
              <image
                key={i}
                href={t.url}
                x={t.x}
                y={t.y}
                width="256"
                height="256"
                onError={() => setFailed(true)}
              />
            ))}
            {view.paths.map((p) => (
              <path
                key={p.id}
                d={p.path}
                fill="#3187cb22"
                stroke="#73d4ff"
                strokeWidth="1.5"
              />
            ))}
          </svg>
        )}
        <span className="image-date">Official aerial · 2024</span>
        <button
          aria-label="View aerial imagery on map"
          title="View aerial imagery on map"
          onClick={onOpen}
        >
          <Expand size={15} />
        </button>
      </div>
      <figcaption>
        <a href={AERIAL_SOURCE} target="_blank" rel="noopener noreferrer">
          © NYC OTI · Source & imagery dates
        </a>
        <span>Blue: linked building outlines, separately dated.</span>
      </figcaption>
    </figure>
  );
}

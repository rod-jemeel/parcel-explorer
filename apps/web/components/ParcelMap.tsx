"use client";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as maplibregl from "maplibre-gl";
import { type Map as LibreMap, type FilterSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Plus,
  Minus,
  LocateFixed,
  Layers3,
  Compass,
} from "lucide-react";
import type { Bounds, Coverage } from "@/lib/model";
import { AERIAL_TILES } from "./AerialPreview";
import { USE_COLORS } from "@/lib/model";
const landUseColors = [
  "match",
  ["get", "use"],
  "1",
  USE_COLORS["1"],
  ...Object.entries(USE_COLORS)
    .filter(([k]) => k !== "1")
    .flatMap(([k, v]) => [k, v]),
  "#e2ddd1",
] as maplibregl.ExpressionSpecification;
export interface MapHandle {
  fit: (bounds: Bounds, padding?: boolean) => void;
  ensureVisible: (center: [number, number]) => void;
  getBounds: () => Bounds | null;
  reset: () => void;
  camera: (value: { lng: number; lat: number; zoom: number }) => void;
}
interface Props {
  coverage: Coverage;
  selected: string | null;
  hovered: string | null;
  matching: string[] | null;
  parcels: boolean;
  boundary: boolean;
  colored: boolean;
  imagery: boolean;
  buildings: boolean;
  layersOpen: boolean;
  onToggleLayers: () => void;
  onSelect: (bbls: string[]) => void;
  onMove: (b: Bounds, c: { lng: number; lat: number; zoom: number }) => void;
  initialCamera: { lng: number; lat: number; zoom: number } | null;
}
const ParcelMap = forwardRef<MapHandle, Props>(function ParcelMap(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState("");
  useImperativeHandle(
    ref,
    () => ({
      fit(bounds, padding = true) {
        const mobile = window.innerWidth < 760;
        map.current?.fitBounds(
          [
            [bounds[0], bounds[1]],
            [bounds[2], bounds[3]],
          ],
          {
            padding: mobile
              ? { top: 160, bottom: padding ? 280 : 80, left: 40, right: 40 }
              : {
                  top: 100,
                  bottom: 80,
                  left: padding ? 90 : 80,
                  right: padding
                    ? Math.min(window.innerWidth * 0.3, 420) + 50
                    : 80,
                },
            maxZoom: 18,
            duration: 600,
          },
        );
      },
      getBounds() {
        const b = map.current?.getBounds();
        return b
          ? [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
          : null;
      },
      ensureVisible(center) {
        const m = map.current;
        if (!m) return;
        const point = m.project(center);
        const panel = document
          .querySelector(".inspector")
          ?.getBoundingClientRect();
        const rect = m.getContainer().getBoundingClientRect();
        if (!panel) return;
        const mobile = window.innerWidth < 760;
        const right = mobile ? rect.width - 35 : panel.left - rect.left - 35;
        const bottom = mobile ? panel.top - rect.top - 30 : rect.height - 40;
        const dx =
          point.x > right ? point.x - right : point.x < 60 ? point.x - 60 : 0;
        const dy =
          point.y > bottom
            ? point.y - bottom
            : point.y < 130
              ? point.y - 130
              : 0;
        if (dx || dy) m.panBy([dx, dy], { duration: 250 });
      },
      reset() {
        map.current?.fitBounds(
          [
            [props.coverage.bounds[0], props.coverage.bounds[1]],
            [props.coverage.bounds[2], props.coverage.bounds[3]],
          ],
          { padding: 80, duration: 600 },
        );
      },
      camera(value) {
        map.current?.jumpTo({
          center: [value.lng, value.lat],
          zoom: value.zoom,
        });
      },
    }),
    [props.coverage.bounds],
  );
  useEffect(() => {
    if (!container.current) return;
    maplibregl.setWorkerUrl("/vendor/maplibre-gl-worker.mjs");
    const initial = latest.current.initialCamera;
    const m = new maplibregl.Map({
      container: container.current,
      center: initial ? [initial.lng, initial.lat] : [-73.9913, 40.6978],
      zoom: initial?.zoom ?? 15.1,
      minZoom: 10,
      maxZoom: 20,
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {
          basemap: {
            type: "raster",
            tiles: [
              process.env.NEXT_PUBLIC_BASEMAP_TILE_URL ||
                "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            ],
            tileSize: 256,
            attribution:
              process.env.NEXT_PUBLIC_BASEMAP_ATTRIBUTION ||
              '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
            maxzoom: 19,
          },
        },
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#edf0ec" },
          },
          {
            id: "basemap",
            type: "raster",
            layout: { visibility: latest.current.imagery ? "none" : "visible" },
            source: "basemap",
            paint: { "raster-saturation": -0.8, "raster-opacity": 0.75 },
          },
        ],
      },
    });
    map.current = m;
    m.addControl(
      new maplibregl.ScaleControl({ maxWidth: 100, unit: "imperial" }),
      "bottom-left",
    );
    m.on("load", () => {
      const b = latest.current.coverage.bounds;
      m.addSource("aerial", {
        type: "raster",
        tiles: [AERIAL_TILES + "/{z}/{y}/{x}"],
        tileSize: 256,
        maxzoom: 20,
        attribution: "Aerial imagery © NYC OTI, 2024",
      });
      m.addLayer({
        id: "aerial",
        type: "raster",
        source: "aerial",
        layout: { visibility: latest.current.imagery ? "visible" : "none" },
      });
      m.addSource("coverage", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [b[0], b[1]],
                [b[2], b[1]],
                [b[2], b[3]],
                [b[0], b[3]],
                [b[0], b[1]],
              ],
            ],
          },
        },
      });
      m.addLayer({
        id: "coverage-fill",
        type: "fill",
        source: "coverage",
        maxzoom: 13,
        paint: { "fill-color": "#3e759e", "fill-opacity": 0.07 },
      });
      m.addLayer({
        id: "coverage-line",
        type: "line",
        source: "coverage",
        paint: {
          "line-color": "#4d7695",
          "line-dasharray": [3, 3],
          "line-width": 1.5,
          "line-opacity": 0.8,
        },
      });
      m.addSource("parcels", {
        type: "vector",
        tiles: [
          `${location.origin}/data/${latest.current.coverage.release_id}/tiles/{z}/{x}/{y}.pbf`,
        ],
        minzoom: 13,
        maxzoom: 16,
        bounds: latest.current.coverage.bounds,
        promoteId: "bbl",
        attribution:
          "Parcels: NYC Department of City Planning, MapPLUTO " +
          latest.current.coverage.source_edition,
      });
      m.addLayer({
        id: "parcel-fill",
        type: "fill",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: 13,
        paint: { "fill-color": landUseColors, "fill-opacity": 0.4 },
      });
      m.addLayer({
        id: "parcel-line",
        type: "line",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: 13,
        paint: {
          "line-color": "#747e7e",
          "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.3, 17, 0.8],
          "line-opacity": 0.75,
        },
      });
      if (latest.current.coverage.building_footprints) {
        m.addLayer({
          id: "building-fill",
          type: "fill",
          source: "parcels",
          "source-layer": "buildings",
          minzoom: 15,
          paint: { "fill-color": "#5e798b", "fill-opacity": 0.22 },
        });
        m.addLayer({
          id: "building-line",
          type: "line",
          source: "parcels",
          "source-layer": "buildings",
          minzoom: 15,
          paint: {
            "line-color": "#5b798d",
            "line-width": 0.8,
            "line-opacity": 0.7,
          },
        });
      }
      m.addLayer({
        id: "parcel-matches",
        type: "fill",
        source: "parcels",
        "source-layer": "parcels",
        filter: ["==", ["get", "bbl"], ""],
        paint: { "fill-color": "#517eab", "fill-opacity": 0.2 },
      });
      m.addLayer({
        id: "parcel-hover",
        type: "line",
        source: "parcels",
        "source-layer": "parcels",
        filter: ["==", ["get", "bbl"], ""],
        paint: { "line-color": "#3e799f", "line-width": 2 },
      });
      m.addLayer({
        id: "parcel-selected-fill",
        type: "fill",
        source: "parcels",
        "source-layer": "parcels",
        filter: ["==", ["get", "bbl"], ""],
        paint: { "fill-color": "#3187cb", "fill-opacity": 0.24 },
      });
      m.addLayer({
        id: "parcel-selected-line",
        type: "line",
        source: "parcels",
        "source-layer": "parcels",
        filter: ["==", ["get", "bbl"], ""],
        paint: { "line-color": "#1765a6", "line-width": 2.6 },
      });
      m.addLayer({
        id: "parcel-label",
        type: "symbol",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: 17,
        layout: {
          "text-field": ["get", "lot"],
          "text-font": ["Arial"],
          "text-size": 10,
          "text-padding": 5,
        },
        paint: {
          "text-color": "#596267",
          "text-halo-color": "#fff",
          "text-halo-width": 1.5,
        },
      });
      setReady(true);
      if (!initial && latest.current.coverage.storage_format === "sqlite-v1") {
        m.fitBounds(
          [
            [b[0], b[1]],
            [b[2], b[3]],
          ],
          { padding: 36, duration: 0 },
        );
      }
    });
    m.on("click", (e) => {
      if (!m.getLayer("parcel-fill")) return;
      const options = { layers: ["parcel-fill"] };
      const exact = m.queryRenderedFeatures(e.point, options);
      const features = exact.length
        ? exact
        : m.queryRenderedFeatures(
            [
              [e.point.x - 3, e.point.y - 3],
              [e.point.x + 3, e.point.y + 3],
            ],
            options,
          );
      const ids = [...new Set(features.map((f) => String(f.properties.bbl)))];
      if (ids.length) latest.current.onSelect(ids);
    });
    m.on("mousemove", (e) => {
      if (!m.getLayer("parcel-fill")) return;
      const f = m.queryRenderedFeatures(e.point, {
        layers: ["parcel-fill"],
      })[0];
      m.getCanvas().style.cursor = f ? "pointer" : "";
      m.setFilter("parcel-hover", [
        "==",
        ["get", "bbl"],
        f ? String(f.properties.bbl) : "",
      ]);
    });
    m.on("moveend", () => {
      const b = m.getBounds(),
        c = m.getCenter();
      latest.current.onMove(
        [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
        { lng: c.lng, lat: c.lat, zoom: m.getZoom() },
      );
    });
    m.on("error", (e) => {
      if (e.error?.message?.includes("WebGL"))
        setMapError(
          "The map needs WebGL. You can still research properties using search and the result list.",
        );
    });
    return () => {
      setReady(false);
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    for (const id of ["parcel-selected-fill", "parcel-selected-line"])
      m.setFilter(id, ["==", ["get", "bbl"], props.selected || ""]);
  }, [ready, props.selected]);
  useEffect(() => {
    if (ready)
      map.current?.setFilter("parcel-hover", [
        "==",
        ["get", "bbl"],
        props.hovered || "",
      ]);
  }, [ready, props.hovered]);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const match: FilterSpecification = props.matching
      ? ["in", ["get", "bbl"], ["literal", props.matching]]
      : ["==", ["get", "bbl"], ""];
    m.setFilter("parcel-matches", match);
    m.setPaintProperty(
      "parcel-fill",
      "fill-opacity",
      props.imagery ? 0.035 : props.matching !== null ? 0.15 : 0.4,
    );
  }, [ready, props.matching, props.imagery]);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    for (const id of [
      "parcel-fill",
      "parcel-line",
      "parcel-matches",
      "parcel-label",
    ])
      m.setLayoutProperty(id, "visibility", props.parcels ? "visible" : "none");
    for (const id of ["coverage-fill", "coverage-line"])
      m.setLayoutProperty(
        id,
        "visibility",
        props.boundary ? "visible" : "none",
      );
    m.setPaintProperty(
      "parcel-fill",
      "fill-color",
      props.colored ? landUseColors : "#e3dfd3",
    );
  }, [ready, props.parcels, props.boundary, props.colored]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.setLayoutProperty(
      "aerial",
      "visibility",
      props.imagery ? "visible" : "none",
    );
    m.setLayoutProperty(
      "basemap",
      "visibility",
      props.imagery ? "none" : "visible",
    );
    m.setPaintProperty(
      "parcel-line",
      "line-color",
      props.imagery ? "#e7eac6" : "#747e7e",
    );
    m.setPaintProperty(
      "parcel-selected-fill",
      "fill-opacity",
      props.imagery ? 0.12 : 0.24,
    );
    if (m.getLayer("building-fill"))
      m.setPaintProperty(
        "building-fill",
        "fill-opacity",
        props.imagery ? 0.035 : 0.22,
      );
    for (const id of ["building-fill", "building-line"])
      if (m.getLayer(id))
        m.setLayoutProperty(
          id,
          "visibility",
          props.buildings ? "visible" : "none",
        );
    if (m.getLayer("building-line"))
      m.setPaintProperty(
        "building-line",
        "line-color",
        props.imagery ? "#8fddff" : "#5b798d",
      );
  }, [ready, props.imagery, props.buildings]);
  return (
    <>
      <div
        ref={container}
        className="map-canvas"
        aria-label="Interactive Brooklyn parcel map"
        data-testid="parcel-map"
      />
      {mapError && <div className="map-error">{mapError}</div>}
      <div className="map-controls" role="group" aria-label="Map navigation">
        <button
          aria-label="Reset map bearing"
          title="Reset north"
          onClick={() => map.current?.easeTo({ bearing: 0, pitch: 0 })}
        >
          <Compass size={19} />
        </button>
        <button aria-label="Zoom in" onClick={() => map.current?.zoomIn()}>
          <Plus size={20} />
        </button>
        <button aria-label="Zoom out" onClick={() => map.current?.zoomOut()}>
          <Minus size={20} />
        </button>
        <button
          aria-label="Zoom to imported coverage"
          title="Imported coverage"
          onClick={() =>
            map.current?.fitBounds(
              [
                [props.coverage.bounds[0], props.coverage.bounds[1]],
                [props.coverage.bounds[2], props.coverage.bounds[3]],
              ],
              { padding: 90, duration: 600 },
            )
          }
        >
          <LocateFixed size={19} />
        </button>
        <button type="button" aria-label="Map layers" title="Map layers"
          aria-expanded={props.layersOpen} onClick={props.onToggleLayers}>
          <Layers3 size={19} strokeWidth={1.7} />
        </button>
      </div>
    </>
  );
});
export default ParcelMap;

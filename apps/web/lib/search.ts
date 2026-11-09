import { Bounds, PropertySummary } from "./model";
export type Sort = "relevance" | "address" | "lot_desc" | "assessment_desc";
export interface Filters {
  uses: string[];
  minLot: number | null;
  maxLot: number | null;
  minYear: number | null;
  maxYear: number | null;
  minAssessment: number | null;
  maxAssessment: number | null;
  hasRecords: boolean;
  includeUnknown: boolean;
}
export interface SearchState {
  q: string;
  filters: Filters;
  bounds: Bounds | null;
  sort: Sort;
}
export interface PublicState extends SearchState {
  selected: string | null;
  camera: { lng: number; lat: number; zoom: number } | null;
}
export const defaultFilters = (): Filters => ({
  uses: [],
  minLot: null,
  maxLot: null,
  minYear: null,
  maxYear: null,
  minAssessment: null,
  maxAssessment: null,
  hasRecords: false,
  includeUnknown: false,
});
const places = [
  "brooklyn",
  "kings county",
  "brooklyn ny",
  "brooklyn, ny",
  "dumbo",
  "brooklyn heights",
  "downtown brooklyn",
];
const unsupported =
  /\b(new jersey|jersey city|hudson|manhattan|queens|bronx|staten island|hoboken|newark|albany)\b/i;
const clean = (s: string) =>
  s.toUpperCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
const inRange = (
  value: number | null,
  min: number | null,
  max: number | null,
  unknown: boolean,
) => {
  if (min === null && max === null) return true;
  if (value === null || !Number.isFinite(value)) return unknown;
  return (min === null || value >= min) && (max === null || value <= max);
};
export function searchProperties(
  properties: PropertySummary[],
  state: SearchState,
) {
  const q = clean(state.q);
  const isPlace = places.includes(state.q.toLowerCase().trim());
  const f = state.filters;
  if (unsupported.test(state.q))
    return {
      results: [] as PropertySummary[],
      total: 0,
      status: "outside_coverage" as const,
      isPlace: false,
    };
  const words = q.split(" ").filter(Boolean);
  const results = properties.filter((p) => {
    if (
      q &&
      !isPlace &&
      p.bbl !== q &&
      !words.every((w) => clean(p.address).includes(w))
    )
      return false;
    if (f.uses.length && !f.uses.includes(p.land_use || "")) return false;
    if (
      !inRange(p.lot_area, f.minLot, f.maxLot, f.includeUnknown) ||
      !inRange(p.year_built, f.minYear, f.maxYear, f.includeUnknown) ||
      !inRange(
        p.assess_total === null ? null : Number(p.assess_total),
        f.minAssessment,
        f.maxAssessment,
        f.includeUnknown,
      )
    )
      return false;
    if (f.hasRecords && !p.record_count) return false;
    if (state.bounds) {
      const b = state.bounds;
      const a = p.bounds;
      if (a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3])
        return false;
    }
    return true;
  });
  const rank = (p: PropertySummary) =>
    p.bbl === q
      ? 0
      : clean(p.address) === q
        ? 1
        : clean(p.address).startsWith(q)
          ? 2
          : 3;
  results.sort((a, b) => {
    if (state.sort === "relevance" && q && !isPlace) {
      const r = rank(a) - rank(b);
      if (r) return r;
    }
    if (state.sort === "lot_desc") {
      const r = (b.lot_area ?? -Infinity) - (a.lot_area ?? -Infinity);
      if (r && !Number.isNaN(r)) return r;
    }
    if (state.sort === "assessment_desc") {
      const r = Number(b.assess_total ?? -1) - Number(a.assess_total ?? -1);
      if (r) return r;
    }
    return (
      a.address.localeCompare(b.address, undefined, { numeric: true }) ||
      a.bbl.localeCompare(b.bbl)
    );
  });
  return { results, total: results.length, status: "ok" as const, isPlace };
}
export function readPublicState(search: string): PublicState {
  const p = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const filters = defaultFilters();
  try {
    const raw = JSON.parse(p.get("filters") || "{}");
    filters.uses = Array.isArray(raw.uses)
      ? raw.uses.filter(
          (u: unknown) => typeof u === "string" && /^(?:[1-9]|10|11)$/.test(u),
        )
      : [];
    for (const key of [
      "minLot",
      "maxLot",
      "minYear",
      "maxYear",
      "minAssessment",
      "maxAssessment",
    ] as const) {
      if (
        typeof raw[key] === "number" &&
        Number.isFinite(raw[key]) &&
        raw[key] >= 0
      )
        filters[key] = raw[key];
    }
    filters.hasRecords = raw.hasRecords === true;
    filters.includeUnknown = raw.includeUnknown === true;
  } catch {
    /* Untrusted URLs use safe defaults. */
  }
  let bounds: Bounds | null = null;
  const rawBounds = p.get("bounds")?.split(",").map(Number);
  if (
    rawBounds?.length === 4 &&
    rawBounds.every(Number.isFinite) &&
    rawBounds[0] >= -180 &&
    rawBounds[2] <= 180 &&
    rawBounds[1] >= -85 &&
    rawBounds[3] <= 85 &&
    rawBounds[0] < rawBounds[2] &&
    rawBounds[1] < rawBounds[3]
  )
    bounds = rawBounds as Bounds;
  let camera: PublicState["camera"] = null;
  const map = p.get("map")?.split(",").map(Number);
  if (
    map?.length === 3 &&
    map.every(Number.isFinite) &&
    Math.abs(map[0]) <= 180 &&
    Math.abs(map[1]) <= 85 &&
    map[2] >= 0 &&
    map[2] <= 20
  )
    camera = { lng: map[0], lat: map[1], zoom: map[2] };
  const sort = p.get("sort") || "relevance";
  const selected = p.get("parcel");
  return {
    q: (p.get("q") || "").slice(0, 200),
    filters,
    bounds,
    sort: ["relevance", "address", "lot_desc", "assessment_desc"].includes(sort)
      ? (sort as Sort)
      : "relevance",
    selected: selected && /^3\d{9}$/.test(selected) ? selected : null,
    camera,
  };
}
export function publicUrl(state: PublicState): string {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (JSON.stringify(state.filters) !== JSON.stringify(defaultFilters()))
    p.set("filters", JSON.stringify(state.filters));
  if (state.bounds) p.set("bounds", state.bounds.join(","));
  if (state.sort !== "relevance") p.set("sort", state.sort);
  if (state.selected) p.set("parcel", state.selected);
  if (state.camera)
    p.set(
      "map",
      [
        state.camera.lng.toFixed(6),
        state.camera.lat.toFixed(6),
        state.camera.zoom.toFixed(2),
      ].join(","),
    );
  return "?" + p.toString();
}
export const formatNumber = (n: number | null | undefined) =>
  n === null || n === undefined ? "Not supplied" : n.toLocaleString("en-US");
export const formatMoney = (n: string | null | undefined) =>
  n === null || n === undefined
    ? "Not supplied"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(Number(n));
export const formatDate = (s: string | null | undefined) =>
  s
    ? new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(s.length === 10 ? s + "T00:00:00Z" : s))
    : "Not supplied";
export const titleAddress = (s: string) =>
  s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

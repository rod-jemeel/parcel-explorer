import { test } from "node:test";
import assert from "node:assert/strict";
import {
  searchProperties,
  defaultFilters,
  readPublicState,
  publicUrl,
} from "../apps/web/lib/search";
import type { PropertySummary } from "../apps/web/lib/model";

// Explicit synthetic fixtures. A null lot area must never be treated as zero.
const properties = [
  {
    bbl: "3000010050",
    address: "10 JAY STREET",
    land_use: "5",
    lot_area: 19682,
    year_built: 1898,
    assess_total: "32960250",
    center: [-73.987, 40.704],
    bounds: [-73.988, 40.703, -73.986, 40.705],
    record_count: 1,
  },
  {
    bbl: "3000020001",
    address: "100 JAY STREET",
    land_use: "1",
    lot_area: 2000,
    year_built: 1920,
    assess_total: "10000",
    center: [-73.981, 40.699],
    bounds: [-73.982, 40.698, -73.98, 40.7],
    record_count: 0,
  },
  {
    bbl: "3000030001",
    address: "50 TEST STREET",
    land_use: "2",
    lot_area: null,
    year_built: null,
    assess_total: null,
    center: [-73.979, 40.697],
    bounds: [-73.98, 40.696, -73.978, 40.698],
    record_count: 0,
  },
] as PropertySummary[];

test("exact BBL ranks first, case-insensitive address search is deterministic", () => {
  assert.equal(
    searchProperties(properties, {
      q: "3000010050",
      filters: defaultFilters(),
      bounds: null,
      sort: "relevance",
    }).results[0].bbl,
    "3000010050",
  );
  assert.deepEqual(
    searchProperties(properties, {
      q: "jay street",
      filters: defaultFilters(),
      bounds: null,
      sort: "relevance",
    }).results.map((x) => x.bbl),
    ["3000010050", "3000020001"],
  );
});
test("OR within uses and AND across numeric ranges excludes unknown", () => {
  const f = { ...defaultFilters(), uses: ["1", "2"], maxLot: 3000 };
  assert.deepEqual(
    searchProperties(properties, {
      q: "",
      filters: f,
      bounds: null,
      sort: "relevance",
    }).results.map((x) => x.bbl),
    ["3000020001"],
  );
  f.includeUnknown = true;
  assert.equal(
    searchProperties(properties, {
      q: "",
      filters: f,
      bounds: null,
      sort: "relevance",
    }).total,
    2,
  );
});
test("committed bounds constrain results and uncommitted camera is not search state", () => {
  assert.equal(
    searchProperties(properties, {
      q: "",
      filters: defaultFilters(),
      bounds: [-73.99, 40.702, -73.985, 40.708],
      sort: "relevance",
    }).total,
    1,
  );
  assert.equal(
    searchProperties(properties, {
      q: "",
      filters: defaultFilters(),
      bounds: null,
      sort: "relevance",
    }).total,
    3,
  );
});
test("supported place scopes discovery; unsupported geography has distinct status", () => {
  assert.equal(
    searchProperties(properties, {
      q: "Kings County",
      filters: defaultFilters(),
      bounds: null,
      sort: "relevance",
    }).total,
    3,
  );
  assert.equal(
    searchProperties(properties, {
      q: "Jersey City",
      filters: defaultFilters(),
      bounds: null,
      sort: "relevance",
    }).status,
    "outside_coverage",
  );
});
test("shareable state roundtrips selection, filters and camera while rejecting private notes", () => {
  const url = publicUrl({
    q: "10 Jay Street",
    filters: { ...defaultFilters(), uses: ["5"], minYear: 1800 },
    bounds: null,
    sort: "address",
    selected: "3000010050",
    camera: { lng: -73.99, lat: 40.7, zoom: 16 },
  });
  const state = readPublicState(url);
  assert.equal(state.q, "10 Jay Street");
  assert.equal(state.selected, "3000010050");
  assert.deepEqual(state.filters.uses, ["5"]);
  assert.equal(state.camera?.zoom, 16);
  assert.equal(url.includes("note"), false);
  assert.equal(
    readPublicState("?filters=%7B%22minLot%22%3A-5%7D").filters.minLot,
    null,
  );
  assert.equal(readPublicState("?map=999,999,99").camera, null);
});
test("assessment and unknown filter agree with imported record count", () => {
  const f = { ...defaultFilters(), minAssessment: 100000, hasRecords: true };
  assert.deepEqual(
    searchProperties(properties, {
      q: "",
      filters: f,
      bounds: null,
      sort: "relevance",
    }).results.map((x) => x.bbl),
    ["3000010050"],
  );
});

# Brooklyn Parcel Explorer Implementation Plan

> **For agentic workers:** Execute tasks inline using the executing-plans workflow. Track completed tasks here.

**Goal:** Deliver a runnable private local Brooklyn research pilot using real imported government records and a persistent parcel map.

**Architecture:** Next.js/TypeScript with MapLibre renders versioned local vector tiles. A reproducible Python importer retains raw snapshots and publishes validated releases atomically. A portable snapshot supports a self-contained local pilot; FastAPI exposes the same published records. PostGIS schema and Compose provide the production migration path, without pretending that an unavailable Docker engine was tested.

**Tech Stack:** Next.js, React, TypeScript, MapLibre, TanStack Query, Python, FastAPI, SQLite snapshot cache, vector MVT files; PostGIS/Martin deployment definitions.

**Spec:** ../../product-spec.md

## Global constraints

- Government evidence only; synthetic fixtures never enter published data.
- Map never remounts on selection or tab changes; inspector at most 30% at 1280px+.
- Address, BBL and place search; filters use AND across categories; unknown is not zero.
- Committed map-area search differs from camera movement.
- Source editions, retrieval dates and actual import boundaries remain visible.
- Recording date controls the ACRIS 2016 window; money semantics and multi-property links survive normalization.
- Private notes stay outside URLs. This local prototype stores research on the device; multiuser authentication is a later release gate.

## Review focus

- Ambiguous footprints: condo billing geometries do not establish unit history.
- Slow responses: obsolete selection and search work cannot replace current data.
- Failed/truncated imports: preserve prior release and require count/hash validation.
- Unknown numbers: range filters exclude null unless explicitly included.
- Out-of-scope places: distinguish unsupported coverage from no matches.

### Task 1: Validated import and identity

**Files:** services/ingestion/{domain,import_pilot}.py; tests/test_domain.py; data/raw; docs/source-register.md.
**Interfaces:** normalize_bbl(borough,block,lot) -> str; normalize_document(master,legals) -> dict; import CLI publishes release manifest, search index, block-sharded profiles and geometry archive.
- [ ] Write and run failing identity, date-basis, zero-consideration, multi-property and null-filter tests.
- [ ] Implement normalization and paginated ArcGIS/Socrata acquisition with retries, hashes and checkpoints.
- [ ] Import a deliberately bounded Brooklyn area; include actual linked DOF sales and bounded ACRIS documents, keeping coverage explicit per source.
- [ ] Verify keys/counts and rerun against cached snapshots to demonstrate idempotence.

### Task 2: Search and vector map

**Files:** apps/web/app; apps/web/components; apps/web/lib; scripts/build-tiles.mjs; tests/search.test.ts.
**Interfaces:** one SearchState drives indexed results and matching vector tile styling; profiles lazy-load by block; release ID selects all assets.
- [ ] Test exact BBL ranking, AND/OR filters, unknown handling, committed bounds and unsupported geography.
- [ ] Implement search state, paged results, keyboard suggestions, versioned MVT delivery and persistent map selection.
- [ ] Build the map-first desktop layout and mobile sheet; verify navigation restores camera/query/selection.

### Task 3: Research and local API

**Files:** components/Inspector.tsx; services/api/main.py; tests/test_api.py; infra; db/schema.sql.
**Interfaces:** coverage/profile/history endpoints require release_id; unknown releases return 410; local-only API binds loopback.
- [ ] Test release mismatch, bounded API input and record provenance.
- [ ] Implement lazy tabs for overview/history/transfers/assessments/sources and honest condo relationship status.
- [ ] Implement device-local bookmarks/notes with explicit storage description and export, excluding notes from URL state.
- [ ] Provide reproducible local launch commands, PostGIS/Martin production schema and deployment/runbook limitations.

### Task 4: Verification and handover

**Files:** tests/browser; README.md; docs/verification.md; screenshots.
- [ ] Run Python/TypeScript suites and production build.
- [ ] Verify source-to-UI ordinary parcel, condo footprint and multi-property document cases when actual source data supplies them.
- [ ] Exercise search, map selection, filters, area search, back navigation, tabs, notes, keyboard and mobile layout in a browser.
- [ ] Record measured scope and known production release gates. Keep the preview accessible locally.

## Decisions / progress

- User selected a new local project and private pilot. No external publication or public repository is required.
- Docker CLI exists but server version is null; local delivery must work without Docker.
- Initial bounded coverage: DUMBO, Brooklyn Heights and Downtown Brooklyn, 5,628 intersecting source features at discovery. Broader Brooklyn remains explicit future import coverage.

"use client";
import { useState } from "react";
import {
  Bookmark,
  ChevronRight,
  Download,
  Info,
  Layers3,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Coverage, LAND_USES, PropertySummary, USE_COLORS } from "@/lib/model";
import {
  defaultFilters,
  Filters,
  formatNumber,
  titleAddress,
} from "@/lib/search";
import { SavedResearch, SourcesContent } from "./Inspector";
export type Tool = "filters" | "layers" | "saved" | "coverage" | null;
export function ToolPanel({
  tool,
  onClose,
  children,
}: {
  tool: Exclude<Tool, null>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const title = {
    filters: "Property filters",
    layers: "Map layers",
    saved: "Saved research",
    coverage: "Sources & coverage",
  }[tool];
  return (
    <section
      className={`tool-panel ${tool === "coverage" ? "coverage-panel" : ""}`}
      aria-label={title}
    >
      <div className="tool-header">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label={`Close ${title.toLowerCase()}`}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </section>
  );
}
export function FilterPanel({
  filters,
  onApply,
}: {
  filters: Filters;
  onApply: (f: Filters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  const update = (key: keyof Filters, value: unknown) =>
    setDraft((f) => ({ ...f, [key]: value }));
  const ranges: [keyof Filters, keyof Filters, string, string][] = [
    ["minLot", "maxLot", "Reported lot area", "sq ft"],
    ["minYear", "maxYear", "Year built", "year"],
    ["minAssessment", "maxAssessment", "Snapshot assessed amount", "USD"],
  ];
  const invalid = ranges.some(
    ([a, b]) =>
      draft[a] !== null &&
      draft[b] !== null &&
      Number(draft[a]) > Number(draft[b]),
  );
  return (
    <>
      <div className="tool-scroll">
        <p className="tool-description">
          Find properties in the imported Brooklyn area. Filters combine across
          categories.
        </p>
        <fieldset className="filter-fieldset">
          <legend>Property use</legend>
          {Object.entries(LAND_USES).map(([id, label]) => (
            <label key={id} className="check-row">
              <input
                type="checkbox"
                checked={draft.uses.includes(id)}
                onChange={() =>
                  update(
                    "uses",
                    draft.uses.includes(id)
                      ? draft.uses.filter((v) => v !== id)
                      : [...draft.uses, id],
                  )
                }
              />
              <span
                className="use-swatch"
                style={{ background: USE_COLORS[id] }}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        {ranges.map(([min, max, label, unit]) => (
          <fieldset className="filter-fieldset" key={min}>
            <legend>
              {label}
              <span>{unit}</span>
            </legend>
            <div className="range-inputs">
              <label>
                <span>Minimum</span>
                <input
                  type="number"
                  min="0"
                  aria-label={`Minimum ${label.toLowerCase()}`}
                  placeholder="No min"
                  value={draft[min] === null ? "" : String(draft[min])}
                  onChange={(e) =>
                    update(
                      min,
                      e.target.value === ""
                        ? null
                        : Math.max(0, Number(e.target.value)),
                    )
                  }
                />
              </label>
              <span>–</span>
              <label>
                <span>Maximum</span>
                <input
                  type="number"
                  min="0"
                  aria-label={`Maximum ${label.toLowerCase()}`}
                  placeholder="No max"
                  value={draft[max] === null ? "" : String(draft[max])}
                  onChange={(e) =>
                    update(
                      max,
                      e.target.value === ""
                        ? null
                        : Math.max(0, Number(e.target.value)),
                    )
                  }
                />
              </label>
            </div>
            {min === "minAssessment" && (
              <small className="muted-copy">
                MapPLUTO observation; tax year not supplied.
              </small>
            )}
          </fieldset>
        ))}
        <fieldset className="filter-fieldset">
          <legend>Available imported records</legend>
          <label className="check-row">
            <input
              type="checkbox"
              checked={draft.hasRecords}
              onChange={(e) => update("hasRecords", e.target.checked)}
            />
            Has a linked historical record
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={draft.includeUnknown}
              onChange={(e) => update("includeUnknown", e.target.checked)}
            />
            Include unknown values in ranges
          </label>
          <p className="muted-copy">
            Historical coverage is partial. A missing record does not establish
            that no record exists.
          </p>
        </fieldset>
        {invalid && (
          <p role="alert" className="validation-error">
            Minimum must be less than or equal to maximum.
          </p>
        )}
      </div>
      <div className="tool-footer">
        <button
          className="text-button"
          onClick={() => setDraft(defaultFilters())}
        >
          Reset filters
        </button>
        <button
          className="primary-button"
          disabled={invalid}
          onClick={() => onApply(draft)}
        >
          Apply filters
        </button>
      </div>
    </>
  );
}
export function LayersPanel({
  parcels,
  boundary,
  colored,
  onParcels,
  onBoundary,
  onColored,
  coverage,
  imagery,
  onImagery,
  buildings,
  onBuildings,
}: {
  imagery: boolean;
  onImagery: (v: boolean) => void;
  buildings: boolean;
  onBuildings: (v: boolean) => void;
  parcels: boolean;
  boundary: boolean;
  colored: boolean;
  onParcels: (v: boolean) => void;
  onBoundary: (v: boolean) => void;
  onColored: (v: boolean) => void;
  coverage: Coverage;
}) {
  return (
    <div className="tool-scroll">
      <p className="tool-description">
        Current parcel footprints over a light street map.
      </p>
      <label className="layer-row">
        <div>
          <strong>Parcel boundaries</strong>
          <span>MapPLUTO {coverage.source_edition}</span>
        </div>
        <input
          role="switch"
          type="checkbox"
          checked={parcels}
          onChange={(e) => onParcels(e.target.checked)}
        />
      </label>
      <label className="layer-row">
        <div>
          <strong>Land use colors</strong>
          <span>Government-reported property use</span>
        </div>
        <input
          role="switch"
          type="checkbox"
          checked={colored}
          onChange={(e) => onColored(e.target.checked)}
        />
      </label>
      <label className="layer-row">
        <div>
          <strong>Import coverage</strong>
          <span>Bounded Brooklyn pilot area</span>
        </div>
        <input
          role="switch"
          type="checkbox"
          checked={boundary}
          onChange={(e) => onBoundary(e.target.checked)}
        />
      </label>
      <label className="layer-row">
        <div>
          <strong>Building footprints</strong>
          <span>Official OTI outlines, at street zoom</span>
        </div>
        <input
          role="switch"
          type="checkbox"
          checked={buildings}
          onChange={(e) => onBuildings(e.target.checked)}
        />
      </label>
      <label className="layer-row">
        <div>
          <strong>Imagery view · 2024</strong>
          <span>Official NYC OTI imagery; not a live photo</span>
        </div>
        <input
          role="switch"
          type="checkbox"
          checked={imagery}
          onChange={(e) => onImagery(e.target.checked)}
        />
      </label>
      <div className="legend">
        <h3>Land use legend</h3>
        {Object.entries(LAND_USES).map(([key, label]) => (
          <div key={key}>
            <span style={{ background: USE_COLORS[key] }} />
            {label}
          </div>
        ))}
      </div>
      <div className="unavailable-layer">
        <Layers3 size={17} />
        <div>
          <strong>Additional overlays</strong>
          <p>
            Historical parcel boundaries and zoning polygons are not imported.
            Zoning text is available in property profiles.
          </p>
        </div>
      </div>
    </div>
  );
}
export function SavedPanel({
  saved,
  properties,
  onSelect,
  onExport,
}: {
  saved: Record<string, SavedResearch>;
  properties: PropertySummary[];
  onSelect: (p: PropertySummary) => void;
  onExport: () => void;
}) {
  const rows = Object.values(saved)
    .map((s) => ({ saved: s, p: properties.find((p) => p.bbl === s.bbl) }))
    .filter((r) => r.p);
  return (
    <>
      <div className="tool-scroll">
        <div className="device-notice">
          <Info size={15} />
          <p>
            Saved only in this browser on this device. Export a copy to keep
            your notes.
          </p>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">
            <Bookmark size={28} />
            <h3>Your research starts here</h3>
            <p>Open a property and bookmark it, or add a research note.</p>
          </div>
        ) : (
          rows.map(({ saved: s, p }) => (
            <button
              className="saved-row"
              key={s.bbl}
              onClick={() => onSelect(p!)}
            >
              <Bookmark size={16} />
              <span>
                <strong>{titleAddress(p!.address)}</strong>
                <small>BBL {s.bbl}</small>
                {s.note && <em>{s.note.slice(0, 90)}</em>}
              </span>
              <ChevronRight size={16} />
            </button>
          ))
        )}
      </div>
      <div className="tool-footer">
        <span className="muted-copy">{rows.length} saved properties</span>
        <button
          className="secondary-button"
          onClick={onExport}
          disabled={!rows.length}
        >
          <Download size={14} />
          Export research
        </button>
      </div>
    </>
  );
}

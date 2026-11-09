"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Command,
  CornerDownLeft,
  FileText,
  Info,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  Search,
  SlidersHorizontal,
  SquareStack,
  X,
} from "lucide-react";
import { getCoverage, getIndex } from "@/lib/data";
import { Bounds, LAND_USES, PropertySummary } from "@/lib/model";
import {
  defaultFilters,
  Filters,
  formatNumber,
  PublicState,
  publicUrl,
  readPublicState,
  searchProperties,
  Sort,
  titleAddress,
} from "@/lib/search";
import Inspector, { SavedResearch, SourcesContent } from "./Inspector";
import { FilterPanel, LayersPanel, SavedPanel, Tool, ToolPanel } from "./Tools";
import type { MapHandle } from "./ParcelMap";
const ParcelMap = dynamic(() => import("./ParcelMap"), {
  ssr: false,
  loading: () => (
    <div className="map-loading">
      <LoaderCircle className="spinner" size={24} />
      <span>Preparing parcel map…</span>
    </div>
  ),
});
const STORAGE_KEY = "parcel-explorer:local-research:v1";
const initial: PublicState = {
  q: "",
  filters: defaultFilters(),
  bounds: null,
  sort: "relevance",
  selected: null,
  camera: null,
};
export default function Explorer() {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <Workspace />
    </QueryClientProvider>
  );
}
function Workspace() {
  const [state, setState] = useState<PublicState>(initial);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [debounced, setDebounced] = useState("");
  const [tool, setTool] = useState<Tool>(null);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(40);
  const [parcels, setParcels] = useState(true);
  const [boundary, setBoundary] = useState(true);
  const [colored, setColored] = useState(true);
  const [imagery, setImagery] = useState(true);
  const [buildings, setBuildings] = useState(true);
  const [saved, setSaved] = useState<Record<string, SavedResearch>>({});
  const [toast, setToast] = useState("");
  const [viewBounds, setViewBounds] = useState<Bounds | null>(null);
  const [areaMoved, setAreaMoved] = useState(false);
  const [candidates, setCandidates] = useState<string[]>([]);
  const mapRef = useRef<MapHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const scrollPosition = useRef(0);
  const lastFocus = useRef<HTMLElement | null>(null);
  const {
    data: coverage,
    error: coverageError,
    refetch: refetchCoverage,
  } = useQuery({
    queryKey: ["coverage"],
    queryFn: ({ signal }) => getCoverage(signal),
    staleTime: Infinity,
  });
  const {
    data: properties = [],
    isPending: indexPending,
    error: indexError,
    refetch: refetchIndex,
  } = useQuery({
    queryKey: ["index", coverage?.release_id],
    queryFn: ({ signal }) => getIndex(coverage!.release_id, signal),
    enabled: !!coverage,
    staleTime: Infinity,
  });
  useEffect(() => {
    const s = readPublicState(location.search);
    setState(s);
    setInput(s.q);
    setHasSearched(
      !!s.q ||
        !!s.bounds ||
        JSON.stringify(s.filters) !== JSON.stringify(defaultFilters()),
    );
    setResultsOpen(!!s.q && !s.selected);
    setInspectorOpen(!!s.selected);
    setExpanded(!!s.selected);
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const valid: Record<string, SavedResearch> = {};
        for (const [bbl, value] of Object.entries(raw)) {
          const s = value as SavedResearch;
          if (/^3\d{9}$/.test(bbl) && s && typeof s.note === "string")
            valid[bbl] = {
              bbl,
              note: s.note.slice(0, 10000),
              savedAt: typeof s.savedAt === "string" ? s.savedAt : "",
              bookmarked: s.bookmarked !== false,
            };
        }
        setSaved(valid);
      }
    } catch {
      setToast(
        "Saved research could not be read. You can still explore public records.",
      );
    }
    setHydrated(true);
    const pop = () => {
      const next = readPublicState(location.search);
      setState(next);
      setInput(next.q);
      setInspectorOpen(!!next.selected);
      setExpanded(!!next.selected);
      setTool(null);
      setResultsOpen(!next.selected && !!next.q);
      if (next.camera) mapRef.current?.camera(next.camera);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(input), 180);
    return () => clearTimeout(timer);
  }, [input]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const update = useCallback(
    (patch: Partial<PublicState>, push = true) => {
      const next = { ...stateRef.current, ...patch };
      stateRef.current = next;
      setState(next);
      const params = new URLSearchParams(publicUrl(next).slice(1));
      if (coverage) params.set("release", coverage.release_id);
      history[push ? "pushState" : "replaceState"](
        {},
        "",
        location.pathname + "?" + params.toString(),
      );
    },
    [coverage],
  );
  const search = useMemo(
    () => searchProperties(properties, state),
    [properties, state.q, state.filters, state.bounds, state.sort],
  );
  const suggestions = useMemo(() => {
    if (!debounced.trim()) return [];
    return searchProperties(properties, {
      ...state,
      q: debounced,
      bounds: null,
      filters: defaultFilters(),
    }).results.slice(0, 6);
  }, [properties, debounced]);
  const selected = useMemo(
    () => properties.find((p) => p.bbl === state.selected),
    [properties, state.selected],
  );
  const activeFilterCount =
    state.filters.uses.length +
    (
      [
        "minLot",
        "maxLot",
        "minYear",
        "maxYear",
        "minAssessment",
        "maxAssessment",
      ] as const
    ).filter((k) => state.filters[k] !== null).length +
    Number(state.filters.hasRecords) +
    Number(state.filters.includeUnknown);
  const matching = useMemo(
    () => (hasSearched ? search.results.map((p) => p.bbl) : null),
    [search.results, hasSearched],
  );
  const selectedOutside =
    selected && viewBounds
      ? selected.bounds[2] < viewBounds[0] ||
        selected.bounds[0] > viewBounds[2] ||
        selected.bounds[3] < viewBounds[1] ||
        selected.bounds[1] > viewBounds[3]
      : false;
  const closeTool = () => {
    setTool(null);
    lastFocus.current?.focus();
  };
  const toggleTool = (next: Tool) => {
    lastFocus.current = document.activeElement as HTMLElement;
    setTool(tool === next ? null : next);
    setSuggestionsOpen(false);
    setResultsOpen(false);
    setInspectorOpen(false);
  };
  const selectProperty = (p: PropertySummary, fit: boolean) => {
    if (resultsRef.current)
      scrollPosition.current = resultsRef.current.scrollTop;
    update({ selected: p.bbl });
    setInspectorOpen(true);
    setExpanded(true);
    setResultsOpen(false);
    setSuggestionsOpen(false);
    setTool(null);
    setCandidates([]);
    setTimeout(() => {
      if (fit) mapRef.current?.fit(p.bounds, true);
      else mapRef.current?.ensureVisible(p.center);
    }, 50);
    searchRef.current?.blur();
  };
  const submit = (value = input) => {
    setInput(value);
    setSuggestionsOpen(false);
    setSuggestionIndex(-1);
    setTool(null);
    setInspectorOpen(false);
    setResultsOpen(true);
    setHasSearched(true);
    setVisibleCount(40);
    update({ q: value, selected: state.selected });
    if (
      [
        "brooklyn",
        "kings county",
        "dumbo",
        "brooklyn heights",
        "downtown brooklyn",
      ].includes(value.trim().toLowerCase())
    )
      mapRef.current?.reset();
    searchRef.current?.blur();
  };
  const returnToResults = () => {
    setInspectorOpen(false);
    if (hasSearched) {
      setResultsOpen(true);
      setTimeout(() => {
        if (resultsRef.current)
          resultsRef.current.scrollTop = scrollPosition.current;
      }, 0);
    } else searchRef.current?.focus();
  };
  const clearSearch = () => {
    setInput("");
    setSuggestionsOpen(false);
    setHasSearched(false);
    setResultsOpen(false);
    setVisibleCount(40);
    update({ q: "", filters: defaultFilters(), bounds: null });
  };
  const persist = (next: Record<string, SavedResearch>) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSaved(next);
      return true;
    } catch {
      setToast(
        "Could not save on this device. Browser storage may be full or disabled.",
      );
      return false;
    }
  };
  const toggleSaved = (bbl: string) => {
    const next = { ...saved };
    if (next[bbl]?.bookmarked) {
      if (next[bbl].note) next[bbl] = { ...next[bbl], bookmarked: false };
      else delete next[bbl];
    } else
      next[bbl] = {
        ...next[bbl],
        bbl,
        note: next[bbl]?.note || "",
        savedAt: new Date().toISOString(),
        bookmarked: true,
      };
    if (persist(next))
      setToast(
        next[bbl]?.bookmarked
          ? "Property bookmarked on this device"
          : "Bookmark removed; any research note is preserved",
      );
  };
  const saveNote = (bbl: string, note: string) => {
    if (
      persist({
        ...saved,
        [bbl]: {
          ...saved[bbl],
          bbl,
          note,
          savedAt: new Date().toISOString(),
          bookmarked: saved[bbl]?.bookmarked ?? true,
        },
      })
    )
      setToast("Research note saved on this device");
  };
  const share = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setToast("View link copied. Private notes are excluded.");
    } catch {
      setToast("Copy the address from your browser to share this view.");
    }
  };
  const exportResearch = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            format: "parcel-explorer-local-research-v1",
            exportedAt: new Date().toISOString(),
            release_id: coverage?.release_id,
            properties: Object.values(saved),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "parcel-explorer-research.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        setSuggestionsOpen(true);
      }
      if (e.key === "Escape") {
        if (suggestionsOpen) setSuggestionsOpen(false);
        else if (candidates.length) setCandidates([]);
        else if (tool) closeTool();
        else if (inspectorOpen) setInspectorOpen(false);
        else if (resultsOpen) setResultsOpen(false);
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [tool, inspectorOpen, resultsOpen, suggestionsOpen, candidates]);
  useEffect(() => {
    if (hydrated && coverage) {
      const old = new URLSearchParams(location.search).get("release");
      if (old && old !== coverage.release_id)
        setToast(
          "The shared view used an older release. Map and records now use the current release together.",
        );
    }
  }, [hydrated, coverage]);
  return (
    <div className="workspace">
      <header className="app-header">
        <a className="brand" href="/" aria-label="Parcel Explorer home">
          <span className="brand-mark">
            <SquareStack size={23} strokeWidth={1.5} />
          </span>
          <span>
            Parcel <strong>Explorer</strong>
          </span>
        </a>
        <span className="header-divider" />
        <button
          className="jurisdiction-button"
          onClick={() => toggleTool("coverage")}
        >
          <MapPin size={14} />
          <span>Brooklyn, NY</span>
          <ChevronDown size={13} />
        </button>
        <span className="pilot-badge">Local pilot</span>
        <div className="header-spacer" />
        <button
          className="header-source-button"
          onClick={() => toggleTool("coverage")}
        >
          <span className="status-dot" />
          Sources & coverage
        </button>
        <button
          className="header-saved"
          title="Saved research"
          aria-label="Open saved research"
          onClick={() => toggleTool("saved")}
        >
          <Bookmark size={17} />
          <span>Saved</span>
          {Object.keys(saved).length > 0 && (
            <small>{Object.keys(saved).length}</small>
          )}
        </button>
        <div
          className="workspace-identity"
          title="Local workspace. Data is stored on this device."
        >
          <LockKeyhole size={13} />
          <span>My workspace</span>
          <span className="avatar">R</span>
        </div>
      </header>
      <main
        className={`map-workspace ${inspectorOpen && expanded ? "detail-open" : ""}`}
      >
        {coverage && hydrated ? (
          <ParcelMap
            key={coverage.release_id}
            ref={mapRef}
            coverage={coverage}
            selected={state.selected}
            hovered={hovered}
            matching={matching}
            parcels={parcels}
            boundary={boundary}
            colored={colored}
            imagery={imagery}
            buildings={buildings}
            initialCamera={state.camera}
            onSelect={(ids) => {
              if (ids.length > 1) setCandidates(ids);
              else {
                const p = properties.find((p) => p.bbl === ids[0]);
                if (p) selectProperty(p, false);
              }
            }}
            onMove={(b, c) => {
              setViewBounds(b);
              setAreaMoved(true);
              const next = { ...stateRef.current, camera: c };
              stateRef.current = next;
              setState(next);
              const params = new URLSearchParams(publicUrl(next).slice(1));
              params.set("release", coverage.release_id);
              history.replaceState(
                {},
                "",
                location.pathname + "?" + params.toString(),
              );
            }}
          />
        ) : (
          <div className="map-loading">
            <LoaderCircle size={24} className="spinner" />
            <span>Loading published coverage…</span>
          </div>
        )}
        <div className="search-workspace">
          <form
            className="search-bar"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (suggestionIndex >= 0 && suggestions[suggestionIndex])
                selectProperty(suggestions[suggestionIndex], true);
              else submit();
            }}
          >
            <Search size={19} className="search-icon" />
            <input
              ref={searchRef}
              aria-label="Search address, parcel ID, city, or county"
              aria-expanded={suggestionsOpen && !!input}
              aria-controls="search-suggestions"
              aria-autocomplete="list"
              aria-activedescendant={
                suggestionIndex >= 0
                  ? "suggestion-" + suggestionIndex
                  : undefined
              }
              role="combobox"
              placeholder="Search address, parcel ID, city, or county"
              autoComplete="off"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setSuggestionsOpen(true);
                setSuggestionIndex(-1);
              }}
              onFocus={() => {
                if (input) setSuggestionsOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSuggestionsOpen(true);
                  setSuggestionIndex((v) =>
                    Math.min(v + 1, suggestions.length - 1),
                  );
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSuggestionIndex((v) => Math.max(-1, v - 1));
                }
              }}
            />
            {input ? (
              <button
                type="button"
                aria-label="Clear search input"
                className="icon-button input-clear"
                onClick={() => {
                  setInput("");
                  setSuggestionsOpen(false);
                  searchRef.current?.focus();
                }}
              >
                <X size={15} />
              </button>
            ) : (
              <kbd>⌘ K</kbd>
            )}
            <span className="search-divider" />
            <button
              type="button"
              className={
                "search-filter " +
                (tool === "filters" || activeFilterCount ? "active" : "")
              }
              aria-label="Open property filters"
              title="Property filters"
              onClick={() => toggleTool("filters")}
            >
              <SlidersHorizontal size={18} />
              {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
            </button>
            <button
              type="submit"
              className="search-submit"
              aria-label="Submit search"
            >
              <ArrowRight size={18} />
            </button>
          </form>
          {suggestionsOpen && input && (
            <div className="suggestions" id="search-suggestions" role="listbox">
              <div className="suggestion-label">Imported property matches</div>
              {suggestions.length ? (
                suggestions.map((p, i) => (
                  <button
                    key={p.bbl}
                    id={"suggestion-" + i}
                    role="option"
                    aria-selected={suggestionIndex === i}
                    className={suggestionIndex === i ? "focused" : ""}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectProperty(p, true)}
                  >
                    <MapPin size={16} />
                    <span>
                      <strong>{titleAddress(p.address)}</strong>
                      <small>Brooklyn · BBL {p.bbl}</small>
                    </span>
                    <CornerDownLeft size={13} />
                  </button>
                ))
              ) : (
                <p className="suggestion-empty">
                  Press Enter to search this area’s imported records.
                </p>
              )}
              <button className="all-results" onClick={() => submit()}>
                Search all matches for “{input}”<ArrowRight size={14} />
              </button>
            </div>
          )}
          {!suggestionsOpen && (hasSearched || activeFilterCount > 0) && (
            <div className="active-search-context">
              <button
                onClick={() => {
                  setResultsOpen((v) => !v);
                  setTool(null);
                  setInspectorOpen(false);
                }}
              >
                <Search size={12} />
                {formatNumber(search.total)} matching{" "}
                {search.total === 1 ? "property" : "properties"}
                <ChevronDown size={12} />
              </button>
              {state.bounds && (
                <button
                  className="area-chip"
                  onClick={() => update({ bounds: null })}
                >
                  Map area
                  <X size={11} />
                </button>
              )}
              {activeFilterCount > 0 && (
                <button onClick={() => toggleTool("filters")}>
                  {activeFilterCount} filters
                </button>
              )}
              <button
                aria-label="Clear query and filters"
                title="Clear query and filters"
                onClick={clearSearch}
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>
        <nav className="tool-rail" aria-label="Map tools">
          {(
            [
              { id: "layers", icon: Layers3, label: "Map layers" },
              {
                id: "filters",
                icon: SlidersHorizontal,
                label: "Property filters",
              },
              { id: "saved", icon: Bookmark, label: "Saved research" },
              { id: "coverage", icon: Info, label: "Sources and coverage" },
            ] as const
          ).map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              aria-label={label}
              title={label}
              aria-pressed={tool === id}
              className={tool === id ? "active" : ""}
              onClick={() => toggleTool(id)}
            >
              <Icon size={19} strokeWidth={1.7} />
              {id === "filters" && activeFilterCount > 0 && (
                <span className="rail-dot" />
              )}
            </button>
          ))}
        </nav>
        {coverage && areaMoved && (
          <button
            className="search-area-button"
            onClick={() => {
              const bounds = mapRef.current?.getBounds();
              if (bounds) {
                update({ bounds });
                setHasSearched(true);
                setResultsOpen(true);
                setInspectorOpen(false);
                setTool(null);
                setAreaMoved(false);
                setVisibleCount(40);
              }
            }}
          >
            <Search size={14} />
            Search this area
          </button>
        )}
        {tool && coverage && (
          <ToolPanel tool={tool} onClose={closeTool}>
            {tool === "filters" ? (
              <FilterPanel
                key={JSON.stringify(state.filters)}
                filters={state.filters}
                onApply={(f) => {
                  update({ filters: f });
                  setHasSearched(true);
                  setResultsOpen(true);
                  setTool(null);
                  setInspectorOpen(false);
                  setVisibleCount(40);
                }}
              />
            ) : tool === "layers" ? (
              <LayersPanel
                coverage={coverage}
                parcels={parcels}
                colored={colored}
                boundary={boundary}
                onParcels={setParcels}
                onColored={setColored}
                onBoundary={setBoundary}
                imagery={imagery}
                onImagery={setImagery}
                buildings={buildings}
                onBuildings={setBuildings}
              />
            ) : tool === "saved" ? (
              <SavedPanel
                saved={saved}
                properties={properties}
                onSelect={(p) => selectProperty(p, true)}
                onExport={exportResearch}
              />
            ) : (
              <div className="tool-scroll">
                <SourcesContent coverage={coverage} />
              </div>
            )}
          </ToolPanel>
        )}
        {resultsOpen && !tool && !inspectorOpen && (
          <section className="results-panel" aria-label="Search results">
            <div className="results-header">
              <div>
                <h2>
                  {state.q ? `Results for “${state.q}”` : "Explore properties"}
                </h2>
                <p>
                  {search.status === "outside_coverage"
                    ? "Outside imported coverage"
                    : `${formatNumber(search.total)} properties · ${formatNumber(search.total)} map footprints`}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Collapse search results"
                onClick={() => setResultsOpen(false)}
              >
                <X size={17} />
              </button>
            </div>
            <div className="results-controls">
              <span>Brooklyn pilot area</span>
              <label>
                <ArrowDownWideNarrow size={13} />
                <select
                  aria-label="Sort search results"
                  value={state.sort}
                  onChange={(e) => {
                    update({ sort: e.target.value as Sort });
                    setVisibleCount(40);
                  }}
                >
                  <option value="relevance">Best match</option>
                  <option value="address">Address A–Z</option>
                  <option value="lot_desc">Largest lot</option>
                  <option value="assessment_desc">Highest assessment</option>
                </select>
              </label>
            </div>
            <div className="results-scroll" ref={resultsRef}>
              {indexPending ? (
                <div className="empty-state">
                  <LoaderCircle className="spinner" />
                  <p>Loading imported address index…</p>
                </div>
              ) : search.status === "outside_coverage" ? (
                <div className="empty-state">
                  <MapPin size={28} />
                  <h3>That area isn’t imported yet</h3>
                  <p>
                    This pilot covers DUMBO, Brooklyn Heights, and Downtown
                    Brooklyn. New Jersey and other NYC boroughs are outside this
                    import.
                  </p>
                  <button
                    className="primary-button"
                    onClick={() => {
                      submit("Brooklyn");
                    }}
                  >
                    Explore Brooklyn coverage
                  </button>
                </div>
              ) : !search.total ? (
                <div className="empty-state">
                  <Search size={28} />
                  <h3>No matching imported properties</h3>
                  <p>
                    Try a partial street address, a 10-digit BBL, or remove a
                    filter. Historical coverage is partial.
                  </p>
                  <button className="secondary-button" onClick={clearSearch}>
                    Clear query & filters
                  </button>
                </div>
              ) : (
                search.results.slice(0, visibleCount).map((p) => (
                  <button
                    className={
                      "result-row " +
                      (p.bbl === state.selected ? "selected" : "")
                    }
                    key={p.bbl}
                    onClick={() => selectProperty(p, true)}
                    onMouseEnter={() => setHovered(p.bbl)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(p.bbl)}
                    onBlur={() => setHovered(null)}
                  >
                    <div className="result-location-icon">
                      <MapPin size={18} />
                    </div>
                    <div className="result-text">
                      <h3>{titleAddress(p.address)}</h3>
                      <p>
                        {p.entity_kind === "billing_group"
                          ? "Condo billing footprint"
                          : LAND_USES[p.land_use || ""] || "Tax lot"}
                      </p>
                      <div className="result-facts">
                        <span>{formatNumber(p.lot_area)} sq ft</span>
                        <span>Built {p.year_built || "unknown"}</span>
                        {p.record_count > 0 && (
                          <span>
                            <FileText size={10} />
                            {p.record_count}
                          </span>
                        )}
                      </div>
                      <small>BBL {p.bbl}</small>
                    </div>
                    <ChevronRight size={16} />
                  </button>
                ))
              )}
              {visibleCount < search.total && (
                <button
                  className="load-more"
                  onClick={() => setVisibleCount((v) => v + 40)}
                >
                  Load 40 more properties
                </button>
              )}
            </div>
            <div className="results-footer">
              <span className="source-dot" />
              MapPLUTO {coverage?.source_edition} · Exact imported count
            </div>
          </section>
        )}
        {candidates.length > 0 && (
          <div
            className="candidate-chooser"
            role="dialog"
            aria-label="Choose overlapping property"
          >
            <div className="tool-header">
              <h2>Choose a property</h2>
              <button
                className="icon-button"
                onClick={() => setCandidates([])}
                aria-label="Close overlapping property chooser"
              >
                <X size={16} />
              </button>
            </div>
            <p>
              This location touches multiple footprints. Choose the BBL you want
              to research.
            </p>
            {candidates.map((b) => {
              const p = properties.find((p) => p.bbl === b);
              return (
                p && (
                  <button key={b} onClick={() => selectProperty(p, false)}>
                    {titleAddress(p.address)}
                    <small>
                      {b} ·{" "}
                      {p.entity_kind === "billing_group"
                        ? "Condo billing footprint"
                        : "Tax lot"}
                    </small>
                  </button>
                )
              );
            })}
          </div>
        )}
        {inspectorOpen && selected && coverage && (
          <Inspector
            summary={selected}
            coverage={coverage}
            expanded={expanded}
            onExpand={() => {
              setExpanded(true);
              setTimeout(
                () => mapRef.current?.ensureVisible(selected.center),
                50,
              );
            }}
            onCollapse={() => setExpanded(false)}
            onClose={() => {
              setInspectorOpen(false);
              searchRef.current?.focus();
            }}
            onBack={returnToResults}
            onRecenter={() => mapRef.current?.fit(selected.bounds, true)}
            onImagery={() => {
              setImagery(true);
              setBuildings(true);
              mapRef.current?.fit(selected.bounds, true);
            }}
            outside={!!selectedOutside}
            saved={saved[selected.bbl]}
            onSave={toggleSaved}
            onNote={saveNote}
            onShare={share}
            hasResults={hasSearched}
          />
        )}
        {!inspectorOpen && !tool && !resultsOpen && coverage && (
          <div className="map-intro">
            <div className="map-intro-heading">
              <span className="status-dot" />
              <strong>Brooklyn, parcel by parcel.</strong>
            </div>
            <p>Click a lot to explore its government records.</p>
            <button onClick={() => toggleTool("coverage")}>
              {formatNumber(coverage.feature_count)} imported footprints
              <ChevronRight size={12} />
            </button>
          </div>
        )}
        <div
          className="basemap-toggle"
          role="group"
          aria-label="Map background"
        >
          <button
            aria-pressed={!imagery}
            className={!imagery ? "active" : ""}
            onClick={() => setImagery(false)}
          >
            Map
          </button>
          <button
            aria-pressed={imagery}
            className={imagery ? "active" : ""}
            onClick={() => setImagery(true)}
          >
            Imagery
          </button>
        </div>
        <div className="map-status">
          <span className="status-dot" />
          <span>
            {coverage
              ? `MapPLUTO ${coverage.source_edition}`
              : "Loading source"}
            <span className="status-extra"> · Bounded Brooklyn coverage</span>
          </span>
          <button
            aria-label="View source coverage"
            onClick={() => toggleTool("coverage")}
          >
            <Info size={12} />
          </button>
        </div>
        {(coverageError || indexError) && (
          <div className="data-error" role="alert">
            <Info size={20} />
            <div>
              <strong>Local data could not be loaded</strong>
              <p>{coverageError?.message || indexError?.message}</p>
              <button
                onClick={() => {
                  refetchCoverage();
                  refetchIndex();
                }}
              >
                Try again
              </button>
            </div>
          </div>
        )}
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

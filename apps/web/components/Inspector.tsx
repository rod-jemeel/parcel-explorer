"use client";
import { useEffect, useState } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  ExternalLink,
  FileText,
  Focus,
  Info,
  Landmark,
  MapPin,
  Share2,
  StickyNote,
  X,
} from "lucide-react";
import AerialPreview from "./AerialPreview";
import BuildingDetails from "./BuildingDetails";
import { getProfile, getHistory } from "@/lib/data";
import {
  Coverage,
  DOCUMENT_TYPES,
  HistoryRecord,
  LAND_USES,
  PropertyProfile,
  PropertySummary,
} from "@/lib/model";
import {
  formatDate,
  formatMoney,
  formatNumber,
  titleAddress,
} from "@/lib/search";

export interface SavedResearch {
  bbl: string;
  note: string;
  savedAt: string;
  bookmarked?: boolean;
}
interface Props {
  summary: PropertySummary;
  coverage: Coverage;
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  onClose: () => void;
  onBack: () => void;
  onRecenter: () => void;
  onImagery: () => void;
  outside: boolean;
  saved: SavedResearch | undefined;
  onSave: (bbl: string) => void;
  onNote: (bbl: string, note: string) => void;
  onShare: () => void;
  hasResults: boolean;
}
const tabs = [
  "Overview",
  "History",
  "Transfers",
  "Permits",
  "Assessment",
  "Sources",
] as const;
type Tab = (typeof tabs)[number];
function SourceLabel({
  edition,
  onClick,
}: {
  edition: string;
  onClick: () => void;
}) {
  return (
    <button className="source-label" onClick={onClick}>
      <span className="source-dot" />
      MapPLUTO {edition}
      <Info size={12} />
    </button>
  );
}
function Fact({
  label,
  children,
  unit,
}: {
  label: string;
  children: React.ReactNode;
  unit?: string;
}) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>
        {children}
        {unit && children !== "Not supplied" && <span> {unit}</span>}
      </dd>
    </div>
  );
}
function RecordCard({ record: r }: { record: HistoryRecord }) {
  const multi = r.property_bbls.length > 1;
  return (
    <article className="record-card">
      <div className="record-title">
        <span className={"record-icon " + r.type}>
          {r.type === "transfer" ? (
            <ArrowUpRight size={15} />
          ) : (
            <FileText size={14} />
          )}
        </span>
        <div>
          <h4>
            {r.type === "transfer"
              ? r.classification === "zero_consideration_transfer"
                ? "Zero-dollar transfer"
                : "Reported transfer"
              : r.type === "permit"
                ? "Building permit"
                : DOCUMENT_TYPES[r.document_type || ""] ||
                  r.document_type ||
                  "Recorded document"}
          </h4>
          <span>{r.date ? formatDate(r.date) : "Event date not supplied"}</span>
        </div>
        <span className="record-agency">
          {r.type === "transfer"
            ? "DOF"
            : r.type === "permit"
              ? "DOB"
              : "ACRIS"}
        </span>
      </div>
      {r.amount !== null && (
        <div className="record-amount">
          <strong>{formatMoney(r.amount)}</strong>
          <span>
            {r.type === "transfer"
              ? "Reported consideration"
              : "Document amount"}
          </span>
        </div>
      )}
      {r.recording_date && (
        <p className="record-meta">
          Recorded {formatDate(r.recording_date)}
          {r.date && r.recording_date !== r.date
            ? " · event date shown above"
            : ""}
        </p>
      )}
      {multi && (
        <div className="record-caution">
          <Info size={13} />
          <span>
            One document linked to {r.property_bbls.length} properties. Amount
            is for the document; no per-property allocation.
          </span>
        </div>
      )}
      {r.type === "transfer" && (
        <p className="record-note">
          {r.classification === "zero_consideration_transfer"
            ? "Zero consideration does not establish an open-market sale."
            : "Source-row consideration; allocation across any related transaction is unverified."}
        </p>
      )}
      {r.document_type === "MTGE" && (
        <p className="record-note">
          Recorded obligation. This amount does not establish the current
          outstanding balance.
        </p>
      )}
      {r.type === "permit" && (
        <div className="permit-details">
          <p>
            Job {r.permit_job || "not supplied"} · BIN {r.bin || "not supplied"}
          </p>
          <p>
            Source status: <strong>{r.status || "not supplied"}</strong>
          </p>
          {r.work_type && <p>Reported work type: {r.work_type}</p>}
          <small>
            Current source observation; historical status changes are not
            reconstructed.
          </small>
        </div>
      )}
      {r.apartment && (
        <p className="record-meta">Source apartment / unit: {r.apartment}</p>
      )}
      <a
        className="record-link"
        href={r.official_url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {r.type === "document"
          ? "View official document"
          : r.type === "permit"
            ? "View official permit source"
            : "View DOF sales source"}
        <ExternalLink size={12} />
      </a>
      <details className="evidence">
        <summary>Record evidence</summary>
        <dl>
          <dt>Source record</dt>
          <dd>{r.source_record_id}</dd>
          <dt>Date basis</dt>
          <dd>{r.date_basis.replaceAll("_", " ")}</dd>
          <dt>Association</dt>
          <dd>Exact BBL</dd>
          <dt>Release</dt>
          <dd>{r.release_id}</dd>
        </dl>
        {multi && <p>Associated BBLs: {r.property_bbls.join(", ")}</p>}
      </details>
    </article>
  );
}
export function SourcesContent({ coverage }: { coverage: Coverage }) {
  return (
    <div className="sources-content">
      <div className="coverage-intro">
        <span className="status-dot" />
        <div>
          <strong>Bounded, source-backed pilot</strong>
          <p>{coverage.area_name}</p>
        </div>
      </div>
      <dl className="release-facts">
        <div>
          <dt>Data release</dt>
          <dd>{coverage.release_id}</dd>
        </div>
        <div>
          <dt>Imported</dt>
          <dd>{formatDate(coverage.fetched_at)}</dd>
        </div>
        <div>
          <dt>Map footprints</dt>
          <dd>{formatNumber(coverage.feature_count)}</dd>
        </div>
        <div>
          <dt>Linked historical records</dt>
          <dd>{formatNumber(coverage.record_count)}</dd>
        </div>
      </dl>
      {coverage.sources.map((s) => (
        <article className="source-entry" key={s.id}>
          <div className="source-entry-title">
            <Landmark size={16} />
            <h4>{s.name}</h4>
          </div>
          <span
            className={
              "status-badge " + (s.status === "not_imported" ? "muted" : "")
            }
          >
            {s.status === "partial"
              ? "Partial import"
              : s.status === "bounded"
                ? "Bounded import"
                : "Not imported"}
          </span>
          <p>{s.agency}</p>
          {s.source_edition && <p>Source edition {s.source_edition}</p>}
          {s.source_updated_at && (
            <p>Source updated {formatDate(s.source_updated_at)}</p>
          )}
          {s.imported_from && (
            <p>
              {formatDate(s.imported_from)} – {formatDate(s.through)}
              <br />
              <small>Basis: {s.date_basis?.replaceAll("_", " ")}</small>
            </p>
          )}
          <p className="source-note">{s.note}</p>
          {s.url && (
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              Official source
              <ExternalLink size={12} />
            </a>
          )}
        </article>
      ))}
      <div className="coverage-warning">
        <Info size={16} />
        <div>
          <strong>Know the gaps</strong>
          {coverage.limitations.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      </div>
    </div>
  );
}
export default function Inspector(p: Props) {
  const [tab, setTab] = useState<Tab>("Overview");
  const [eventType, setEventType] = useState("all");
  const [notesOpen, setNotesOpen] = useState(false);
  const [draft, setDraft] = useState(p.saved?.note || "");
  const [noteDirty, setNoteDirty] = useState(false);
  const [mobileFull, setMobileFull] = useState(false);
  const {
    data,
    error: profileError,
    isPending: profilePending,
    refetch,
  } = useQuery({
    queryKey: ["profile", p.coverage.release_id, p.summary.bbl],
    queryFn: ({ signal }) =>
      getProfile(p.coverage.release_id, p.summary.bbl, signal),
    staleTime: Infinity,
  });
  useEffect(() => {
    setTab("Overview");
    setEventType("all");
    setNotesOpen(false);
    setDraft(p.saved?.note || "");
    setNoteDirty(false);
  }, [p.summary.bbl]);
  const property: PropertySummary | PropertyProfile = data || p.summary;
  const isHistory = ["History", "Transfers", "Permits"].includes(tab);
  const historyKind =
    tab === "Transfers" ? "transfer" : tab === "Permits" ? "permit" : eventType;
  const historyQuery = useInfiniteQuery({
    queryKey: ["history", p.coverage.release_id, p.summary.bbl, historyKind],
    queryFn: ({ pageParam, signal }) =>
      getHistory(
        p.coverage.release_id,
        p.summary.bbl,
        historyKind,
        pageParam,
        signal,
      ),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_page ?? undefined,
    enabled: p.expanded && isHistory,
    staleTime: Infinity,
  });
  const history = historyQuery.data?.pages.flatMap((page) => page.events) || [];
  const error =
    profileError ||
    (isHistory && !historyQuery.isFetchNextPageError
      ? historyQuery.error
      : null);
  const isPending = profilePending || (isHistory && historyQuery.isPending);
  const totalRecords = historyQuery.data?.pages[0]?.total ?? 0;
  const records =
    tab === "Transfers"
      ? history.filter((r) => r.type === "transfer")
      : tab === "Permits"
        ? history.filter((r) => r.type === "permit")
        : history.filter((r) => eventType === "all" || r.type === eventType);
  const dated = records.filter((r) => r.date);
  const undated = records.filter((r) => !r.date);
  return (
    <aside
      className={`inspector ${p.expanded ? "expanded" : "compact"} ${mobileFull ? "mobile-full" : ""}`}
      aria-label="Property inspector"
      data-testid="inspector"
    >
      <button
        className="sheet-handle"
        aria-label={
          mobileFull ? "Collapse property sheet" : "Expand property sheet"
        }
        onClick={() => {
          if (!p.expanded) p.onExpand();
          else setMobileFull((v) => !v);
        }}
      >
        <span />
      </button>
      <div className="inspector-header">
        <div className="inspector-topline">
          <button className="text-button back-button" onClick={p.onBack}>
            <ArrowLeft size={14} />
            {p.hasResults ? "Back to results" : "Property record"}
          </button>
          <div>
            <button
              className={
                "icon-button " + (p.saved?.bookmarked ? "is-saved" : "")
              }
              title={
                p.saved?.bookmarked ? "Remove bookmark" : "Bookmark property"
              }
              aria-label={
                p.saved?.bookmarked ? "Remove bookmark" : "Bookmark property"
              }
              onClick={() => p.onSave(property.bbl)}
            >
              <Bookmark
                size={17}
                fill={p.saved?.bookmarked ? "currentColor" : "none"}
              />
            </button>
            <button
              className="icon-button"
              onClick={p.onClose}
              aria-label="Close property inspector"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <span className="property-locality">
          <MapPin size={12} /> Brooklyn, Kings County
        </span>
        <h1>{titleAddress(property.address)}</h1>
        <div className="property-identity">
          <span>BBL {property.bbl}</span>
          <span className="entity-tag">
            {property.entity_kind === "billing_group"
              ? "Condo billing footprint"
              : "Tax lot"}
          </span>
        </div>
        <div className="property-action-row">
          <button className="text-button" onClick={p.onRecenter}>
            <Focus size={14} />
            {p.outside ? "Recenter selected property" : "Zoom to parcel"}
          </button>
          <button className="text-button" onClick={p.onShare}>
            <Share2 size={13} />
            Share view
          </button>
        </div>
      </div>
      {!p.expanded ? (
        <div className="summary-body">
          <div className="summary-use">
            {LAND_USES[property.land_use || ""] || "Land use not supplied"}
          </div>
          <div className="summary-facts">
            <div>
              <span>Reported lot area</span>
              <strong>
                {formatNumber(property.lot_area)}
                <small> sq ft</small>
              </strong>
            </div>
            <div>
              <span>Year built</span>
              <strong>
                {property.year_built?.toString() || "Not supplied"}
              </strong>
            </div>
          </div>
          <SourceLabel
            edition={property.source_edition}
            onClick={() => {
              p.onExpand();
              setTab("Sources");
            }}
          />
          <button className="primary-button" onClick={p.onExpand}>
            View property details
            <ArrowUpRight size={16} />
          </button>
        </div>
      ) : (
        <>
          <nav
            className="inspector-tabs"
            aria-label="Property sections"
            role="tablist"
          >
            {tabs.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? "active" : ""}
                onClick={() => setTab(t)}
              >
                {t}
                {t === "History" && property.record_count > 0 && (
                  <span>{property.record_count}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="inspector-scroll" role="tabpanel" aria-label={tab}>
            {error ? (
              <div className="empty-state">
                <Info size={25} />
                <h3>Record unavailable</h3>
                <p>{error.message}</p>
                <button
                  onClick={() =>
                    profileError ? refetch() : historyQuery.refetch()
                  }
                >
                  Try again
                </button>
              </div>
            ) : isPending ? (
              <div className="loading-record">
                <div />
                <div />
                <div />
                Loading source-backed profile…
              </div>
            ) : tab === "Overview" ? (
              <>
                <div className="property-use">
                  <span
                    className="use-swatch"
                    style={{
                      background: property.land_use
                        ? `var(--use-${property.land_use})`
                        : "#ddd",
                    }}
                  />
                  <div>
                    <strong>
                      {LAND_USES[property.land_use || ""] ||
                        "Land use not supplied"}
                    </strong>
                    <span>
                      Building class {property.building_class || "not supplied"}
                    </span>
                  </div>
                </div>
                <AerialPreview
                  key={property.bbl}
                  property={data || property}
                  onOpen={p.onImagery}
                />
                {property.entity_kind === "billing_group" && (
                  <div className="coverage-warning">
                    <Info size={16} />
                    <div>
                      <strong>Condominium footprint</strong>
                      <p>
                        This billing lot can represent multiple units. The
                        official unit crosswalk is not imported. These records
                        belong to this BBL; individual-unit history is
                        unresolved.
                      </p>
                    </div>
                  </div>
                )}
                <section className="detail-section">
                  <div className="section-heading">
                    <h3>Property characteristics</h3>
                    <SourceLabel
                      edition={property.source_edition}
                      onClick={() => setTab("Sources")}
                    />
                  </div>
                  <dl className="facts-grid">
                    <Fact label="Reported lot area" unit="sq ft">
                      {formatNumber(property.lot_area)}
                    </Fact>
                    <Fact label="Building area" unit="sq ft">
                      {formatNumber(property.building_area)}
                    </Fact>
                    <Fact label="Year built">
                      {property.year_built?.toString() || "Not supplied"}
                    </Fact>
                    <Fact label="Total units">
                      {formatNumber(property.units)}
                    </Fact>
                    <Fact label="Buildings">
                      {formatNumber(data?.buildings)}
                    </Fact>
                    <Fact label="Floors">{formatNumber(data?.floors)}</Fact>
                    <Fact label="Zoning district">
                      {property.zoning || "Not supplied"}
                    </Fact>
                    <Fact label="Residential units">
                      {formatNumber(data?.residential_units)}
                    </Fact>
                  </dl>
                </section>
                {data && <BuildingDetails property={data} />}
                <section className="detail-section">
                  <div className="section-heading">
                    <h3>Assessment observation</h3>
                    <button
                      className="text-button"
                      onClick={() => setTab("Assessment")}
                    >
                      Details
                      <ArrowUpRight size={13} />
                    </button>
                  </div>
                  <strong className="assessment-number">
                    {formatMoney(property.assess_total)}
                  </strong>
                  <p className="muted-copy">
                    Total assessed amount for land and improvements in MapPLUTO{" "}
                    {property.source_edition}. Tax year not supplied; this is
                    not a tax bill or market valuation.
                  </p>
                </section>
                <section className="detail-section">
                  <div className="section-heading">
                    <h3>Available records</h3>
                    <button
                      className="text-button"
                      onClick={() => setTab("History")}
                    >
                      Open history
                      <ArrowUpRight size={13} />
                    </button>
                  </div>
                  <div className="available-row">
                    <FileText size={16} />
                    <span>
                      {property.record_count
                        ? `${property.record_count} linked imported records`
                        : "No linked records in this import"}
                    </span>
                    <span className="partial-label">Partial history</span>
                  </div>
                  <p className="muted-copy">
                    Absence from this bounded import does not establish absence
                    of historical records.
                  </p>
                </section>
                <section className="detail-section identifiers">
                  <h3>Official identifiers</h3>
                  <dl className="release-facts">
                    <div>
                      <dt>NYC BBL</dt>
                      <dd>{property.bbl}</dd>
                    </div>
                    <div>
                      <dt>Borough</dt>
                      <dd>3 · Brooklyn</dd>
                    </div>
                    <div>
                      <dt>Block / lot</dt>
                      <dd>
                        {property.block} / {property.lot}
                      </dd>
                    </div>
                    {property.condo_number && (
                      <div>
                        <dt>Condominium number</dt>
                        <dd>{property.condo_number}</dd>
                      </div>
                    )}
                  </dl>
                  <a
                    className="external-button"
                    target="_blank"
                    rel="noopener noreferrer"
                    href={`https://zola.planning.nyc.gov/l/lot/3/${property.block}/${property.lot}`}
                  >
                    Open in NYC ZoLa
                    <ExternalLink size={13} />
                  </a>
                </section>
              </>
            ) : tab === "History" ||
              tab === "Transfers" ||
              tab === "Permits" ? (
              <>
                <div className="history-intro">
                  <h3>
                    {tab === "Transfers"
                      ? "Sales & transfers"
                      : tab === "Permits"
                        ? "Building permits"
                        : "Available record history"}
                  </h3>
                  <p>
                    Records linked by exact BBL. Current parcel geometry is
                    shown; historical boundaries are not imported.
                  </p>
                </div>
                {data?.backfill && (
                  <div className="property-backfill">
                    <strong>Historical metadata backfill for this BBL</strong>
                    <p>
                      {data.backfill.document_count} linked documents;{" "}
                      {formatDate(data.backfill.imported_from)} –{" "}
                      {formatDate(data.backfill.through)} by recording date.
                    </p>
                    <p>{data.backfill.note}</p>
                  </div>
                )}
                <div className="history-toolbar">
                  <span>{totalRecords} imported records</span>
                  {tab === "History" && (
                    <select
                      aria-label="Filter record type"
                      value={eventType}
                      onChange={(e) => setEventType(e.target.value)}
                    >
                      <option value="all">All record types</option>
                      <option value="document">Documents</option>
                      <option value="transfer">Transfers</option>
                      <option value="permit">Permits</option>
                    </select>
                  )}
                </div>
                <div className="history-coverage">
                  <Clock3 size={14} />
                  <p>
                    Partial import. ACRIS uses a bounded document sample and
                    identified older backfills. DOF uses rolling sales; DOB
                    records are current permit observations.{" "}
                    <button onClick={() => setTab("Sources")}>
                      View exact coverage
                    </button>
                  </p>
                </div>
                {records.length === 0 ? (
                  <div className="empty-state">
                    <FileText size={28} />
                    <h3>No linked records imported</h3>
                    <p>
                      This does not mean no records exist. Continue research
                      through the official ACRIS portal.
                    </p>
                    <a
                      href="https://a836-acris.nyc.gov/CP/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open ACRIS
                      <ExternalLink size={13} />
                    </a>
                  </div>
                ) : (
                  <div className="timeline">
                    {dated.map((r) => (
                      <RecordCard key={r.id} record={r} />
                    ))}
                    {undated.length > 0 && (
                      <>
                        <h3 className="undated-heading">
                          Undated event records
                        </h3>
                        {undated.map((r) => (
                          <RecordCard key={r.id} record={r} />
                        ))}
                      </>
                    )}
                    {historyQuery.hasNextPage && (
                      <button
                        className="load-more"
                        disabled={historyQuery.isFetchingNextPage}
                        onClick={() => historyQuery.fetchNextPage()}
                      >
                        {historyQuery.isFetchingNextPage
                          ? "Loading records…"
                          : "Load more records"}
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : tab === "Assessment" ? (
              <>
                <section className="detail-section">
                  <h3>Source-observed assessment</h3>
                  <p className="muted-copy">
                    MapPLUTO {property.source_edition} snapshot. The source does
                    not supply an assessment tax year here.
                  </p>
                  <dl className="assessment-list">
                    <div>
                      <dt>Total assessed amount · land + improvements</dt>
                      <dd>{formatMoney(property.assess_total)}</dd>
                    </div>
                    <div>
                      <dt>Assessed land amount</dt>
                      <dd>{formatMoney(data?.assess_land)}</dd>
                    </div>
                    <div>
                      <dt>Assessed buildings / improvements · calculated</dt>
                      <dd>{formatMoney(data?.assess_improvements)}</dd>
                    </div>
                  </dl>
                  <p className="muted-copy">
                    Improvements = total assessed amount minus assessed land
                    amount. The total already includes these improvements; they
                    are not added a second time. This is a lot-level assessment,
                    with no official allocation to each building.
                  </p>
                  <SourceLabel
                    edition={property.source_edition}
                    onClick={() => setTab("Sources")}
                  />
                </section>
                <div className="coverage-warning">
                  <Info size={16} />
                  <div>
                    <strong>Snapshot observation</strong>
                    <p>
                      These amounts are not market valuations, actual tax bills,
                      or a complete annual tax-roll history. No annual
                      assessment comparison has been imported.
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <SourcesContent coverage={p.coverage} />
            )}
            <section className="notes-section">
              <button
                className="notes-toggle"
                onClick={() => setNotesOpen((v) => !v)}
              >
                <StickyNote size={16} />
                <span>My research note</span>
                {p.saved?.note && <span className="note-indicator" />}
                {notesOpen ? (
                  <ChevronUp size={15} />
                ) : (
                  <ChevronDown size={15} />
                )}
              </button>
              {notesOpen && (
                <div className="note-editor">
                  <p>
                    Stored only in this browser. Notes are not included in
                    shared views.
                  </p>
                  <label className="sr-only" htmlFor="research-note">
                    Private research note
                  </label>
                  <textarea
                    id="research-note"
                    placeholder="Add a note about this property…"
                    maxLength={10000}
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setNoteDirty(true);
                    }}
                  />
                  <button
                    className="primary-button"
                    disabled={!noteDirty}
                    onClick={() => {
                      p.onNote(property.bbl, draft);
                      setNoteDirty(false);
                    }}
                  >
                    <Check size={14} />
                    Save note on this device
                  </button>
                </div>
              )}
            </section>
          </div>
          <div className="inspector-footer">
            <span className="source-dot" />
            Government records · Partial coverage
            <button
              aria-label="Collapse details to summary"
              onClick={() => {
                setMobileFull(false);
                p.onCollapse();
              }}
            >
              <ChevronDown size={13} />
            </button>
          </div>
        </>
      )}
    </aside>
  );
}

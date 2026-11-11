"use client";
import { useEffect, useId, useState } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FileText,
  Focus,
  Hammer,
  Info,
  MapPin,
  Share2,
  StickyNote,
  X,
} from "lucide-react";
import PlanningApplications from "./PlanningApplications";
import AerialPreview from "./AerialPreview";
import { ComparableSales } from "./PropertyComparisons";
import BuildingDetails from "./BuildingDetails";
import { getProfile, getHistory } from "@/lib/data";
import {
  Coverage,
  DOCUMENT_TYPES,
  HistoryRecord,
  LAND_USES,
  PropertyProfile,
  PropertySummary,
  SourceCoverage,
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
async function copyJobId(job: string, trigger: HTMLButtonElement) {
  try {
    await navigator.clipboard.writeText(job);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = job;
    field.readOnly = true;
    field.className = "sr-only";
    document.body.append(field);
    field.focus({ preventScroll: true });
    field.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      field.remove();
      trigger.focus({ preventScroll: true });
    }
  }
}

function RecordCard({ record: r }: { record: HistoryRecord }) {
  const detailsId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"copied" | "failed">();
  const date = r.date || r.recording_date;
  const multi = r.property_bbls.length > 1;
  const isTransfer = r.type === "transfer";
  const isPermit = r.type === "permit";
  const zeroTransfer = r.classification === "zero_consideration_transfer";
  const Icon = isTransfer ? ArrowUpRight : isPermit ? Hammer : FileText;
  const title = isTransfer
    ? zeroTransfer ? "Zero-dollar transfer" : "Reported transfer"
    : DOCUMENT_TYPES[r.document_type || ""] || r.document_type || "Recorded document";
  const job = r.permit_job?.trim();
  const isDobNow = isPermit && r.source === "dob_now";
  const permitUrl = job ? r.official_url : "https://www.nyc.gov/site/buildings/dob/find-building-data.page";
  const metadata = (
    <span className="record-meta" id={isPermit ? `${detailsId}-meta` : undefined}>
      {multi && <span>{formatNumber(r.property_bbls.length)} linked lots</span>}
      {date && <time dateTime={date}>{!r.date && r.recording_date ? "Recorded " : ""}{formatDate(date)}</time>}
      {r.amount !== null && <span>{formatMoney(r.amount)}{multi ? " · shared" : ""}</span>}
      {isPermit && r.status && <span>{r.status}</span>}
    </span>
  );
  const body = (
    <div className="record-body" id={detailsId}>
      {multi && <p className="record-caution">One filing covers {formatNumber(r.property_bbls.length)} tax lots. Amount applies to the document, with no per-property allocation.</p>}
      {isTransfer && (
        <p>{zeroTransfer ? "Reported at $0. Market price unknown." : "Reported consideration. Transaction allocation is unverified."}</p>
      )}
      {r.document_type === "MTGE" && <p>Recorded loan amount. Current balance unknown.</p>}
      <dl>
        {r.recording_date && r.recording_date !== date && <>
          <dt>Recorded</dt><dd>{formatDate(r.recording_date)}</dd>
        </>}
        {isPermit && <>
          <dt>Building ID</dt><dd>{r.bin || "Not supplied"}</dd>
          {r.work_type && <><dt>Work type</dt><dd>{r.work_type}</dd></>}
          {r.expiration_date && <><dt>Expires</dt><dd>{formatDate(r.expiration_date)}</dd></>}
          <dt>System</dt><dd>{isDobNow ? "DOB NOW" : "DOB BIS"}</dd>
        </>}
        {r.apartment && <><dt>Unit</dt><dd>{r.apartment}</dd></>}
        <dt>Source record</dt><dd>{r.source_record_id}</dd>
        <dt>Date basis</dt><dd>{r.date_basis.replaceAll("_", " ")}</dd>
        <dt>Association</dt><dd>Exact tax-lot ID</dd>
        <dt>Release</dt><dd>{r.release_id}</dd>
      </dl>
      {multi && (
        <details className="linked-lots">
          <summary>View {formatNumber(r.property_bbls.length)} linked tax lots</summary>
          <p>{r.property_bbls.join(", ")}</p>
        </details>
      )}
      {isDobNow && (
        <a
          className="record-link dob-portal-link"
          href="https://a810-dobnow.nyc.gov/publish/Index.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          Search DOB NOW by job ID <ExternalLink size={12} />
        </a>
      )}
      {!isPermit && (
        <a className="record-link" href={r.official_url} target="_blank" rel="noopener noreferrer">
          {isTransfer ? "DOF sales source" : "Official document"}
          <ExternalLink size={12} />
        </a>
      )}
    </div>
  );
  return (
    <li className={isPermit ? "timeline-event permit-event" : "timeline-event"}>
      <span className="timeline-marker" aria-hidden="true"><Icon size={13} /></span>
      {isPermit && (
        <div className="permit-heading">
          <button
            type="button"
            className="permit-toggle"
            aria-label={`Details for permit ${job || r.source_record_id}`}
            aria-controls={detailsId}
            aria-describedby={`${detailsId}-meta`}
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            <ChevronDown className="record-chevron" size={15} aria-hidden="true" />
          </button>
          {isDobNow ? (
            <div className="permit-job-actions">
              <span className="record-title permit-job-title">{job || "Permit details"}</span>
              {job && (
                <>
                  <button
                    type="button"
                    className="permit-copy-button"
                    aria-label={`Copy job ID ${job}`}
                    title={copyStatus === "copied" ? "Copied" : "Copy job ID"}
                    onClick={async (event) => {
                      const copied = await copyJobId(job, event.currentTarget);
                      setCopyStatus(copied ? "copied" : "failed");
                    }}
                  >
                    {copyStatus === "copied"
                      ? <Check size={14} aria-hidden="true" />
                      : <Copy size={14} aria-hidden="true" />}
                  </button>
                  <span
                    className={copyStatus === "failed" ? "permit-copy-status" : "permit-copy-status sr-only"}
                    role="status"
                  >
                    {copyStatus === "copied" ? "Job ID copied" : copyStatus === "failed" ? "Couldn’t copy" : ""}
                  </span>
                </>
              )}
            </div>
          ) : (
            <a className="record-title permit-job-link" href={permitUrl} target="_blank" rel="noopener noreferrer">
              {job || "Permit source"} <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
          {metadata}
        </div>
      )}
      {isPermit ? (
        <div className="record-card" hidden={!detailsOpen}>{body}</div>
      ) : (
        <details className="record-card">
          <summary className="record-summary">
            <span className="record-title">{title}</span>
            <span className="record-chevron" aria-hidden="true"><ChevronDown size={15} /></span>
            {metadata}
          </summary>
          {body}
        </details>
      )}
    </li>
  );
}

function RecordTimeline({ records }: { records: HistoryRecord[] }) {
  const groups = new Map<string, HistoryRecord[]>();
  for (const record of records) {
    const year = (record.date || record.recording_date)?.slice(0, 4) || "Undated";
    const group = groups.get(year);
    if (group) group.push(record);
    else groups.set(year, [record]);
  }
  return Array.from(groups, ([year, entries]) => (
    <section className="timeline-year" key={year} aria-label={year}>
      <h4>{year}</h4>
      <ol className="timeline-events">
        {entries.map((record) => <RecordCard key={record.id} record={record} />)}
      </ol>
    </section>
  ));
}
const sourceStatuses: Record<string, string> = {
  imported: "Imported",
  partial: "Partial",
  bounded: "Bounded",
  available: "Available",
  not_imported: "Not imported",
};

function SourceRow({ source }: { source: SourceCoverage }) {
  return (
    <li className="source-entry">
      <details>
        <summary>
          <span className="source-name">{source.name}</span>
          <span className="source-status" data-status={source.status}>
            {sourceStatuses[source.status] || source.status}
          </span>
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <div className="source-detail">
          {source.agency && <p>{source.agency}</p>}
          {source.source_edition && <p>Edition {source.source_edition}</p>}
          {source.source_updated_at && <p>Updated {formatDate(source.source_updated_at)}</p>}
          {source.imported_from && (
            <p>{formatDate(source.imported_from)} – {formatDate(source.through)}
              {source.date_basis && <small>{source.date_basis.replaceAll("_", " ")}</small>}
            </p>
          )}
          <p>{source.note}</p>
          {source.url && (
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              Official source <ExternalLink size={12} />
            </a>
          )}
        </div>
      </details>
    </li>
  );
}

export function SourcesContent({ coverage }: { coverage: Coverage }) {
  return (
    <div className="sources-content">
      <div className="coverage-intro">
        <h3>Data sources</h3>
        <span>{coverage.area_name}</span>
      </div>
      <ul className="source-list">
        {coverage.sources.map((source) => <SourceRow key={source.id} source={source} />)}
      </ul>
      <details className="coverage-details">
        <summary>Coverage & release <ChevronDown size={14} aria-hidden="true" /></summary>
        <dl className="release-facts">
          <div><dt>Data release</dt><dd>{coverage.release_id}</dd></div>
          <div><dt>Imported</dt><dd>{formatDate(coverage.fetched_at)}</dd></div>
          <div><dt>Map footprints</dt><dd>{formatNumber(coverage.feature_count)}</dd></div>
          <div><dt>Linked records</dt><dd>{formatNumber(coverage.record_count)}</dd></div>
        </dl>
        <ul>
          {coverage.limitations.map((limit) => <li key={limit}>{limit}</li>)}
        </ul>
      </details>
    </div>
  );
}
export default function Inspector(p: Props) {
  const [tab, setTab] = useState<Tab>("Overview");
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
    setNotesOpen(false);
    setDraft(p.saved?.note || "");
    setNoteDirty(false);
  }, [p.summary.bbl]);
  const property: PropertySummary | PropertyProfile = data || p.summary;
  const isHistory = ["History", "Transfers", "Permits"].includes(tab);
  const historyKind =
    tab === "Transfers" ? "transfer" : tab === "Permits" ? "permit" : "document";
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
  const records = historyQuery.data?.pages.flatMap((page) => page.events) || [];
  const error =
    profileError ||
    (isHistory && !historyQuery.isFetchNextPageError
      ? historyQuery.error
      : null);
  const isPending = profilePending || (isHistory && historyQuery.isPending);
  const totalRecords = historyQuery.data?.pages[0]?.total ?? 0;
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
            {p.expanded && (
              <button
                className="icon-button"
                aria-label="Collapse details to summary"
                title="Collapse details"
                onClick={() => {
                  setMobileFull(false);
                  p.onCollapse();
                }}
              >
                <ChevronDown size={17} />
              </button>
            )}
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
                aria-label={t === "Sources" ? "Sources" : undefined}
                title={t === "Sources" ? "Sources" : undefined}
                data-icon-tab={t === "Sources" ? "" : undefined}
                onClick={() => setTab(t)}
              >
                {t === "Sources" ? <Info size={16} aria-hidden="true" /> : t}
                {t === "History" && !!property.history_counts?.document && (
                  <span>{property.history_counts.document}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="inspector-scroll" key={tab} role="tabpanel" aria-label={tab}>
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
                    <h3>Assessed value</h3>
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
                  <p className="muted-copy">Land and improvements · MapPLUTO {property.source_edition}</p>
                </section>
                <section className="detail-section">
                  <div className="section-heading">
                    <h3>Available records</h3>
                    <button
                      className="text-button"
                      onClick={() => setTab("History")}
                    >
                      Recorded documents
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
                    Browse recorded documents, sales, and permits in their tabs.
                  </p>
                </section>
                <PlanningApplications bbl={property.bbl} />
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
                  <h3>{tab === "Transfers" ? "Sales & transfers" : tab === "Permits" ? "Building permits" : "Recorded documents"}</h3>
                  <button className="text-button" onClick={() => setTab("Sources")}>Coverage <Info size={13} /></button>
                </div>
                {tab === "History" && data?.backfill && (
                  <details className="history-backfill">
                    <summary>Earlier ACRIS records</summary>
                    <p>{data.backfill.document_count} documents recorded {formatDate(data.backfill.imported_from)} – {formatDate(data.backfill.through)}.</p>
                    <p>{data.backfill.note}</p>
                  </details>
                )}
                <div className="history-toolbar">
                  <span>{totalRecords} {totalRecords === 1 ? "record" : "records"}</span>
                </div>
                {records.length === 0 ? (
                  <div className="empty-state">
                    <FileText size={28} />
                    <h3>No {tab === "Permits" ? "permits" : tab === "Transfers" ? "transfers" : "matching records"} imported</h3>
                    <a
                      href={tab === "Permits" ? "https://www.nyc.gov/site/buildings/dob/building-applications-permits.page" : tab === "Transfers" ? "https://www.nyc.gov/site/finance/property/property-rolling-sales-data.page" : "https://a836-acris.nyc.gov/CP/"}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {tab === "Permits" ? "Search DOB" : tab === "Transfers" ? "Open DOF sales" : "Search ACRIS"}
                      <ExternalLink size={13} />
                    </a>
                  </div>
                ) : (
                  <div className="timeline">
                    <RecordTimeline records={records} />
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
              <section className="detail-section assessment-section">
                <h3>Assessed value</h3>
                <dl className="assessment-list">
                  <div>
                    <dt>Total · land + improvements</dt>
                    <dd>{formatMoney(property.assess_total)}</dd>
                  </div>
                  <div>
                    <dt>Land</dt>
                    <dd>{formatMoney(data?.assess_land)}</dd>
                  </div>
                  <div>
                    <dt>Improvements</dt>
                    <dd>{formatMoney(data?.assess_improvements)}</dd>
                  </div>
                </dl>
                <details className="assessment-method">
                  <summary><Info size={14} /> About these figures <ChevronDown size={14} /></summary>
                  <p>Improvements are calculated as total minus land for the whole lot.</p>
                  <p>MapPLUTO assessment snapshot. Tax year, market value, and tax bill are unavailable here.</p>
                </details>
                <SourceLabel edition={property.source_edition} onClick={() => setTab("Sources")} />
              </section>
            ) : (
              <SourcesContent coverage={p.coverage} />
            )}
            {tab === "Transfers" && p.coverage.storage_format === "sqlite-v1" && (
              <ComparableSales property={property} />
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
        </>
      )}
    </aside>
  );
}

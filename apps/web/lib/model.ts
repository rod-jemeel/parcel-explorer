export type Bounds = [number, number, number, number];
export interface PropertySummary {
  id: string;
  bbl: string;
  block: string;
  lot: string;
  address: string;
  jurisdiction: "brooklyn";
  entity_kind: "parcel" | "billing_group";
  relationships_status: string;
  condo_number: number | null;
  land_use: string | null;
  building_class: string | null;
  lot_area: number | null;
  building_area: number | null;
  year_built: number | null;
  units: number | null;
  zoning: string | null;
  assess_total: string | null;
  assessment_year: number | null;
  source: string;
  source_edition: string;
  bounds: Bounds;
  center: [number, number];
  release_id: string;
  record_count: number;
  latest_imported_transfer: string | null;
  history_counts?: Record<string, number>;
}
export interface HistoryRecord {
  id: string;
  type: "document" | "transfer" | "permit";
  source: string;
  source_record_id: string;
  document_type?: string;
  date: string | null;
  recording_date?: string | null;
  amount: string | null;
  amount_kind: string;
  currency: string;
  property_bbls: string[];
  allocation: string;
  official_url: string;
  permit_job?: string;
  status?: string;
  work_type?: string;
  bin?: string;
  expiration_date?: string;
  classification?: string;
  association: string;
  date_basis: string;
  release_id: string;
  raw_record_hash?: string;
  apartment?: string;
}
export interface PropertyProfile extends PropertySummary {
  assess_improvements?: string | null;
  assessment_calculation?: string;
  building_records?: {
    id: string;
    source_record_id: string;
    bin: string | null;
    name: string | null;
    construction_year: number | null;
    last_edited_at: string | null;
    source_status: string | null;
    association: string;
    geometry: GeoJSON.Geometry;
    official_url: string;
  }[];
  building_crosscheck?: {
    footprints: number;
    distinct_bins: number;
    pluto_reported_buildings: number | null;
    status: string;
    note: string;
  };
  backfill?: {
    document_count: number;
    legal_associations: number;
    imported_from: string | null;
    through: string | null;
    note: string;
  } | null;
  source_record_id: string;
  source_url: string;
  assess_land: string | null;
  historic_district: string | null;
  floors: number | null;
  buildings: number | null;
  residential_units: number | null;
  postal_code: number | null;
}
export interface HistoryPage {
  release_id: string;
  bbl: string;
  events: HistoryRecord[];
  total: number;
  next_page: number | null;
}
export interface SourceCoverage {
  id: string;
  name: string;
  agency?: string;
  dataset?: string;
  url?: string;
  status: string;
  date_basis?: string;
  imported_from?: string | null;
  through?: string | null;
  source_edition?: string;
  source_updated_at?: string;
  linked_records?: number;
  source_rows?: number;
  note: string;
}
export interface Coverage {
  storage_format?: "paged-v1" | "sqlite-v1";
  building_footprints?: number;
  release_id: string;
  parser_version: string;
  fetched_at: string;
  feature_count: number;
  entity_count: number;
  area_name: string;
  bounds: Bounds;
  source_edition: string;
  sources: SourceCoverage[];
  limitations: string[];
  record_count: number;
  condo_footprints: number;
  multi_property_documents: number;
}
export const LAND_USES: Record<string, string> = {
  "1": "One & two family",
  "2": "Multifamily walk-up",
  "3": "Multifamily elevator",
  "4": "Mixed residential & commercial",
  "5": "Commercial & office",
  "6": "Industrial & manufacturing",
  "7": "Transportation & utilities",
  "8": "Public facilities",
  "9": "Open space & recreation",
  "10": "Parking",
  "11": "Vacant land",
};
export const USE_COLORS: Record<string, string> = {
  "1": "#e7d4ad",
  "2": "#e8ca96",
  "3": "#e0b979",
  "4": "#d5aec2",
  "5": "#c2b7dc",
  "6": "#b5c4d0",
  "7": "#c4ccd3",
  "8": "#a9c9de",
  "9": "#b9d5ad",
  "10": "#d1d4ce",
  "11": "#e3dfd2",
};
export const DOCUMENT_TYPES: Record<string, string> = {
  DEED: "Deed",
  DEEDO: "Deed, other",
  MTGE: "Mortgage",
  SAT: "Satisfaction of mortgage",
  ASST: "Assignment",
  AGMT: "Agreement",
  LDMK: "Landmark designation",
  RPTT: "Transfer tax return",
  RPTTCO: "Transfer tax return",
  CDEC: "Condominium declaration",
  "AL&R": "Assignment of leases & rents",
  UCC1: "UCC financing statement",
  UCC3: "UCC amendment",
  RETT: "Real estate transfer tax",
  CORR: "Correction",
};

import { Building2, ExternalLink, Info } from "lucide-react";
import { PropertyProfile } from "@/lib/model";
import { formatDate, formatNumber } from "@/lib/search";
export default function BuildingDetails({
  property: p,
}: {
  property: PropertyProfile;
}) {
  const records = p.building_records || [],
    cross = p.building_crosscheck;
  const yearMismatch = records.some(
    (r) =>
      r.construction_year &&
      p.year_built &&
      r.construction_year !== p.year_built,
  );
  return (
    <section className="detail-section building-section">
      <div className="section-heading">
        <h3>Buildings on this lot</h3>
        <Building2 size={15} />
      </div>
      <div className="building-counts">
        <div>
          <span>MapPLUTO reports</span>
          <strong>
            {formatNumber(p.buildings)} <small>buildings</small>
          </strong>
        </div>
        <div>
          <span>OTI outlines linked</span>
          <strong>
            {formatNumber(cross?.footprints)} <small>footprints</small>
          </strong>
        </div>
      </div>
      {cross?.status === "count_differs" && (
        <div className="building-discrepancy">
          <Info size={13} />
          <span>
            Source counts differ. Review the source editions and linked
            footprints.
          </span>
        </div>
      )}
      {!records.length ? (
        <p className="muted-copy">
          No building footprints linked in this import. This does not establish
          that the lot is vacant.
        </p>
      ) : (
        <details className="building-records">
          <summary>
            {cross?.distinct_bins} distinct building IDs · View records
          </summary>
          {records.map((r) => (
            <article key={r.id}>
              <strong>
                {r.name || `Building ${r.bin || "ID not assigned"}`}
              </strong>
              <span>
                BIN {r.bin || "not assigned"}
                {r.construction_year ? ` · Built ${r.construction_year}` : ""}
              </span>
              <span>Footprint edited {formatDate(r.last_edited_at)}</span>
              <a
                href={r.official_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Official OTI source
                <ExternalLink size={10} />
              </a>
            </article>
          ))}
        </details>
      )}
      {yearMismatch && (
        <p className="building-source-note">
          Construction years differ between MapPLUTO and OTI. Both source
          observations are retained.
        </p>
      )}
      <p className="building-source-note">
        Source-linked outlines help cross-check structures. They do not verify
        present condition, unrecorded alterations, or a separate value for each
        building.
      </p>
    </section>
  );
}

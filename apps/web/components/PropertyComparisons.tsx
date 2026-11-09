"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { fetchJSON, getHistory, getProfile } from "@/lib/data";
import { HistoryRecord, PropertySummary } from "@/lib/model";
import { formatDate, formatMoney, formatNumber, titleAddress } from "@/lib/search";

type Sale = { bbl: string; address: string; building_area: number; distance: number; sale: HistoryRecord };

export function ComparableSales({ property }: { property: PropertySummary }) {
  const query = useQuery({
    queryKey: ["comparable-sales", property.release_id, property.bbl],
    queryFn: ({ signal }) => fetchJSON<{ sales: Sale[]; eligible: boolean }>(
      `/data/${property.release_id}/comps/${property.bbl}.json`, signal),
  });
  return (
    <section className="detail-section">
      <h3>Nearby sales</h3>
      <p className="muted-copy">Same building class, within 1 mile, and within 50% of this building’s size. Based on imported NYC rolling sales.</p>
      {query.isPending ? <p role="status">Finding nearby sales…</p>
        : query.isError ? <button className="text-button" onClick={() => query.refetch()}>Couldn’t load nearby sales · Retry</button>
        : !query.data.eligible ? <p className="muted-copy">Comparison needs a tax lot with a reported building class and area.</p>
        : !query.data.sales.length ? <p className="muted-copy">No imported sales match these criteria.</p>
        : <ul className="comparable-list">
            {query.data.sales.map(({ bbl, address, building_area, distance, sale }) => (
              <li key={bbl}>
                <div><a href={`/?parcel=${bbl}`} target="_blank" rel="noopener noreferrer">{titleAddress(address)}</a>
                  <strong>{formatMoney(sale.amount)}</strong></div>
                <small>{formatDate(sale.date)} · {formatNumber(building_area)} sq ft · {distance.toFixed(2)} mi</small>
                <a className="comparable-source" href={sale.official_url} target="_blank" rel="noopener noreferrer">
                  NYC rolling sales <ExternalLink size={11} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>}
    </section>
  );
}

export function SavedComparison({ properties }: { properties: PropertySummary[] }) {
  const queries = useQueries({
    queries: properties.map(({ bbl, release_id }) => ({
      queryKey: ["saved-comparison", release_id, bbl],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const [profile, permits, transfers] = await Promise.all([
          getProfile(release_id, bbl, signal),
          getHistory(release_id, bbl, "permit", 0, signal),
          getHistory(release_id, bbl, "transfer", 0, signal),
        ]);
        return { profile, permit: permits.events[0], transfer: transfers.events[0] };
      },
    })),
  });
  if (queries.some((query) => query.isPending)) return <p role="status">Loading property comparison…</p>;
  const fields = [
    "Building class", "Building area", "Year built", "Buildings reported", "Land assessment",
    "Improvement assessment", "Total assessment", "Latest imported permit", "Latest imported transfer",
  ];
  const columns = queries.map(({ data }) => {
    if (!data) return fields.map(() => "Unavailable");
    const { profile, permit, transfer } = data;
    return [
      profile.building_class ?? "Not supplied",
      profile.building_area ? formatNumber(profile.building_area) + " sq ft" : "Not supplied",
      formatNumber(profile.year_built), formatNumber(profile.buildings),
      formatMoney(profile.assess_land), formatMoney(profile.assess_improvements), formatMoney(profile.assess_total),
      permit ? <>{formatDate(permit.date)} · {permit.permit_job || "Permit"}{permit.status ? " · " + permit.status : ""}</> : "None imported",
      transfer ? <a href={transfer.official_url} target="_blank" rel="noopener noreferrer">
        {formatDate(transfer.date)} · {formatMoney(transfer.amount)}</a> : "None imported",
    ];
  });
  return (
    <div className="saved-comparison" tabIndex={0} role="region" aria-label="Compare saved properties">
      <table>
        <caption>Building details and assessments from MapPLUTO. Permit and transfer dates reflect imported records.</caption>
        <thead><tr><th scope="col">Property</th>{properties.map((p) => <th scope="col" key={p.bbl}>{titleAddress(p.address)}</th>)}</tr></thead>
        <tbody>{fields.map((field, index) => <tr key={field}>
          <th scope="row">{field}</th>
          {columns.map((column, columnIndex) => <td key={properties[columnIndex].bbl}>{column[index]}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  );
}

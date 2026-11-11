"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJSON } from "@/lib/data";

type Project = {
  project_id: string;
  project_name?: string;
  public_status?: string;
  actions?: string;
  current_milestone?: string;
  current_milestone_date?: string;
  ulurp_numbers?: string;
};

type Snapshot = {
  asOf: string;
  lots: Record<string, string[]>;
  projects: Record<string, Project>;
};

export default function PlanningApplications({ bbl }: { bbl: string }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["brooklyn-planning"],
    queryFn: ({ signal }) => fetchJSON<Snapshot>("/planning/brooklyn.json", signal),
    enabled: open,
    staleTime: Infinity,
  });
  const projects = (query.data?.lots[bbl] ?? []).map((id) => query.data!.projects[id]);

  return (
    <details className="detail-section" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Planning applications</summary>
      {query.isPending && <p>Loading NYC planning applications…</p>}
      {query.isError && (
        <p>Planning snapshot unavailable. <button className="text-button" onClick={() => void query.refetch()}>Retry</button></p>
      )}
      {query.data && (
        <>
          <p className="muted-copy">Exact tax-lot links · Snapshot {query.data.asOf}</p>
          {!projects.length && <p>No linked applications in this snapshot.</p>}
          {projects.length > 0 && (
            <ul className="planning-applications">
              {projects.map((project) => (
                <li key={project.project_id}>
                  <strong>{project.project_name || project.project_id}</strong>
                  <p>{[project.public_status, project.current_milestone, project.current_milestone_date?.slice(0, 10)].filter(Boolean).join(" · ")}</p>
                  {project.actions && <p>{project.actions}</p>}
                  {project.ulurp_numbers && <p>ULURP: {project.ulurp_numbers}</p>}
                  <a href={`https://data.cityofnewyork.us/resource/hgx4-8ukb.json?${new URLSearchParams({ project_id: project.project_id })}`} target="_blank" rel="noreferrer">
                    NYC Open Data · {project.project_id}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="muted-copy">Application status comes from City Planning. It does not establish construction status.</p>
        </>
      )}
    </details>
  );
}

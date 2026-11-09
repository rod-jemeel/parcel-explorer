import type {
  Coverage,
  PropertySummary,
  PropertyProfile,
  HistoryPage,
} from "./model";
import { publicUrl, type PublicState } from "./search";
export async function fetchJSON<T>(
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(url, { signal, cache: "no-cache" });
  if (!res.ok)
    throw new Error(
      res.status === 404
        ? "This record is unavailable in the selected release. Refresh coverage and try again."
        : `Could not load local data (HTTP ${res.status}). Try again.`,
    );
  return res.json();
}
const releaseFormats = new Map<string, string>();
const profiles = new Map<string, PropertyProfile>();
export const getCoverage = async (signal?: AbortSignal) => {
  const coverage = await fetchJSON<Coverage>("/data/coverage.json", signal);
  releaseFormats.set(
    coverage.release_id,
    coverage.storage_format || "block-v1",
  );
  return coverage;
};
export const getIndex = (release: string, signal?: AbortSignal) =>
  fetchJSON<PropertySummary[]>(`/data/${release}/index.json`, signal);
export function searchRelease(
  release: string,
  state: PublicState,
  limit: number,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams(publicUrl(state).slice(1));
  params.set("limit", String(limit));
  return fetchJSON<{
    results: PropertySummary[];
    total: number;
    status: "ok" | "outside_coverage";
    isPlace: boolean;
  }>(`/data/${release}/search.json?${params}`, signal);
}
export function getSummaries(
  release: string,
  ids: string[],
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  for (const id of ids) params.append("bbl", id);
  return fetchJSON<PropertySummary[]>(
    `/data/${release}/summaries.json?${params}`,
    signal,
  );
}
export function getMapMatches(
  release: string,
  state: PublicState,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams(publicUrl(state).slice(1));
  params.set("matches", "1");
  return fetchJSON<string[]>(`/data/${release}/search.json?${params}`, signal);
}

function hasPagedHistory(release: string) {
  return ["paged-v1", "sqlite-v1"].includes(releaseFormats.get(release) || "");
}
export async function getProfile(
  release: string,
  bbl: string,
  signal?: AbortSignal,
) {
  if (!/^3\d{9}$/.test(bbl)) throw new Error("Invalid Brooklyn BBL");
  const key = release + ":" + bbl;
  const cached = profiles.get(key);
  if (cached) return cached;
  if (!hasPagedHistory(release)) {
    const shard = await fetchJSON<Record<string, PropertyProfile>>(
      `/data/${release}/profiles/${Number(bbl.slice(1, 6))}.json`,
      signal,
    );
    const p = shard[bbl];
    if (!p || p.release_id !== release)
      throw new Error("Property not present in this data release.");
    profiles.set(key, p);
    return p;
  }
  const p = await fetchJSON<PropertyProfile>(
    `/data/${release}/profiles/${bbl}.json`,
    signal,
  );
  if (!p || p.release_id !== release)
    throw new Error("Property not present in this data release.");
  if (profiles.size > 100) profiles.delete(profiles.keys().next().value!);
  profiles.set(key, p);
  return p;
}
export async function getHistory(
  release: string,
  bbl: string,
  kind: string,
  page: number,
  signal?: AbortSignal,
) {
  if (
    !/^3\d{9}$/.test(bbl) ||
    !["all", "document", "transfer", "permit"].includes(kind) ||
    !Number.isInteger(page) ||
    page < 0
  )
    throw new Error("Invalid history request");
  if (!hasPagedHistory(release)) {
    const profile = (await getProfile(
      release,
      bbl,
      signal,
    )) as PropertyProfile & { history?: HistoryPage["events"] };
    const events = (profile.history || []).filter(
      (r) => kind === "all" || r.type === kind,
    );
    return {
      release_id: release,
      bbl,
      events: events.slice(page * 40, (page + 1) * 40),
      total: events.length,
      next_page: (page + 1) * 40 < events.length ? page + 1 : null,
    };
  }
  const profile = await getProfile(release, bbl, signal);
  if (profile.history_counts?.[kind] === 0)
    return { release_id: release, bbl, events: [], total: 0, next_page: null };
  const result = await fetchJSON<HistoryPage>(
    `/data/${release}/history/${bbl}/${kind}/${page}.json`,
    signal,
  );
  if (result.release_id !== release || result.bbl !== bbl)
    throw new Error("History belongs to a different data release.");
  return result;
}

# Source register

Checked November 5, 2026. Detailed fetched URLs, hashes and retrieval times are retained in `data/raw/*.meta.json`. Current import counts and date bases are exposed in the release manifest and application.

| Source | Official entry | Access / identity | Pilot coverage and limitations |
|---|---|---|---|
| DCP MapPLUTO | https://www.arcgis.com/home/item.html?id=1564ace0b4f44318ac39920737f9bd07 | Public authoritative DCP_GIS ArcGIS feature service. Enumerate IDs and check counts; exact borough/block/lot BBL. | 5,628 footprints intersecting the bounded pilot rectangle, edition 26v2. Geometry and attributes share that edition. No source owner names are published in runtime assets. |
| ACRIS Master | https://data.cityofnewyork.us/d/bnx9-e6tj | Public Socrata API; document_id. | Bounded sample by legal associations, filtering Master by recording date from 2016; three explicitly targeted exact-BBL backfills consider metadata from 1966. Recording borough is not used to identify property borough. |
| ACRIS Legals | https://data.cityofnewyork.us/d/8h5j-fqxa | Public Socrata API; document_id + borough/block/lot association. | All returned property associations for selected documents are retained. Shared document consideration is unallocated. Parties are not imported. |
| DOF rolling sales | https://data.cityofnewyork.us/d/usep-8jbt | Public Socrata API; retained source row hash and BBL. | Brooklyn rolling file, exact-BBL filtered to pilot. Source date window is reported. Annual backfill not imported. Zero-dollar transfers stay visible. |
| DOB BIS permits | https://data.cityofnewyork.us/d/ipu4-2q9a | Public Socrata API; permit_si_no; borough/block/lot. | Pilot block export, exact parcel join. Current status only. No applicant/owner phone or contact fields are selected by the connector. |
| DOB NOW approved permits | https://data.cityofnewyork.us/d/rbx6-tga4 | Public Socrata API; source row identity and tracking/job IDs; BBL. | Pilot block export, exact parcel join. Unusable identity rows are counted and retained in raw evidence. No unit inferred from a missing qualifier. |
| OTI building footprints | https://data.cityofnewyork.us/d/5zhs-2jue | Public Socrata spatial API; doitt_id/BIN; source-provided mappluto_bbl or base_bbl. | Bounded building geometry. No overlap-based automatic identity joins. Per-building construction-year/edit observations and discrepancies are visible. |
| NYC 2024 orthoimagery | https://www.arcgis.com/home/item.html?id=423f15185bd04f8dad8d99fba736772f | Public NYC OTI tile service. Agency item links NYC terms; official imagery metadata also describes CC BY 4.0. | Display directly with credit and year. No bulk image archive or street-level photograph claim. Current vectors are dated separately from imagery. |
| OSM street-map preview | https://operations.osmfoundation.org/policies/tiles/ | Browser tile requests with visible attribution, default Referer and normal HTTP caching. | Modest local interactive use only; no bulk tile prefetch, no offline map download, and no production SLA claimed. |

Source metadata:

- https://github.com/CityOfNewYork/nyc-geo-metadata/blob/main/Metadata/Metadata_BuildingFootprints.md
- https://github.com/CityOfNewYork/nyc-geo-metadata/blob/main/Metadata/Metadata_AerialImagery.md
- https://www.nyc.gov/opendata/get-started/FAQs
- https://data.cityofnewyork.us/stories/s/Terms-of-Use/k9k7-3cje

The program uses only public export interfaces, with bounded concurrency (two or three requests at a time), timeouts, checkpoints and retries. No government login, CAPTCHA bypass, document-image mirroring or paid data subscription is used. Public availability does not imply permission for every future redistribution use; recheck source terms when expanding or deploying.

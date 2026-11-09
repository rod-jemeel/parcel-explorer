# Jev and source automation

The owner suggested Jev from TypeSafe AI to speed up research. Current official docs describe a model that takes supplied state and typed questions and returns choices, scores and probabilities. That is useful inside an automation worker; the application still needs retrieval tools and deterministic identifier/date/amount handling.

Official references, checked November 5, 2026:

- https://docs.typesafe.ai/introduction
- https://docs.typesafe.ai/primitives/choice
- https://docs.typesafe.ai/api/system-one

Recommended architecture:

1. Official APIs/bulk downloads first; HTTPX/urllib for retrieval and Playwright for individually reviewed permitted dynamic sources.
2. Archive the fetched public evidence and its source/edition/hash.
3. Parse fields deterministically where schemas exist. Exact BBL/BIN joins remain deterministic.
4. Optionally ask Jev to classify unstructured documents, rank candidate passages, choose among registered next-source routes, or send ambiguous cases to review. Give each question a narrow task and retain the answer, model version and probabilities.
5. A model suggestion never establishes property identity, legal ownership, price, historical geometry, or completeness. A document amount remains distinct from reported sale consideration, and no per-parcel allocation is invented.
6. Cache validated results and publish a consistent release; parcel clicks read local published data.

No TypeSafe API key is configured for this project and no live Jev calls have been made. A live integration needs a server-side key and a measured, labeled sample before thresholds or latency claims can be accepted. Never put a TypeSafe key in `NEXT_PUBLIC_*`, the static site, notes or browser storage.

The first data-quality issue reported by the owner (93 Remsen Street, BBL 3002480001 showing no imported history) was addressed through additional official API extraction: 45 ACRIS metadata records and six BIS permit rows were found. This demonstrates that improving source coverage is the immediate retrieval bottleneck. It does not establish that Jev would or would not improve a later classification stage.

# Data Coverage

This document describes the corpus included in the Bulgarian Cybersecurity MCP server.

## Summary

| Source | Type | Documents (seed) | Notes |
|--------|------|-----------------|-------|
| CERT-BG | Guidelines, advisories | ~5 sample guidance docs, ~3 sample advisories | Seed data only — run `npm run ingest` for full corpus |
| DANS | Recommendations, standards | ~2 sample guidance docs | Seed data only |
| NIS2 (BG) | Framework / compliance | 1 framework entry | Summary entry; full text via CERT-BG guidance |

> **Important:** The database shipped with this repository contains **sample seed data** for demonstration and testing purposes. To build a real corpus with current content, run the ingestion crawler:
>
> ```bash
> npm run ingest
> ```
>
> This will crawl CERT-BG and populate the database with live documents.

## Frameworks

Three framework series are represented:

| Framework ID | Name | Description |
|-------------|------|-------------|
| `CERT-BG` | CERT-BG Guidelines | Cybersecurity guidelines and recommendations published by the Bulgarian National CSIRT (CERT-BG), operated under the State Agency for National Security (DANS). |
| `DANS` | DANS Recommendations | Cybersecurity standards and national security recommendations published directly by DANS. |
| `NIS2` | NIS2 Implementation (Bulgaria) | Implementation guidance for the NIS2 Directive (EU 2022/2555) as transposed and applied in Bulgaria, covering critical infrastructure operators and essential/important entities. |

## Guidance Documents (sample seed)

The seed database includes representative sample documents to demonstrate the data model. Reference IDs follow the pattern `CERT-BG-G-XXX` (guidelines) and `DANS-R-YYYY-XX` (DANS recommendations).

Sample topics covered:
- Network security fundamentals
- Incident response procedures
- Risk management and assessment
- NIS2 compliance checklist
- Critical infrastructure protection

## Advisories (sample seed)

Sample advisories cover representative security event types:
- Critical vulnerability notifications (e.g., affecting widely-used enterprise software)
- Ransomware campaign alerts
- Phishing and social engineering warnings

Advisory references follow the pattern `CERT-BG-A-YYYY-XXX`.

## Coverage Gaps

- **Full corpus requires ingestion**: The seed data is not a complete representation of all CERT-BG publications. Run `npm run ingest` to populate.
- **Historical documents**: Older advisories and guidelines may not be crawled by the default ingest script.
- **Bulgarian-only content**: Most source documents are in Bulgarian. English titles (`title_en`) are provided where translations exist.

## Sources

See [TOOLS.md](TOOLS.md) for the `bg_cyber_list_sources` tool which returns machine-readable provenance at runtime.

- CERT-BG: https://www.govcert.bg/
- DANS: https://www.dans.bg/
- NIS2 Directive: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32022L2555

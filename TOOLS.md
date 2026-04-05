# Tool Reference

This document describes all 8 tools provided by the Bulgarian Cybersecurity MCP server.

All tools return structured JSON. Every response includes a `_meta` block with disclaimer, copyright, source URL, and data age notice.

---

## Search & Retrieval Tools

### `bg_cyber_search_guidance`

Full-text search across CERT-BG cybersecurity guidelines, recommendations, and national standards. Covers network security, incident response, risk management, and NIS2 implementation guidance published by CERT-BG and DANS.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query (e.g., `'мрежова сигурност'`, `'NIS2'`, `'киберсигурност'`) |
| `type` | enum | No | Filter by document type: `guideline`, `recommendation`, `standard`, `policy` |
| `series` | enum | No | Filter by issuing body: `CERT-BG`, `DANS`, `NIS2` |
| `status` | enum | No | Filter by status: `current`, `superseded`, `draft` |
| `limit` | number | No | Maximum results (default 20, max 100) |

**Returns:** `{ results: Guidance[], count: number, _meta: MetaBlock }`

---

### `bg_cyber_get_guidance`

Get a specific CERT-BG guidance document by its reference ID.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `reference` | string | Yes | Document reference (e.g., `'CERT-BG-G-001'`, `'DANS-R-2023-01'`) |

**Returns:** Full `Guidance` document with `_meta` block, or error if not found.

---

### `bg_cyber_search_advisories`

Search CERT-BG security advisories and alerts. Returns advisories with severity levels, affected products, and CVE references where available.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query (e.g., `'критична уязвимост'`, `'рансъмуер'`, `'фишинг'`) |
| `severity` | enum | No | Filter by severity: `critical`, `high`, `medium`, `low` |
| `limit` | number | No | Maximum results (default 20, max 100) |

**Returns:** `{ results: Advisory[], count: number, _meta: MetaBlock }`

---

### `bg_cyber_get_advisory`

Get a specific CERT-BG security advisory by its reference ID.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `reference` | string | Yes | Advisory reference (e.g., `'CERT-BG-A-2024-001'`) |

**Returns:** Full `Advisory` document with `_meta` block, or error if not found.

---

### `bg_cyber_list_frameworks`

List all cybersecurity frameworks and standard series covered in this MCP, including CERT-BG guidelines, DANS recommendations, and NIS2 implementation materials for Bulgaria.

**Parameters:** None

**Returns:** `{ frameworks: Framework[], count: number, _meta: MetaBlock }`

---

## Meta Tools

### `bg_cyber_about`

Return metadata about this MCP server: version, data source, coverage summary, and a list of all available tools.

**Parameters:** None

**Returns:** Server metadata object including name, version, description, data source URLs, coverage summary, and tool list.

---

### `bg_cyber_list_sources`

List all authoritative data sources used by this MCP server. Returns provenance metadata including source URLs, coverage scope, language, license, and update frequency for each source.

**Parameters:** None

**Returns:** `{ sources: Source[], _meta: MetaBlock }`

Sources returned:
- `cert-bg` — CERT-BG (Bulgarian National CSIRT), operated by DANS
- `dans` — State Agency for National Security (DANS)
- `nis2-bg` — NIS2 Directive (EU 2022/2555) Bulgarian implementation

---

### `bg_cyber_check_data_freshness`

Check the current state of the database: returns record counts and latest document dates for guidance, advisories, and frameworks. Use this to verify that the database has been populated and to check data currency.

**Parameters:** None

**Returns:**

```json
{
  "guidance_count": 5,
  "advisories_count": 3,
  "frameworks_count": 3,
  "latest_guidance_date": "2024-01-15",
  "latest_advisory_date": "2024-03-20",
  "checked_at": "2026-04-05T10:00:00.000Z",
  "_meta": { ... }
}
```

---

## `_meta` Block

Every tool response includes a `_meta` object:

```json
{
  "_meta": {
    "disclaimer": "Data sourced from CERT-BG and DANS official publications. This is a research tool — verify all references against primary sources before making compliance decisions. Not regulatory or legal advice.",
    "copyright": "Source data is the property of the respective Bulgarian government authorities (CERT-BG / DANS). Structured access provided by Ansvar Systems AB.",
    "source_url": "https://www.govcert.bg/",
    "data_age": "Periodic updates; may lag official publications. Use bg_cyber_check_data_freshness for current record counts and latest document dates."
  }
}
```

---

## Data Model

### Guidance

| Field | Type | Description |
|-------|------|-------------|
| `id` | number | Internal ID |
| `reference` | string | Unique document reference (e.g., `CERT-BG-G-001`) |
| `title` | string | Document title in Bulgarian |
| `title_en` | string \| null | English title (if available) |
| `date` | string \| null | Publication date (ISO format) |
| `type` | string \| null | Document type (guideline, recommendation, standard, policy) |
| `series` | string \| null | Issuing series (CERT-BG, DANS, NIS2) |
| `summary` | string \| null | Document summary |
| `full_text` | string | Full document text |
| `topics` | string \| null | Comma-separated topic tags |
| `status` | string | current, superseded, or draft |

### Advisory

| Field | Type | Description |
|-------|------|-------------|
| `id` | number | Internal ID |
| `reference` | string | Unique advisory reference (e.g., `CERT-BG-A-2024-001`) |
| `title` | string | Advisory title |
| `date` | string \| null | Publication date (ISO format) |
| `severity` | string \| null | critical, high, medium, or low |
| `affected_products` | string \| null | Comma-separated affected products |
| `summary` | string \| null | Advisory summary |
| `full_text` | string | Full advisory text |
| `cve_references` | string \| null | Comma-separated CVE IDs |

### Framework

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Framework identifier (CERT-BG, DANS, NIS2) |
| `name` | string | Framework name |
| `name_en` | string \| null | English name (if available) |
| `description` | string \| null | Framework description |
| `document_count` | number | Number of documents in this framework |

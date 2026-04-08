# Bulgarian Cybersecurity MCP

**Bulgarian cybersecurity data for AI compliance tools.**

[![npm version](https://badge.fury.io/js/%40ansvar%2Fbulgarian-cybersecurity-mcp.svg)](https://www.npmjs.com/package/@ansvar/bulgarian-cybersecurity-mcp)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![CI](https://github.com/Ansvar-Systems/bulgarian-cybersecurity-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Ansvar-Systems/bulgarian-cybersecurity-mcp/actions/workflows/ci.yml)

> **Note:** The CI badge above will become active once the first CI run completes on the `dev` or `main` branch.

Query Bulgarian cybersecurity data -- regulations, decisions, and requirements from CERT Bulgaria -- directly from Claude, Cursor, or any MCP-compatible client.

Built by [Ansvar Systems](https://ansvar.eu) -- Stockholm, Sweden

---

## Quick Start

### Use Remotely (No Install Needed)

> Connect directly to the hosted version -- zero dependencies, nothing to install.

**Endpoint:** `https://mcp.ansvar.eu/bulgarian-cybersecurity/mcp`

| Client | How to Connect |
|--------|---------------|
| **Claude.ai** | Settings > Connectors > Add Integration > paste URL |
| **Claude Code** | `claude mcp add bulgarian-cybersecurity-mcp --transport http https://mcp.ansvar.eu/bulgarian-cybersecurity/mcp` |
| **Claude Desktop** | Add to config (see below) |
| **GitHub Copilot** | Add to VS Code settings (see below) |

**Claude Desktop** -- add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bulgarian-cybersecurity-mcp": {
      "type": "url",
      "url": "https://mcp.ansvar.eu/bulgarian-cybersecurity/mcp"
    }
  }
}
```

**GitHub Copilot** -- add to VS Code `settings.json`:

```json
{
  "github.copilot.chat.mcp.servers": {
    "bulgarian-cybersecurity-mcp": {
      "type": "http",
      "url": "https://mcp.ansvar.eu/bulgarian-cybersecurity/mcp"
    }
  }
}
```

### Use Locally (npm)

```bash
npx @ansvar/bulgarian-cybersecurity-mcp
```

**Claude Desktop** -- add to `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "bulgarian-cybersecurity-mcp": {
      "command": "npx",
      "args": ["-y", "@ansvar/bulgarian-cybersecurity-mcp"]
    }
  }
}
```

**Cursor / VS Code:**

```json
{
  "mcp.servers": {
    "bulgarian-cybersecurity-mcp": {
      "command": "npx",
      "args": ["-y", "@ansvar/bulgarian-cybersecurity-mcp"]
    }
  }
}
```

---

## Available Tools (8)

| Tool | Description |
|------|-------------|
| `bg_cyber_search_guidance` | Full-text search across CERT-BG cybersecurity guidelines, recommendations, and national standards. Covers network sec... |
| `bg_cyber_get_guidance` | Get a specific CERT-BG guidance document by reference (e.g., |
| `bg_cyber_search_advisories` | Search CERT-BG security advisories and alerts. Returns advisories with severity, affected products, and CVE reference... |
| `bg_cyber_get_advisory` | Get a specific CERT-BG security advisory by reference (e.g., |
| `bg_cyber_list_frameworks` | List all cybersecurity frameworks and standard series covered in this MCP, including CERT-BG guidelines, DANS recomme... |
| `bg_cyber_about` | Return metadata about this MCP server: version, data source, coverage, and tool list. |
| `bg_cyber_list_sources` | List all authoritative data sources with provenance metadata, URLs, and coverage scope. |
| `bg_cyber_check_data_freshness` | Check database record counts and latest document dates for guidance, advisories, and frameworks. |

All tools return structured data with source references and timestamps. Every response includes a `_meta` block with disclaimer, copyright, and data-age notice.

See [TOOLS.md](TOOLS.md) for full parameter documentation.

---

## Data Sources and Freshness

All content is sourced from official Bulgarian regulatory publications:

- **CERT Bulgaria** -- Official regulatory authority

### Data Currency

- Database updates are periodic and may lag official publications
- Freshness checks run via GitHub Actions workflows
- Last-updated timestamps in tool responses indicate data age

See [COVERAGE.md](COVERAGE.md) for corpus documentation and [TOOLS.md](TOOLS.md) for tool-level source metadata.

---

## Security

This project uses multiple layers of automated security scanning:

| Scanner | What It Does | Schedule |
|---------|-------------|----------|
| **CodeQL** | Static analysis for security vulnerabilities | Weekly + PRs |
| **Semgrep** | SAST scanning (OWASP top 10, secrets, TypeScript) | Every push |
| **Gitleaks** | Secret detection across git history | Every push |
| **Trivy** | CVE scanning on filesystem and npm dependencies | Daily |
| **Docker Security** | Container image scanning + SBOM generation | Daily |
| **Socket.dev** | Supply chain attack detection | PRs |
| **Dependabot** | Automated dependency updates | Weekly |

See [SECURITY.md](SECURITY.md) for the full policy and vulnerability reporting.

---

## Important Disclaimers

### Not Regulatory Advice

> **THIS TOOL IS NOT REGULATORY OR LEGAL ADVICE**
>
> Regulatory data is sourced from official publications by CERT Bulgaria. However:
> - This is a **research tool**, not a substitute for professional regulatory counsel
> - **Verify all references** against primary sources before making compliance decisions
> - **Coverage may be incomplete** -- do not rely solely on this for regulatory research

**Before using professionally, read:** [DISCLAIMER.md](DISCLAIMER.md) | [PRIVACY.md](PRIVACY.md)

### Confidentiality

Queries go through the Claude API. For privileged or confidential matters, use on-premise deployment. See [PRIVACY.md](PRIVACY.md) for details.

---

## Development

### Setup

```bash
git clone https://github.com/Ansvar-Systems/bulgarian-cybersecurity-mcp
cd bulgarian-cybersecurity-mcp
npm install
npm run build
npm test
```

### Running Locally

```bash
npm run dev                                       # Start MCP server
npx @anthropic/mcp-inspector node dist/index.js   # Test with MCP Inspector
```

### Data Management

```bash
npm run seed    # Seed the SQLite database with sample data
npm run ingest  # Crawl CERT-BG and populate the database with live documents
```

---

## Related Projects

This server is part of **Ansvar's MCP fleet** -- 276 MCP servers covering law, regulation, and compliance across 119 jurisdictions.

### Law MCPs

Full national legislation for 108 countries. Example: [@ansvar/swedish-law-mcp](https://github.com/Ansvar-Systems/swedish-law-mcp) -- 2,415 Swedish statutes with EU cross-references.

### Sector Regulator MCPs

National regulatory authority data for 29 EU/EFTA countries across financial regulation, data protection, cybersecurity, and competition. This MCP is one of 116 sector regulator servers.

### Domain MCPs

Specialized compliance domains: [EU Regulations](https://github.com/Ansvar-Systems/EU_compliance_MCP), [Security Frameworks](https://github.com/Ansvar-Systems/security-frameworks-mcp), [Automotive Cybersecurity](https://github.com/Ansvar-Systems/Automotive-MCP), [OT/ICS Security](https://github.com/Ansvar-Systems/ot-security-mcp), [Sanctions](https://github.com/Ansvar-Systems/Sanctions-MCP), and more.

Browse the full fleet at [mcp.ansvar.eu](https://mcp.ansvar.eu).

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

Apache License 2.0. See [LICENSE](./LICENSE) for details.

### Data Licenses

Regulatory data sourced from official government publications. See [COVERAGE.md](COVERAGE.md) for per-source licensing details.

---

## About Ansvar Systems

We build AI-powered compliance and legal research tools for the European market. Our MCP fleet provides structured, verified regulatory data to AI assistants -- so compliance professionals can work with accurate sources instead of guessing.

**[ansvar.eu](https://ansvar.eu)** -- Stockholm, Sweden

---

<p align="center">
  <sub>Built with care in Stockholm, Sweden</sub>
</p>

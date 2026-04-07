#!/usr/bin/env node

/**
 * Bulgarian Cybersecurity MCP — stdio entry point.
 *
 * Provides MCP tools for querying CERT-BG (Bulgarian National Computer Security
 * Incident Response Team) guidelines, security advisories, and cybersecurity
 * frameworks relevant to Bulgaria.
 *
 * Tool prefix: bg_cyber_
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  searchGuidance,
  getGuidance,
  searchAdvisories,
  getAdvisory,
  listFrameworks,
} from "./db.js";
import { buildCitation } from "./citation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let pkgVersion = "0.1.0";
try {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf8"),
  ) as { version: string };
  pkgVersion = pkg.version;
} catch {
  // fallback to default
}

const SERVER_NAME = "bulgarian-cybersecurity-mcp";

// --- Tool definitions ---------------------------------------------------------

const TOOLS = [
  {
    name: "bg_cyber_search_guidance",
    description:
      "Full-text search across CERT-BG cybersecurity guidelines, recommendations, and national standards. Covers network security, incident response, risk management, and NIS2 implementation guidance published by CERT-BG and the State Agency for National Security (DANS). Returns matching documents with reference, title, series, and summary.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g., 'мрежова сигурност', 'управление на инциденти', 'NIS2', 'киберсигурност')",
        },
        type: {
          type: "string",
          enum: ["guideline", "recommendation", "standard", "policy"],
          description: "Filter by document type. Optional.",
        },
        series: {
          type: "string",
          enum: ["CERT-BG", "DANS", "NIS2"],
          description: "Filter by issuing body or series. Optional.",
        },
        status: {
          type: "string",
          enum: ["current", "superseded", "draft"],
          description: "Filter by document status. Defaults to returning all statuses.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return. Defaults to 20.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "bg_cyber_get_guidance",
    description:
      "Get a specific CERT-BG guidance document by reference (e.g., 'CERT-BG-G-001', 'DANS-R-2023-01').",
    inputSchema: {
      type: "object" as const,
      properties: {
        reference: {
          type: "string",
          description: "CERT-BG document reference (e.g., 'CERT-BG-G-001', 'DANS-R-2023-01')",
        },
      },
      required: ["reference"],
    },
  },
  {
    name: "bg_cyber_search_advisories",
    description:
      "Search CERT-BG security advisories and alerts. Returns advisories with severity, affected products, and CVE references where available.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g., 'критична уязвимост', 'рансъмуер', 'фишинг')",
        },
        severity: {
          type: "string",
          enum: ["critical", "high", "medium", "low"],
          description: "Filter by severity level. Optional.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return. Defaults to 20.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "bg_cyber_get_advisory",
    description:
      "Get a specific CERT-BG security advisory by reference (e.g., 'CERT-BG-A-2024-001').",
    inputSchema: {
      type: "object" as const,
      properties: {
        reference: {
          type: "string",
          description: "CERT-BG advisory reference (e.g., 'CERT-BG-A-2024-001')",
        },
      },
      required: ["reference"],
    },
  },
  {
    name: "bg_cyber_list_frameworks",
    description:
      "List all cybersecurity frameworks and standard series covered in this MCP, including CERT-BG guidelines, DANS recommendations, and NIS2 implementation materials for Bulgaria.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "bg_cyber_about",
    description: "Return metadata about this MCP server: version, data source, coverage, and tool list.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

// --- Zod schemas for argument validation --------------------------------------

const SearchGuidanceArgs = z.object({
  query: z.string().min(1),
  type: z.enum(["guideline", "recommendation", "standard", "policy"]).optional(),
  series: z.enum(["CERT-BG", "DANS", "NIS2"]).optional(),
  status: z.enum(["current", "superseded", "draft"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const GetGuidanceArgs = z.object({
  reference: z.string().min(1),
});

const SearchAdvisoriesArgs = z.object({
  query: z.string().min(1),
  severity: z.enum(["critical", "high", "medium", "low"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const GetAdvisoryArgs = z.object({
  reference: z.string().min(1),
});

// --- Helper ------------------------------------------------------------------

function textContent(data: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
    ],
  };
}

function errorContent(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

// --- Server setup ------------------------------------------------------------

const server = new Server(
  { name: SERVER_NAME, version: pkgVersion },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case "bg_cyber_search_guidance": {
        const parsed = SearchGuidanceArgs.parse(args);
        const results = searchGuidance({
          query: parsed.query,
          type: parsed.type,
          series: parsed.series,
          status: parsed.status,
          limit: parsed.limit,
        });
        return textContent({ results, count: results.length });
      }

      case "bg_cyber_get_guidance": {
        const parsed = GetGuidanceArgs.parse(args);
        const doc = getGuidance(parsed.reference);
        if (!doc) {
          return errorContent(`Guidance document not found: ${parsed.reference}`);
        }
        return textContent({
          ...(typeof doc === 'object' ? doc : { data: doc }),
          _citation: buildCitation(
            (doc as any).reference || parsed.reference,
            (doc as any).title || (doc as any).subject || '',
            'bg_cyber_get_guidance',
            { reference: parsed.reference },
            (doc as any).url || null,
          ),
        });
      }

      case "bg_cyber_search_advisories": {
        const parsed = SearchAdvisoriesArgs.parse(args);
        const results = searchAdvisories({
          query: parsed.query,
          severity: parsed.severity,
          limit: parsed.limit,
        });
        return textContent({ results, count: results.length });
      }

      case "bg_cyber_get_advisory": {
        const parsed = GetAdvisoryArgs.parse(args);
        const advisory = getAdvisory(parsed.reference);
        if (!advisory) {
          return errorContent(`Advisory not found: ${parsed.reference}`);
        }
        return textContent({
          ...(typeof advisory === 'object' ? advisory : { data: advisory }),
          _citation: buildCitation(
            (advisory as any).reference || parsed.reference,
            (advisory as any).title || (advisory as any).subject || '',
            'bg_cyber_get_advisory',
            { reference: parsed.reference },
            (advisory as any).url || null,
          ),
        });
      }

      case "bg_cyber_list_frameworks": {
        const frameworks = listFrameworks();
        return textContent({ frameworks, count: frameworks.length });
      }

      case "bg_cyber_about": {
        return textContent({
          name: SERVER_NAME,
          version: pkgVersion,
          description:
            "CERT-BG (Bulgarian National Computer Security Incident Response Team) MCP server. Provides access to Bulgarian cybersecurity guidelines, security advisories, and national cybersecurity framework materials including NIS2 implementation guidance.",
          data_source: "CERT-BG (https://www.govcert.bg/) and State Agency for National Security — DANS (https://www.dans.bg/)",
          coverage: {
            guidance: "CERT-BG guidelines, DANS recommendations, NIS2 implementation materials for Bulgaria",
            advisories: "CERT-BG security advisories and alerts",
            frameworks: "National cybersecurity frameworks, NIS2 compliance, critical infrastructure protection",
          },
          tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
        });
      }

      default:
        return errorContent(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorContent(`Error executing ${name}: ${message}`);
  }
});

// --- Main --------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`${SERVER_NAME} v${pkgVersion} running on stdio\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

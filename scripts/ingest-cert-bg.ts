/**
 * CERT-BG Ingestion Crawler
 *
 * Scrapes the CERT Bulgaria website (govcert.bg) and populates the SQLite
 * database with real security advisories, guidance documents, and frameworks
 * from Bulgaria's national CSIRT.
 *
 * Data sources:
 *   1. Предупреждения (Warnings)   — paginated listing at /en/category/warnings/
 *   2. Съвети (Advices)            — listing at /en/category/advices/
 *   3. Документи (Documents)       — static documents page
 *
 * Content language: Bulgarian (original)
 *
 * The site is a WordPress installation using the GeneratePress theme. Listing
 * pages show 10 entries each, with numbered pagination up to ~38 pages for
 * warnings. Individual posts use standard WordPress article markup with
 * .entry-content for the body and .entry-meta for date/author metadata.
 *
 * Usage:
 *   npx tsx scripts/ingest-cert-bg.ts                   # full crawl
 *   npx tsx scripts/ingest-cert-bg.ts --resume          # resume from last checkpoint
 *   npx tsx scripts/ingest-cert-bg.ts --dry-run         # log what would be inserted
 *   npx tsx scripts/ingest-cert-bg.ts --force           # drop and recreate DB first
 *   npx tsx scripts/ingest-cert-bg.ts --advisories-only # only crawl advisories (warnings)
 *   npx tsx scripts/ingest-cert-bg.ts --guidance-only   # only crawl guidance (advices)
 */

import Database from "better-sqlite3";
import * as cheerio from "cheerio";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DB_PATH = process.env["CERT_BG_DB_PATH"] ?? "data/cert-bg.db";
const PROGRESS_FILE = resolve(dirname(DB_PATH), "ingest-progress.json");
const BASE_URL = "https://www.govcert.bg";

const WARNINGS_LISTING = `${BASE_URL}/en/category/warnings/`;
const ADVICES_LISTING = `${BASE_URL}/en/category/advices/`;

const RATE_LIMIT_MS = 1500;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 2000;
const REQUEST_TIMEOUT_MS = 30_000;
const USER_AGENT =
  "AnsvarCERTbgCrawler/1.0 (+https://ansvar.eu; compliance research)";

// CLI flags
const args = process.argv.slice(2);
const force = args.includes("--force");
const dryRun = args.includes("--dry-run");
const resume = args.includes("--resume");
const advisoriesOnly = args.includes("--advisories-only");
const guidanceOnly = args.includes("--guidance-only");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GuidanceRow {
  reference: string;
  title: string;
  title_en: string | null;
  date: string | null;
  type: string;
  series: string;
  summary: string;
  full_text: string;
  topics: string;
  status: string;
}

interface AdvisoryRow {
  reference: string;
  title: string;
  date: string | null;
  severity: string | null;
  affected_products: string | null;
  summary: string;
  full_text: string;
  cve_references: string | null;
}

interface FrameworkRow {
  id: string;
  name: string;
  name_en: string | null;
  description: string;
  document_count: number;
}

interface Progress {
  completed_warning_urls: string[];
  completed_advice_urls: string[];
  last_updated: string;
}

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

const counters = {
  advisories_inserted: 0,
  advisories_skipped: 0,
  guidance_inserted: 0,
  guidance_skipped: 0,
  pages_fetched: 0,
  errors: 0,
};

// ---------------------------------------------------------------------------
// Utility: rate-limited fetch with retry
// ---------------------------------------------------------------------------

let lastRequestTime = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function rateLimitedFetch(
  url: string,
  opts?: RequestInit,
): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - elapsed);
  }

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      lastRequestTime = Date.now();
      const resp = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8",
          "Accept-Language": "bg,en;q=0.5",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...opts,
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} for ${url}`);
      }
      return resp;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        `  [retry ${attempt}/${MAX_RETRIES}] ${url}: ${lastError.message}`,
      );
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BACKOFF_MS * attempt);
      }
    }
  }
  throw lastError!;
}

async function fetchText(url: string): Promise<string> {
  const resp = await rateLimitedFetch(url);
  counters.pages_fetched++;
  return resp.text();
}

// ---------------------------------------------------------------------------
// Bulgarian month names to numeric month (01-12)
// ---------------------------------------------------------------------------

const BG_MONTHS: Record<string, string> = {
  // Full names
  "януари": "01",
  "февруари": "02",
  "март": "03",
  "април": "04",
  "май": "05",
  "юни": "06",
  "юли": "07",
  "август": "08",
  "септември": "09",
  "октомври": "10",
  "ноември": "11",
  "декември": "12",
  // Abbreviated
  "ян": "01",
  "фев": "02",
  "мар": "03",
  "апр": "04",
  "юн": "06",
  "юл": "07",
  "авг": "08",
  "сеп": "09",
  "окт": "10",
  "ное": "11",
  "дек": "12",
};

// ---------------------------------------------------------------------------
// HTML parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse a Bulgarian date string into ISO format (YYYY-MM-DD).
 * Handles formats:
 *   - "23.07.2025" (DD.MM.YYYY)
 *   - "18.03.2025" with optional time suffix
 *   - "15 март 2024" (DD month YYYY)
 *   - RFC 2822 dates from meta tags
 */
function parseBulgarianDate(dateStr: string): string | null {
  if (!dateStr) return null;
  const s = dateStr.trim();

  // "23.07.2025" or "18.03.2025 14:17"
  const numericMatch = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (numericMatch) {
    const day = numericMatch[1]!.padStart(2, "0");
    const month = numericMatch[2]!.padStart(2, "0");
    const year = numericMatch[3]!;
    return `${year}-${month}-${day}`;
  }

  // "15 март 2024" or "5 януари 2023"
  const longMatch = s.match(/(\d{1,2})\s+(\S+)\s+(\d{4})/);
  if (longMatch) {
    const day = longMatch[1]!.padStart(2, "0");
    const monthName = longMatch[2]!.toLowerCase();
    const year = longMatch[3]!;
    const month = BG_MONTHS[monthName];
    if (month) {
      return `${year}-${month}-${day}`;
    }
  }

  // Try RFC 2822 / ISO / Date.parse
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  } catch {
    // Ignore
  }

  return null;
}

/**
 * Extract CVE references from text. Returns JSON array string or null.
 */
function extractCves(text: string): string | null {
  const cves = new Set<string>();
  const re = /CVE-\d{4}-\d{4,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    cves.add(m[0]);
  }
  return cves.size > 0 ? JSON.stringify(Array.from(cves).sort()) : null;
}

/**
 * Extract affected product names from advisory text.
 * Looks for product names in the title and body text.
 */
function extractAffectedProducts(title: string, text: string): string | null {
  const products = new Set<string>();

  const productPatterns: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /Microsoft\s+(?:Windows|Office|Exchange|SharePoint|Edge|SQL Server|\.NET|Azure|Outlook|Teams|365)/gi, name: "" },
    { pattern: /Apache\s+(?:Tomcat|HTTP Server|Struts|Log4j|ActiveMQ|Kafka|Camel)/gi, name: "" },
    { pattern: /Cisco\s+(?:IOS|NX-OS|ASA|Firepower|Meraki|Webex|AnyConnect|ISE|DNA|SD-WAN|Secure\s+\w+)/gi, name: "" },
    { pattern: /Fortinet\s+(?:FortiOS|FortiGate|FortiManager|FortiAnalyzer|FortiClient|FortiSIEM|FortiWeb|FortiProxy|FortiNAC|FortiSwitch)/gi, name: "" },
    { pattern: /Ivanti\s+(?:Connect Secure|Policy Secure|EPMM|Neurons|Avalanche|Sentry|ZTA)/gi, name: "" },
    { pattern: /Palo Alto\s+(?:Networks|PAN-OS|GlobalProtect|Cortex|Prisma)/gi, name: "" },
    { pattern: /VMware\s+(?:ESXi|vCenter|vSphere|Workstation|Fusion|Aria|NSX|Horizon)/gi, name: "" },
    { pattern: /Juniper\s+(?:Junos|SRX|EX|QFX|MX|Secure Analytics|Networks)/gi, name: "" },
    { pattern: /Apple\s+(?:iOS|iPadOS|macOS|watchOS|tvOS|Safari|visionOS|Xcode)/gi, name: "" },
    { pattern: /Adobe\s+(?:Acrobat|Reader|Flash|ColdFusion|Commerce|Experience Manager|Photoshop|InDesign|Illustrator)/gi, name: "" },
    { pattern: /(?:OpenSSL|OpenSSH|WordPress|Drupal|Joomla|Magento|Jenkins|GitLab|Zimbra|SonicWall|Zyxel|QNAP|Synology|F5\s+BIG-IP|Citrix\s+ADC|SAP\s+NetWeaver)/gi, name: "" },
    { pattern: /(?:Google\s+Chrome|Mozilla\s+Firefox|Linux\s+Kernel|Android)/gi, name: "" },
  ];

  const combined = title + " " + text;
  for (const { pattern } of productPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(combined)) !== null) {
      products.add(match[0].trim());
    }
  }

  return products.size > 0
    ? JSON.stringify(Array.from(products).slice(0, 20))
    : null;
}

/**
 * Infer severity from page text by looking for CVSS scores and keywords.
 * Uses Bulgarian and English keywords found in CERT-BG advisories.
 * Returns: "critical", "high", "medium", "low", or null.
 */
function inferSeverity(text: string): string | null {
  // Check for explicit CVSS score
  const cvssMatch = text.match(
    /CVSS(?:\s+(?:Base\s+)?Score)?[:\s]+(\d+(?:\.\d+)?)/i,
  );
  if (cvssMatch) {
    const score = parseFloat(cvssMatch[1]!);
    if (score >= 9.0) return "critical";
    if (score >= 7.0) return "high";
    if (score >= 4.0) return "medium";
    return "low";
  }

  const lower = text.toLowerCase();

  // Bulgarian severity keywords
  if (
    lower.includes("критичн") || // критична, критични, критично
    lower.includes("remote code execution") ||
    lower.includes("rce") ||
    lower.includes("активно експлоатиран") ||
    lower.includes("активно използван") ||
    lower.includes("zero-day") ||
    lower.includes("0-day")
  ) {
    return "critical";
  }
  if (
    lower.includes("висок") || // висока, високи
    lower.includes("сериозн") || // сериозна, сериозни
    lower.includes("спешн") || // спешно, спешна
    lower.includes("незабавн") || // незабавна, незабавно
    lower.includes("privilege escalation") ||
    lower.includes("arbitrary code")
  ) {
    return "high";
  }
  if (
    lower.includes("среден") ||
    lower.includes("средна") ||
    lower.includes("moderate") ||
    lower.includes("умерен")
  ) {
    return "medium";
  }
  if (
    lower.includes("ниск") || // ниска, ниски, нисък
    lower.includes("информационн") // информационна (informational)
  ) {
    return "low";
  }

  return null;
}

/**
 * Extract topics from a warning/guidance page as JSON array string.
 * Uses Bulgarian and English keywords commonly found on CERT-BG.
 */
function extractTopics(title: string, text: string): string {
  const topics: string[] = [];
  const lower = (title + " " + text).toLowerCase();

  const topicMap: Record<string, string> = {
    // Threat types
    "рансъмуер": "ransomware",
    "ransomware": "ransomware",
    "фишинг": "phishing",
    "phishing": "phishing",
    "malware": "malware",
    "зловреден": "malware",
    "ботнет": "botnet",
    "ddos": "DDoS",
    "denial of service": "DDoS",
    "отказ на услуга": "DDoS",
    "brute force": "brute_force",
    "брутфорс": "brute_force",
    "sql injection": "SQL_injection",
    "sql инжекц": "SQL_injection",
    "xss": "XSS",
    "zero-day": "zero_day",
    "0-day": "zero_day",

    // Technology areas
    "vpn": "VPN",
    "firewall": "firewall",
    "защитна стена": "firewall",
    "remote code execution": "RCE",
    "rce": "RCE",
    "криптограф": "encryption",
    "encryption": "encryption",
    "шифрован": "encryption",
    "автентикаци": "authentication",
    "authentication": "authentication",
    "mfa": "MFA",
    "двуфакторн": "MFA",
    "tls": "TLS",
    "ssl": "TLS",
    "dns": "DNS",

    // Domain areas
    "nis2": "NIS2",
    "nis 2": "NIS2",
    "директива 2022/2555": "NIS2",
    "критична инфраструктура": "critical_infrastructure",
    "critical infrastructure": "critical_infrastructure",
    "класифицирана информация": "classified_information",
    "supply chain": "supply_chain",
    "верига на доставки": "supply_chain",
    "инцидент": "incident_response",
    "incident response": "incident_response",
    "одит": "audit",
    "audit": "audit",
    "patch": "patch_management",
    "актуализаци": "patch_management",
    "backup": "backup",
    "резервн": "backup",
    "уеб приложени": "web_security",
    "web application": "web_security",
    "scada": "SCADA",
    "ics": "ICS",
    "iot": "IoT",
    "active directory": "Active_Directory",
    "облачн": "cloud_security",
    "cloud": "cloud_security",

    // Vendors (when they appear as subjects)
    "cisco": "Cisco",
    "microsoft": "Microsoft",
    "fortinet": "Fortinet",
    "ivanti": "Ivanti",
    "oracle": "Oracle",
    "apache": "Apache",
    "linux": "Linux",
    "windows": "Windows",
    "android": "Android",
    "apple": "Apple",
    "vmware": "VMware",
    "adobe": "Adobe",
    "juniper": "Juniper",
    "palo alto": "Palo_Alto",
    "wordpress": "WordPress",
    "openssl": "OpenSSL",
    "sap": "SAP",
  };

  for (const [keyword, topic] of Object.entries(topicMap)) {
    if (lower.includes(keyword) && !topics.includes(topic)) {
      topics.push(topic);
    }
  }

  // Cap at 8 topics
  return JSON.stringify(topics.slice(0, 8));
}

/**
 * Build a reference ID from a govcert.bg URL.
 *
 * URL patterns observed:
 *   /en/warnings/уязвимост-в-apache-tomcat/           -> CERT-BG-W-уязвимост-в-apache-tomcat
 *   /en/warnings/fortinet-публикува-актуализации.../   -> CERT-BG-W-fortinet-публикува-...
 *   /en/warnings/4441/                                -> CERT-BG-W-4441
 *   /en/advices/data-breach/                          -> CERT-BG-A-data-breach
 */
function buildReference(url: string, type: "W" | "A"): string {
  const path = url.replace(BASE_URL, "").replace(/^\/+/, "");
  // path: en/warnings/slug/ or en/advices/slug/
  const parts = path.replace(/\/+$/, "").split("/");
  // The slug is the last part after "warnings" or "advices"
  const slug = decodeURIComponent(parts[parts.length - 1] ?? "unknown")
    .slice(0, 80)
    .replace(/\s+/g, "-");

  return `CERT-BG-${type}-${slug}`;
}

// ---------------------------------------------------------------------------
// Detail page scraper
// ---------------------------------------------------------------------------

interface DetailPage {
  title: string;
  date: string | null;
  fullText: string;
  sourceLinks: string[];
}

/**
 * Scrape a single govcert.bg detail page (warning or advice).
 *
 * The site uses WordPress with GeneratePress theme. Structure:
 *   - Title in <h1> (inside .entry-header or article)
 *   - Date in .entry-meta (format: DD.MM.YYYY)
 *   - Body in .entry-content
 */
async function scrapeDetailPage(url: string): Promise<DetailPage> {
  const html = await fetchText(url);
  const $ = cheerio.load(html);

  // Title: h1 in the article or main content area
  const title =
    $("article h1, .entry-header h1, .inside-article h1, h1.entry-title")
      .first()
      .text()
      .trim() ||
    $("h1").first().text().trim() ||
    $("title")
      .text()
      .replace(/\s*[-–]\s*CERT Bulgaria.*$/i, "")
      .trim();

  // Date: extract from .entry-meta, which contains text like "23.07.2025 by bgrancharov"
  let dateStr: string | null = null;

  // Strategy 1: look in .entry-meta for DD.MM.YYYY pattern
  const metaText = $(".entry-meta, .post-meta, .posted-on").first().text();
  if (metaText) {
    const dateMatch = metaText.match(/(\d{1,2}\.\d{1,2}\.\d{4})/);
    if (dateMatch) {
      dateStr = parseBulgarianDate(dateMatch[1]!);
    }
  }

  // Strategy 2: look for <time> element with datetime attribute
  if (!dateStr) {
    const timeEl = $("time[datetime]").first();
    if (timeEl.length > 0) {
      const datetime = timeEl.attr("datetime");
      if (datetime) {
        dateStr = parseBulgarianDate(datetime);
      }
    }
  }

  // Strategy 3: scan the first few paragraphs for a date pattern
  if (!dateStr) {
    $("article p, .entry-content p")
      .slice(0, 5)
      .each((_i, el) => {
        const text = $(el).text().trim();
        const dateMatch = text.match(
          /(\d{1,2}\.\d{1,2}\.\d{4}|\d{1,2}\s+\S+\s+\d{4})/,
        );
        if (dateMatch && !dateStr) {
          dateStr = parseBulgarianDate(dateMatch[1]!);
        }
      });
  }

  // Full text: all text from .entry-content (the WordPress content div)
  const contentArea = $(".entry-content, article .content, article").first();
  const fullText = contentArea.text().replace(/\s+/g, " ").trim();

  // Source links: external links from the content area
  const sourceLinks: string[] = [];
  contentArea.find('a[href^="http"]').each((_i, el) => {
    const href = $(el).attr("href");
    if (
      href &&
      !href.includes("govcert.bg/en/category") &&
      !href.includes("govcert.bg/en/warnings") &&
      !href.includes("govcert.bg/en/advices")
    ) {
      sourceLinks.push(href);
    }
  });

  return { title, date: dateStr, fullText, sourceLinks };
}

// ---------------------------------------------------------------------------
// Listing page scraper
// ---------------------------------------------------------------------------

interface ListingEntry {
  url: string;
  title: string;
  dateBrief: string;
  summary: string;
}

/**
 * Scrape a govcert.bg listing page (warnings or advices).
 *
 * The site uses WordPress with GeneratePress. Listing pages show entries with
 * a heading (linked title), date/author metadata, excerpt text, and a
 * "[Read more]" link. Pagination uses numbered page links at the bottom:
 *   /en/category/warnings/page/2/, /page/3/, ... /page/38/
 *
 * Returns entries found and the URL of the next page (or null).
 */
async function scrapeListingPage(
  pageUrl: string,
): Promise<{ entries: ListingEntry[]; nextPageUrl: string | null }> {
  const html = await fetchText(pageUrl);
  const $ = cheerio.load(html);
  const entries: ListingEntry[] = [];

  // Look for links pointing to individual warning or advice detail pages.
  // URL patterns: /en/warnings/slug/ or /en/advices/slug/
  const detailLinkPattern = /\/en\/(?:warnings|advices)\/[^/]+\/?$/;

  const seen = new Set<string>();

  // Strategy: find heading links inside article elements or content blocks
  // WordPress/GeneratePress lists articles with h2 titles containing <a> links
  $("h2 a[href], h3 a[href], .entry-title a[href]").each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    const fullHref = href.startsWith("http")
      ? href
      : `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`;

    if (detailLinkPattern.test(fullHref) && !seen.has(fullHref)) {
      seen.add(fullHref);
      const title = $(el).text().trim();

      if (title.length > 3) {
        // Look for date and summary near this link
        const parent = $(el).closest("article, div, section, li");
        const metaText = parent.find(".entry-meta, .post-meta").text().trim();
        const dateMatch = metaText.match(/(\d{1,2}\.\d{1,2}\.\d{4})/);
        const summaryEl = parent.find(".entry-summary, .entry-content, p");
        const summary = summaryEl.first().text().trim().slice(0, 400);

        entries.push({
          url: fullHref,
          title,
          dateBrief: dateMatch ? dateMatch[1]! : "",
          summary,
        });
      }
    }
  });

  // Also collect links from "Read more" or "[Прочетете повече]" that were missed
  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    const text = $(el).text().trim().toLowerCase();
    if (
      (text.includes("read more") || text.includes("прочетете")) &&
      detailLinkPattern.test(href)
    ) {
      const fullHref = href.startsWith("http")
        ? href
        : `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`;
      if (!seen.has(fullHref)) {
        seen.add(fullHref);
        entries.push({
          url: fullHref,
          title: "",
          dateBrief: "",
          summary: "",
        });
      }
    }
  });

  // Find next page URL from pagination.
  // WordPress pagination: numbered links + "Next" / "Следваща" arrow.
  // govcert.bg uses: Page1 [Page2] ... [Page38] [Next ->]
  let nextPageUrl: string | null = null;

  // Strategy 1: look for a "next" pagination link
  $("a.next, a.page-numbers.next, .nav-next a, .pagination-next a").each(
    (_i, el) => {
      if (!nextPageUrl) {
        const href = $(el).attr("href");
        if (href) {
          nextPageUrl = href.startsWith("http")
            ? href
            : `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`;
        }
      }
    },
  );

  // Strategy 2: find the current page number and look for current+1
  if (!nextPageUrl) {
    const currentPageMatch = pageUrl.match(/\/page\/(\d+)\/?/);
    const currentPage = currentPageMatch
      ? parseInt(currentPageMatch[1]!, 10)
      : 1;
    const nextPage = currentPage + 1;

    $("a[href]").each((_i, el) => {
      const href = $(el).attr("href") ?? "";
      const text = $(el).text().trim();
      if (
        text === String(nextPage) &&
        href.includes(`/page/${nextPage}`)
      ) {
        nextPageUrl = href.startsWith("http")
          ? href
          : `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`;
      }
    });
  }

  // Strategy 3: if on page 1 (no /page/ in URL) and we see /page/2/ links
  if (!nextPageUrl && !pageUrl.includes("/page/")) {
    $("a[href*='/page/2']").each((_i, el) => {
      if (!nextPageUrl) {
        const href = $(el).attr("href") ?? "";
        if (href.includes("/page/2")) {
          nextPageUrl = href.startsWith("http")
            ? href
            : `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`;
        }
      }
    });
  }

  return { entries, nextPageUrl };
}

/**
 * Crawl all pages of a listing, collecting all entry URLs.
 */
async function crawlAllListingPages(
  startUrl: string,
  label: string,
): Promise<ListingEntry[]> {
  const allEntries: ListingEntry[] = [];
  let currentUrl: string | null = startUrl;
  let pageNum = 1;

  while (currentUrl) {
    console.log(`  [${label}] Fetching page ${pageNum}: ${currentUrl}`);
    try {
      const { entries, nextPageUrl } = await scrapeListingPage(currentUrl);
      allEntries.push(...entries);
      console.log(
        `  [${label}] Page ${pageNum}: ${entries.length} entries found`,
      );
      currentUrl = nextPageUrl;
      pageNum++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [${label}] Error on page ${pageNum}: ${msg}`);
      counters.errors++;
      break;
    }
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const unique = allEntries.filter((e) => {
    if (seen.has(e.url)) return false;
    seen.add(e.url);
    return true;
  });

  console.log(
    `  [${label}] Total: ${unique.length} unique entries across ${pageNum - 1} pages`,
  );
  return unique;
}

// ---------------------------------------------------------------------------
// Advisory processing (Предупреждения / Warnings -> advisories table)
// ---------------------------------------------------------------------------

async function processWarning(
  db: Database.Database,
  url: string,
  progress: Progress,
): Promise<void> {
  if (resume && progress.completed_warning_urls.includes(url)) {
    counters.advisories_skipped++;
    return;
  }

  const reference = buildReference(url, "W");

  // Check if already in DB
  const existing = db
    .prepare("SELECT 1 FROM advisories WHERE reference = ?")
    .get(reference);
  if (existing) {
    counters.advisories_skipped++;
    progress.completed_warning_urls.push(url);
    return;
  }

  console.log(`    Scraping warning: ${url}`);
  let detail: DetailPage;
  try {
    detail = await scrapeDetailPage(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`    Error scraping ${url}: ${msg}`);
    counters.errors++;
    return;
  }

  if (!detail.fullText || detail.fullText.length < 50) {
    console.warn(`    Skipping ${url}: insufficient content`);
    counters.errors++;
    return;
  }

  const title = detail.title || reference;
  const date = detail.date;
  const severity = inferSeverity(detail.fullText);
  const cveRefs = extractCves(detail.fullText);
  const affectedProducts = extractAffectedProducts(title, detail.fullText);

  // Build summary from first 600 chars of body
  const summary = detail.fullText.slice(0, 600).trim();

  const row: AdvisoryRow = {
    reference,
    title,
    date,
    severity,
    affected_products: affectedProducts,
    summary,
    full_text: detail.fullText,
    cve_references: cveRefs,
  };

  if (dryRun) {
    console.log(`    [dry-run] Would insert advisory: ${reference}`);
    console.log(`      Title: ${title}`);
    console.log(`      Date: ${date ?? "unknown"}`);
    console.log(`      Severity: ${severity ?? "unknown"}`);
    console.log(`      CVEs: ${cveRefs ?? "none"}`);
    console.log(`      Products: ${affectedProducts ?? "none"}`);
    counters.advisories_inserted++;
  } else {
    try {
      db.prepare(
        `INSERT OR IGNORE INTO advisories
           (reference, title, date, severity, affected_products, summary, full_text, cve_references)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.reference,
        row.title,
        row.date,
        row.severity,
        row.affected_products,
        row.summary,
        row.full_text,
        row.cve_references,
      );
      counters.advisories_inserted++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`    DB insert error for ${reference}: ${msg}`);
      counters.errors++;
    }
  }

  progress.completed_warning_urls.push(url);
}

// ---------------------------------------------------------------------------
// Guidance processing (Съвети / Advices -> guidance table)
// ---------------------------------------------------------------------------

async function processAdvice(
  db: Database.Database,
  url: string,
  progress: Progress,
): Promise<void> {
  if (resume && progress.completed_advice_urls.includes(url)) {
    counters.guidance_skipped++;
    return;
  }

  const reference = buildReference(url, "A");

  // Check if already in DB
  const existing = db
    .prepare("SELECT 1 FROM guidance WHERE reference = ?")
    .get(reference);
  if (existing) {
    counters.guidance_skipped++;
    progress.completed_advice_urls.push(url);
    return;
  }

  console.log(`    Scraping advice: ${url}`);
  let detail: DetailPage;
  try {
    detail = await scrapeDetailPage(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`    Error scraping ${url}: ${msg}`);
    counters.errors++;
    return;
  }

  if (!detail.fullText || detail.fullText.length < 50) {
    console.warn(`    Skipping ${url}: insufficient content`);
    counters.errors++;
    return;
  }

  const title = detail.title || reference;
  const date = detail.date;
  const topics = extractTopics(title, detail.fullText);

  // Summary from first 600 chars
  const summary = detail.fullText.slice(0, 600).trim();

  const row: GuidanceRow = {
    reference,
    title,
    title_en: null, // The site mixes Bulgarian and English; no reliable translation
    date,
    type: "advice",
    series: "CERT-BG",
    summary,
    full_text: detail.fullText,
    topics,
    status: "current",
  };

  if (dryRun) {
    console.log(`    [dry-run] Would insert guidance: ${reference}`);
    console.log(`      Title: ${title}`);
    console.log(`      Date: ${date ?? "unknown"}`);
    console.log(`      Topics: ${topics}`);
    counters.guidance_inserted++;
  } else {
    try {
      db.prepare(
        `INSERT OR IGNORE INTO guidance
           (reference, title, title_en, date, type, series, summary, full_text, topics, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.reference,
        row.title,
        row.title_en,
        row.date,
        row.type,
        row.series,
        row.summary,
        row.full_text,
        row.topics,
        row.status,
      );
      counters.guidance_inserted++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`    DB insert error for ${reference}: ${msg}`);
      counters.errors++;
    }
  }

  progress.completed_advice_urls.push(url);
}

// ---------------------------------------------------------------------------
// Progress management
// ---------------------------------------------------------------------------

function loadProgress(): Progress {
  if (resume && existsSync(PROGRESS_FILE)) {
    try {
      const data = readFileSync(PROGRESS_FILE, "utf-8");
      const parsed = JSON.parse(data) as Progress;
      console.log(
        `Resuming from checkpoint (${parsed.completed_warning_urls.length} warnings, ${parsed.completed_advice_urls.length} advices completed)`,
      );
      return parsed;
    } catch {
      console.warn("Could not read progress file, starting fresh");
    }
  }
  return {
    completed_warning_urls: [],
    completed_advice_urls: [],
    last_updated: new Date().toISOString(),
  };
}

function saveProgress(progress: Progress): void {
  if (dryRun) return;
  progress.last_updated = new Date().toISOString();
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ---------------------------------------------------------------------------
// Framework seeding
// ---------------------------------------------------------------------------

function seedFrameworks(db: Database.Database): void {
  const frameworks: FrameworkRow[] = [
    {
      id: "cert-bg",
      name: "CERT-BG Насоки и препоръки",
      name_en: "CERT-BG Guidelines and Recommendations",
      description:
        "Официалните насоки и технически препоръки на CERT-BG за защита на информационни системи, реакция при инциденти и управление на киберрискове.",
      document_count: 0, // Updated after crawl
    },
    {
      id: "dans",
      name: "ДАНС — Препоръки за киберсигурност",
      name_en: "DANS — Cybersecurity Recommendations",
      description:
        "Препоръки на Държавна агенция 'Национална сигурност' за защита на класифицирана информация и критична инфраструктура.",
      document_count: 0,
    },
    {
      id: "nis2",
      name: "NIS2 — Национално прилагане",
      name_en: "NIS2 — National Implementation",
      description:
        "Материали за прилагане на Директива (ЕС) 2022/2555 (NIS2) в България.",
      document_count: 0,
    },
    {
      id: "zks",
      name: "ЗКС — Закон за киберсигурност",
      name_en: "ZKS — Cybersecurity Act",
      description:
        "Документи свързани със Закона за киберсигурност (ЗКС) и подзаконовите нормативни актове за докладване на инциденти и управление на мрежовата и информационна сигурност.",
      document_count: 0,
    },
  ];

  const insert = db.prepare(
    "INSERT OR IGNORE INTO frameworks (id, name, name_en, description, document_count) VALUES (?, ?, ?, ?, ?)",
  );

  for (const f of frameworks) {
    insert.run(f.id, f.name, f.name_en, f.description, f.document_count);
  }

  console.log(`Seeded ${frameworks.length} frameworks`);
}

/**
 * Update framework document counts based on actual DB content.
 */
function updateFrameworkCounts(db: Database.Database): void {
  const guidanceCount = (
    db.prepare("SELECT count(*) as cnt FROM guidance").get() as { cnt: number }
  ).cnt;
  const advisoryCount = (
    db.prepare("SELECT count(*) as cnt FROM advisories").get() as {
      cnt: number;
    }
  ).cnt;

  // CERT-BG framework gets the total count of all guidance + advisories
  db.prepare("UPDATE frameworks SET document_count = ? WHERE id = ?").run(
    guidanceCount + advisoryCount,
    "cert-bg",
  );

  // NIS2 framework: count guidance docs with NIS2 in topics
  const nis2Count = (
    db
      .prepare(
        "SELECT count(*) as cnt FROM guidance WHERE topics LIKE '%NIS2%'",
      )
      .get() as { cnt: number }
  ).cnt;
  db.prepare("UPDATE frameworks SET document_count = ? WHERE id = ?").run(
    nis2Count,
    "nis2",
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== CERT-BG Ingestion Crawler ===");
  console.log(`Database: ${DB_PATH}`);
  console.log(
    `Mode: ${dryRun ? "DRY RUN" : force ? "FORCE (clean DB)" : resume ? "RESUME" : "FULL CRAWL"}`,
  );
  console.log();

  // --- Database setup -------------------------------------------------------

  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (force && existsSync(DB_PATH)) {
    unlinkSync(DB_PATH);
    console.log(`Deleted existing database at ${DB_PATH}`);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  console.log(`Database initialised at ${DB_PATH}`);

  // Seed frameworks
  seedFrameworks(db);

  // --- Load progress --------------------------------------------------------

  const progress = loadProgress();

  // --- Phase 1: Crawl Предупреждения (Warnings) -> advisories ---------------

  if (!guidanceOnly) {
    console.log("\n--- Phase 1: Crawling Предупреждения (Warnings) ---");

    const warningEntries = await crawlAllListingPages(
      WARNINGS_LISTING,
      "Warnings",
    );

    console.log(
      `\n  Processing ${warningEntries.length} warning detail pages...`,
    );

    for (let i = 0; i < warningEntries.length; i++) {
      const entry = warningEntries[i]!;
      console.log(
        `  [${i + 1}/${warningEntries.length}] ${entry.title || entry.url}`,
      );
      await processWarning(db, entry.url, progress);

      // Save progress every 25 entries
      if ((i + 1) % 25 === 0) {
        saveProgress(progress);
        console.log(`  -- checkpoint saved (${i + 1} processed) --`);
      }
    }

    saveProgress(progress);
    console.log(
      `\n  Warnings complete: ${counters.advisories_inserted} inserted, ${counters.advisories_skipped} skipped, ${counters.errors} errors`,
    );
  }

  // --- Phase 2: Crawl Съвети (Advices) -> guidance --------------------------

  if (!advisoriesOnly) {
    console.log("\n--- Phase 2: Crawling Съвети (Advices) ---");

    const adviceEntries = await crawlAllListingPages(
      ADVICES_LISTING,
      "Advices",
    );

    console.log(
      `\n  Processing ${adviceEntries.length} advice detail pages...`,
    );

    for (let i = 0; i < adviceEntries.length; i++) {
      const entry = adviceEntries[i]!;
      console.log(
        `  [${i + 1}/${adviceEntries.length}] ${entry.title || entry.url}`,
      );
      await processAdvice(db, entry.url, progress);

      // Save progress every 10 entries
      if ((i + 1) % 10 === 0) {
        saveProgress(progress);
        console.log(`  -- checkpoint saved (${i + 1} processed) --`);
      }
    }

    saveProgress(progress);
    console.log(
      `\n  Advices complete: ${counters.guidance_inserted} inserted, ${counters.guidance_skipped} skipped`,
    );
  }

  // --- Update framework counts ----------------------------------------------

  if (!dryRun) {
    updateFrameworkCounts(db);
  }

  // --- Summary --------------------------------------------------------------

  const guidanceCount = (
    db.prepare("SELECT count(*) as cnt FROM guidance").get() as { cnt: number }
  ).cnt;
  const advisoryCount = (
    db.prepare("SELECT count(*) as cnt FROM advisories").get() as {
      cnt: number;
    }
  ).cnt;
  const frameworkCount = (
    db.prepare("SELECT count(*) as cnt FROM frameworks").get() as {
      cnt: number;
    }
  ).cnt;

  console.log("\n=== Crawl Summary ===");
  console.log(`  Pages fetched:       ${counters.pages_fetched}`);
  console.log(
    `  Advisories inserted: ${counters.advisories_inserted} (skipped: ${counters.advisories_skipped})`,
  );
  console.log(
    `  Guidance inserted:   ${counters.guidance_inserted} (skipped: ${counters.guidance_skipped})`,
  );
  console.log(`  Errors:              ${counters.errors}`);
  console.log();
  console.log("Database totals:");
  console.log(`  Frameworks:  ${frameworkCount}`);
  console.log(`  Guidance:    ${guidanceCount}`);
  console.log(`  Advisories:  ${advisoryCount}`);
  console.log(`\nDone. Database at ${DB_PATH}`);

  db.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

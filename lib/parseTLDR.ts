export interface ParsedArticle {
  headline: string;
  link: string;
  summary: string;
  orderIndex: number;
  sectionLabel: string | null;
}

// TLDR changed subject format in 2026 — classify by utm_source in HTML body.
export function classifyNewsletter(subject: string, html: string = ""): "tldr" | "tldr_ai" | null {
  if (/utm_source=tldrai/i.test(html)) return "tldr_ai";
  if (/utm_source=tldrnewsletter/i.test(html)) return "tldr";
  // Fallback: old "TLDR AI 2025-01-01" subject format
  const words = subject.trim().split(/\s+/);
  if (words[0]?.toUpperCase() !== "TLDR") return null;
  const second = words[1] ?? "";
  if (second.toUpperCase() === "AI") return "tldr_ai";
  if (!second || /^\d/.test(second)) return "tldr";
  return null;
}

// Decode TLDR's tracking wrapper to get the real destination URL.
// Format: https://tracking.tldrnewsletter.com/CL0/<url-encoded-url>/<counter>/...
function decodeTrackingUrl(href: string): string {
  const m = href.match(/tracking\.tldrnewsletter\.com\/CL0\/([^/]+)\//);
  if (m) {
    try {
      const decoded = decodeURIComponent(m[1]);
      if (decoded.startsWith("http")) return decoded;
    } catch {}
  }
  return href;
}

// Strip UTM/tracking params so stored links are clean and deduplication works.
function cleanUrl(url: string): string {
  try {
    const u = new URL(url);
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "dub_id"].forEach(
      (p) => u.searchParams.delete(p),
    );
    return u.toString();
  } catch {
    return url;
  }
}

const SKIP_PATTERNS = [
  /^https?:\/\/tldr\.tech\//i,
  /^https?:\/\/a\.tldrnewsletter\.com\//i,
  /^https?:\/\/links\.tldrnewsletter\.com\//i,
  /^https?:\/\/advertise\.tldr\.tech\//i,
  /^https?:\/\/refer\.tldr\.tech\//i,
  /unsubscribe/i,
  /^mailto:/i,
  /list-manage\.com/i,
];

function isArticleUrl(rawDecoded: string, cleaned: string): boolean {
  if (!/^https?:\/\//i.test(cleaned)) return false;
  if (/utm_medium=sponsorship/i.test(rawDecoded)) return false;
  return !SKIP_PATTERNS.some((p) => p.test(cleaned));
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// Catches sponsored content AND newsletter footer noise (referrals, unsubscribe, author sign-off)
const NOISE_PATTERN =
  /\b(sponsor|advertisement|partner content|brought to you by|track your referrals?|manage your subscriptions?|unsubscribe|want to advertise|referrals?|apply here|created by dan)\b/i;

// Section headers in both TLDR and TLDR AI newsletters.
const SECTION_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /headlines?\s*[&+]\s*launches?/i, label: "Headlines & Launches" },
  { pattern: /research\s*[&+]\s*innovation/i, label: "Research & Innovation" },
  { pattern: /engineering\s*[&+]\s*resources?/i, label: "Engineering & Resources" },
  { pattern: /big\s+tech\s*[&+]\s*startups?/i, label: "Big Tech & Startups" },
  { pattern: /science\s*[&+]\s*futuristic\s+technology/i, label: "Science & Futuristic Technology" },
  { pattern: /programming[,\s]*design\s*[&+]\s*data\s+science/i, label: "Programming, Design & Data Science" },
  // Miscellaneous and Quick Links must be anchored to avoid false matches in article text
  { pattern: /^[^a-z]*miscellaneous[^a-z]*$/i, label: "Miscellaneous" },
  { pattern: /^[^a-z]*quick\s+links?[^a-z]*$/i, label: "Quick Links" },
];

// Extract section markers by scanning short-text block elements only.
// This prevents false matches from article summaries which contain the same keywords.
function extractSectionMarkers(html: string): { label: string; index: number }[] {
  const markers: { label: string; index: number }[] = [];

  // Match content inside table cells, headings, and paragraphs
  const blockPattern = /<(?:td|th|h[1-6]|p)[^>]*>([\s\S]*?)<\/(?:td|th|h[1-6]|p)>/gi;
  let m: RegExpExecArray | null;

  while ((m = blockPattern.exec(html)) !== null) {
    const innerText = stripTags(m[1]).trim();
    // Section headers are short; skip anything that looks like article content
    if (innerText.length === 0 || innerText.length > 80) continue;

    for (const { pattern, label } of SECTION_PATTERNS) {
      if (pattern.test(innerText)) {
        markers.push({ label, index: m.index });
        break;
      }
    }
  }

  return markers.sort((a, b) => a.index - b.index);
}

export function parseTldrHtml(html: string): ParsedArticle[] {
  const sectionMarkers = extractSectionMarkers(html);

  function sectionAt(anchorIndex: number): string | null {
    let current: string | null = null;
    for (const marker of sectionMarkers) {
      if (marker.index > anchorIndex) break;
      current = marker.label;
    }
    return current;
  }

  const anchorPattern = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  interface Anchor {
    cleanedHref: string;
    text: string;
    index: number;
    end: number;
  }

  const anchors: Anchor[] = [];
  let match: RegExpExecArray | null;

  while ((match = anchorPattern.exec(html)) !== null) {
    const rawHref = match[1];
    const decoded = decodeTrackingUrl(rawHref);
    const cleaned = cleanUrl(decoded);
    if (!isArticleUrl(decoded, cleaned)) continue;
    const text = stripTags(match[2]);
    if (text.length < 12) continue;
    anchors.push({ cleanedHref: cleaned, text, index: match.index, end: match.index + match[0].length });
  }

  const articles: ParsedArticle[] = [];
  const seenLinks = new Set<string>();
  let orderIndex = 0;

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    if (seenLinks.has(anchor.cleanedHref)) continue;

    const sliceEnd = anchors[i + 1]?.index ?? Math.min(html.length, anchor.end + 2000);
    const between = html.slice(anchor.end, sliceEnd);
    const summary = stripTags(between).replace(/\(\d+\s*minute read\)/i, "").trim();

    // Filter sponsor content and newsletter footer noise (referrals, unsubscribe, author sign-off)
    if (NOISE_PATTERN.test(anchor.text) || NOISE_PATTERN.test(summary)) continue;

    seenLinks.add(anchor.cleanedHref);
    articles.push({
      headline: anchor.text,
      link: anchor.cleanedHref,
      summary: summary.slice(0, 500),
      orderIndex: orderIndex++,
      sectionLabel: sectionAt(anchor.index),
    });
  }

  return articles;
}

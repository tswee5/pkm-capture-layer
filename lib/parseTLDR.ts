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
  /^https?:\/\/advertise\.tldr\.tech\//i,
  /^https?:\/\/refer\.tldr\.tech\//i,
  // TLDR's own recruiting page — always self-promotional job posts, never real content
  /^https?:\/\/jobs\.ashbyhq\.com\//i,
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

// Catches footer noise (referrals, unsubscribe, author sign-off)
// NOTE: sponsor detection is handled separately via SPONSOR_LABEL below
const NOISE_PATTERN =
  /\b(advertisement|partner content|brought to you by|track your referrals?|manage your subscriptions?|unsubscribe|want to advertise|apply here|created by dan)\b/i;

// TLDR marks inline section sponsors with "(Sponsor)" or "(Sponsored)" at the end of the
// article headline — either embedded in the anchor text or as a separate short link that
// immediately follows the article link. We check both the headline text and the raw HTML
// of the whole article block so we catch either placement.
// NOTE: the "d" in "sponsored?" is deliberately the only optional letter — matches both
// "(Sponsor)" and "(Sponsored)" without requiring the literal (non-existent) "(Sponsore)".
const SPONSOR_LABEL = /\(sponsor(?:ed)?\)/i;

// Section headers in both TLDR and TLDR AI newsletters. Match current wording plus
// older/alternate phrasing TLDR has used, since they periodically rename sections
// (e.g. "Research & Innovation" -> "Deep Dives & Analysis", "Resources" -> "Research").
const SECTION_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /headlines?\s*[&+]\s*launches?/i, label: "Headlines & Launches" },
  { pattern: /deep\s+dives?\s*[&+]\s*analysis|research\s*[&+]\s*innovation/i, label: "Deep Dives & Analysis" },
  { pattern: /engineering\s*[&+]\s*(research|resources?)/i, label: "Engineering & Research" },
  { pattern: /big\s+tech\s*[&+]\s*startups?/i, label: "Big Tech & Startups" },
  { pattern: /science\s*[&+]\s*futuristic\s+technology/i, label: "Science & Futuristic Technology" },
  { pattern: /programming[,\s]*design\s*[&+]\s*data\s+science/i, label: "Programming, Design & Data Science" },
  // Miscellaneous and Quick Links must be anchored to avoid false matches in article text
  { pattern: /^[^a-z]*miscellaneous[^a-z]*$/i, label: "Miscellaneous" },
  { pattern: /^[^a-z]*quick\s+links?[^a-z]*$/i, label: "Quick Links" },
];

// TLDR's self-promotional footer ("referral program, advertise with us, sign-off") starts
// right after this line in every issue. Nothing past it is real content.
const FOOTER_MARKER = /love\s+tldr\??\s+tell\s+your\s+friends/i;

// Each article/sponsor item is wrapped in this exact table cell across both TLDR and TLDR AI.
// Splitting on it (rather than anchor-to-anchor adjacency) means only the first link in each
// item counts as its headline — inline CTA links inside sponsor copy no longer leak through
// as separate fake articles.
const ARTICLE_BLOCK = /<td class="container" style="padding:\s*15px\s*15px;">/gi;

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
  const footerCutoff = html.search(FOOTER_MARKER);
  const content = footerCutoff === -1 ? html : html.slice(0, footerCutoff);

  const sectionMarkers = extractSectionMarkers(content);

  function sectionAt(blockIndex: number): string | null {
    let current: string | null = null;
    for (const marker of sectionMarkers) {
      if (marker.index > blockIndex) break;
      current = marker.label;
    }
    return current;
  }

  // ARTICLE_BLOCK is a shared `g`-flag regex; reset lastIndex so a previous call's position
  // (this function runs once per email in a sync batch) doesn't leak into this one.
  ARTICLE_BLOCK.lastIndex = 0;
  const blockStarts: number[] = [];
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = ARTICLE_BLOCK.exec(content)) !== null) {
    blockStarts.push(blockMatch.index);
  }

  const anchorPattern = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;

  const articles: ParsedArticle[] = [];
  const seenLinks = new Set<string>();
  let orderIndex = 0;

  for (let i = 0; i < blockStarts.length; i++) {
    const blockStart = blockStarts[i];
    const blockEnd = blockStarts[i + 1] ?? content.length;
    const block = content.slice(blockStart, blockEnd);

    // Only the first link in each item block is the headline — anything else (inline CTA
    // links in sponsor copy, etc.) is treated as summary text, not a separate article.
    const anchorMatch = anchorPattern.exec(block);
    if (!anchorMatch) continue;

    const decoded = decodeTrackingUrl(anchorMatch[1]);
    const cleaned = cleanUrl(decoded);
    if (!isArticleUrl(decoded, cleaned)) continue;

    const headline = stripTags(anchorMatch[2]);
    if (headline.length < 12) continue;
    if (seenLinks.has(cleaned)) continue;

    const afterAnchor = block.slice(anchorMatch.index + anchorMatch[0].length);
    const summary = stripTags(afterAnchor).replace(/\(\d+\s*minute read\)/i, "").trim();

    // SPONSOR_LABEL checks both the headline and the whole block's raw HTML, since TLDR
    // sometimes places "(Sponsor)" as a separate short tag rather than in the headline itself.
    const isSponsor =
      SPONSOR_LABEL.test(headline) ||
      SPONSOR_LABEL.test(block) ||
      NOISE_PATTERN.test(headline) ||
      NOISE_PATTERN.test(summary);
    if (isSponsor) continue;

    seenLinks.add(cleaned);
    articles.push({
      headline,
      link: cleaned,
      summary: summary.slice(0, 500),
      orderIndex: orderIndex++,
      sectionLabel: sectionAt(blockStart),
    });
  }

  return articles;
}

export interface ParsedArticle {
  headline: string;
  link: string;
  summary: string;
}

// Sender publishes several newsletters (TLDR, TLDR AI, TLDR Founders, TLDR
// Design, ...). Only TLDR and TLDR AI are wanted; everything else is
// classified as null and skipped.
export function classifyNewsletter(subject: string): "tldr" | "tldr_ai" | null {
  const words = subject.trim().split(/\s+/);
  if (words[0]?.toUpperCase() !== "TLDR") return null;

  const second = words[1] ?? "";
  if (second.toUpperCase() === "AI") return "tldr_ai";
  if (second === "" || /^\d/.test(second)) return "tldr";

  return null;
}

const SKIP_LINK_PATTERNS = [
  /tldrnewsletter\.com/i,
  /tldr\.tech/i,
  /unsubscribe/i,
  /^mailto:/i,
  /list-manage\.com/i,
  /beehiiv\.com/i,
  /\/advertise/i,
];

function isArticleLink(href: string): boolean {
  if (!/^https?:\/\//i.test(href)) return false;
  return !SKIP_LINK_PATTERNS.some((pattern) => pattern.test(href));
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

const SPONSOR_PATTERN = /\b(sponsor|advertisement|partner content)\b/i;

export function parseTldrHtml(html: string): ParsedArticle[] {
  const anchorPattern = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const anchors: { href: string; text: string; index: number; end: number }[] = [];

  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html)) !== null) {
    const text = stripTags(match[2]);
    if (text.length < 12) continue;
    if (!isArticleLink(match[1])) continue;
    anchors.push({ href: match[1], text, index: match.index, end: match.index + match[0].length });
  }

  const articles: ParsedArticle[] = [];
  const seenLinks = new Set<string>();

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    if (seenLinks.has(anchor.href)) continue;

    const sliceEnd = anchors[i + 1]?.index ?? Math.min(html.length, anchor.end + 2000);
    const between = html.slice(anchor.end, sliceEnd);
    const summary = stripTags(between).replace(/\(\d+\s*minute read\)/i, "").trim();

    if (SPONSOR_PATTERN.test(anchor.text) || SPONSOR_PATTERN.test(summary)) continue;

    seenLinks.add(anchor.href);
    articles.push({
      headline: anchor.text,
      link: anchor.href,
      summary: summary.slice(0, 500),
    });
  }

  return articles;
}

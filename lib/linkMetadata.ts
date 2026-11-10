// Best-effort link unfurl for manually captured items: og:title/description/image
// plus a crude readable-text extraction so saved items are still useful to search
// or hand to an AI agent even if the original URL later rots or paywalls.

import { decodeHtmlEntities } from "./htmlEntities";

export interface LinkMetadata {
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  domain: string;
  extractedText: string | null;
}

function metaContent(html: string, attr: "property" | "name", key: string): string | null {
  const re = new RegExp(
    `<meta[^>]+${attr}=["']${key}["'][^>]+content=["']([^"']*)["']`,
    "i",
  );
  const match = html.match(re) ?? html.match(
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${key}["']`, "i"),
  );
  return match ? match[1].trim() : null;
}

// Not a real readability algorithm — just strips script/style/nav/tags and
// collapses whitespace so there's *something* searchable beyond the title.
function extractReadableText(html: string): string | null {
  const body = html.replace(/^[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, "");
  const stripped = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const text = decodeHtmlEntities(stripped);
  if (text.length < 40) return null;
  return text.slice(0, 20000);
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export async function fetchLinkMetadata(url: string): Promise<LinkMetadata> {
  const domain = domainOf(url);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PersonalCaptureBot/1.0)" },
    });
    clearTimeout(timeout);
    if (!res.ok) return { title: null, description: null, imageUrl: null, domain, extractedText: null };

    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const rawTitle = metaContent(html, "property", "og:title") ?? titleMatch?.[1].trim() ?? null;
    const title = rawTitle ? decodeHtmlEntities(rawTitle) : null;
    const rawDescription =
      metaContent(html, "property", "og:description") ?? metaContent(html, "name", "description");
    const description = rawDescription ? decodeHtmlEntities(rawDescription) : null;
    let imageUrl = metaContent(html, "property", "og:image");
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
      try {
        imageUrl = new URL(imageUrl, url).toString();
      } catch {
        imageUrl = null;
      }
    }
    const extractedText = extractReadableText(html);

    return { title, description, imageUrl, domain, extractedText };
  } catch {
    return { title: null, description: null, imageUrl: null, domain, extractedText: null };
  }
}

// Canonicalizes a URL into a dedup key for manual captures: same page should
// map to the same key regardless of tracking params, fragments, scheme,
// www., trailing slash, or (for Twitter/X and youtu.be) known URL-shortener
// equivalents. Not meant for display or fetching — only for the
// (user_id, canonical_url) uniqueness check in lib/capture.ts.

const TRACKING_PARAM_PREFIXES = ["utm_"];

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "igshid",
  "ref",
  "ref_src",
  "ref_url",
  "source",
  "smid",
  "cmpid",
]);

const SI_PARAM_HOSTS = new Set(["youtube.com", "youtu.be", "spotify.com"]);

const TWITTER_HOSTS = new Set(["twitter.com", "mobile.twitter.com", "mobile.x.com"]);

function isTrackingParam(key: string, host: string): boolean {
  const lower = key.toLowerCase();
  if (TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  if (TRACKING_PARAMS.has(lower)) return true;
  if (lower === "si" && SI_PARAM_HOSTS.has(host)) return true;
  return false;
}

export function canonicalizeUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("url must be http(s)");
  }

  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  if (TWITTER_HOSTS.has(host)) host = "x.com";

  let pathname = parsed.pathname;
  const params = new URLSearchParams(parsed.search);

  if (host === "youtu.be") {
    const videoId = pathname.replace(/^\//, "").split("/")[0];
    const t = params.get("t");
    for (const key of Array.from(params.keys())) params.delete(key);
    host = "youtube.com";
    pathname = "/watch";
    if (videoId) params.set("v", videoId);
    if (t) params.set("t", t);
  }

  if (host === "x.com") {
    for (const key of Array.from(params.keys())) params.delete(key);
  } else {
    for (const key of Array.from(params.keys())) {
      if (isTrackingParam(key, host)) params.delete(key);
    }
  }

  const sortedEntries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const sortedParams = new URLSearchParams();
  for (const [key, value] of sortedEntries) sortedParams.append(key, value);

  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.replace(/\/+$/, "") || "/";
  }

  let port = parsed.port;
  if (port === "80" || port === "443") port = "";

  const query = sortedParams.toString();
  const authority = port ? `${host}:${port}` : host;
  return `https://${authority}${pathname}${query ? `?${query}` : ""}`;
}

// Parses a URL's "#:~:text=" scroll-to-text-fragment directive
// (https://wicg.github.io/scroll-to-text-fragment/), used when a link was
// shared via Safari's "Copy Link with Highlight" instead of a live
// selection. Format: #:~:text=[prefix-,]textStart[,textEnd][,-suffix],
// each segment percent-encoded independently.

export interface TextFragment {
  prefix?: string;
  textStart: string;
  textEnd?: string;
  suffix?: string;
}

const TEXT_FRAGMENT_RE = /#:~:text=([^&]*)/i;

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseTextFragmentDirective(raw: string): TextFragment | null {
  if (!raw) return null;
  const parts = raw.split(",");
  let idx = 0;

  let prefix: string | undefined;
  if (parts[idx] && parts[idx].endsWith("-")) {
    prefix = safeDecode(parts[idx].slice(0, -1));
    idx++;
  }

  if (idx >= parts.length || !parts[idx]) return null;
  const textStart = safeDecode(parts[idx]);
  idx++;

  let textEnd: string | undefined;
  let suffix: string | undefined;
  if (idx < parts.length) {
    const remaining = parts.slice(idx);
    const last = remaining[remaining.length - 1];
    if (last.startsWith("-")) {
      suffix = safeDecode(last.slice(1));
      const middle = remaining.slice(0, -1);
      if (middle.length > 0) textEnd = safeDecode(middle.join(","));
    } else {
      textEnd = safeDecode(remaining.join(","));
    }
  }

  return { prefix, textStart, textEnd, suffix };
}

export function parseTextFragment(url: string): TextFragment | null {
  const match = url.match(TEXT_FRAGMENT_RE);
  if (!match) return null;
  return parseTextFragmentDirective(match[1]);
}

// With only textStart, that's the quote. With both textStart and textEnd,
// find the span between them in extractedText; if it can't be found there,
// fall back to "<start> … <end>".
export function resolveTextFragmentQuote(fragment: TextFragment, extractedText: string | null): string {
  if (!fragment.textEnd) return fragment.textStart;

  if (extractedText) {
    const startIdx = extractedText.indexOf(fragment.textStart);
    if (startIdx !== -1) {
      const endIdx = extractedText.indexOf(fragment.textEnd, startIdx + fragment.textStart.length);
      if (endIdx !== -1) {
        return extractedText.slice(startIdx, endIdx + fragment.textEnd.length);
      }
    }
  }

  return `${fragment.textStart} … ${fragment.textEnd}`;
}

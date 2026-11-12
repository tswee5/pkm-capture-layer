// The one place manual captures are written: POST /api/articles/upload,
// POST /api/capture (the iOS Shortcut endpoint), and the MCP server's
// capture_saved_item all call captureItem() below, so "save a link" and
// "merge into the existing item" behave identically everywhere. Pure,
// DB-free helpers are exported separately so they're testable without a
// database (see tests/lib/capture.test.ts).
//
// No Next-only APIs or "@/" aliases here — the MCP server imports this
// relatively (../../lib/capture.js), same constraint as linkMetadata.ts.

import { canonicalizeUrl } from "./canonicalUrl";
import { fetchLinkMetadata } from "./linkMetadata";
import type { DepthFlag } from "../types";

// Structural, not the exact @supabase/supabase-js SupabaseClient class: this
// file is imported by both the Next app and the MCP server, which have
// their own separate node_modules installs of that package. Two different
// copies of the same class fail TS's nominal check (it has protected
// members), so callers' real, fully-typed clients are passed in here —
// they just get checked structurally against this minimal shape instead.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SupabaseLike {
  from(table: string): any;
}

export interface CaptureItemInput {
  url: string;
  note?: string;
  quote?: string;
  tag_ids?: string[];
  tag_names?: string[];
  depth_flag?: DepthFlag | null;
}

export interface CaptureItemResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the full article row, shape varies by select()
  item: any;
  merged: boolean;
  quoteAdded: boolean;
  noteAppended: boolean;
}

// Strips a single layer of wrapping quote marks (straight or curly), if the
// whole trimmed string is wrapped in one of those pairs.
function stripWrappingQuotes(text: string): string {
  const pairs: [string, string][] = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
  ];
  for (const [open, close] of pairs) {
    if (text.length > open.length + close.length && text.startsWith(open) && text.endsWith(close)) {
      return text.slice(open.length, text.length - close.length).trim();
    }
  }
  return text;
}

// Trim, strip wrapping quotes, collapse runs of spaces/tabs, collapse runs
// of newlines down to a single newline (paragraph breaks survive as exactly
// one "\n"), and cap at 5,000 characters.
export function normalizeHighlightText(raw: string): string {
  let text = stripWrappingQuotes(raw.trim());
  text = text
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]+/g, " "))
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return text.slice(0, 5000);
}

export function formatDateStamp(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Appends a note to existing personal_notes with a date-stamped line, unless
// there were no existing notes — in which case the note is stored bare,
// with no date prefix. Never overwrites what was there.
export function appendNote(existingNotes: string | null, note: string, now: Date = new Date()): string {
  const trimmedNote = note.trim();
  if (!existingNotes || !existingNotes.trim()) return trimmedNote;
  return `${existingNotes}\n\n[${formatDateStamp(now)}] ${trimmedNote}`;
}

// depth_flag is set only if it's currently null — never override an
// earlier choice.
export function mergeDepthFlag(
  existing: DepthFlag | null,
  incoming: DepthFlag | null | undefined,
): DepthFlag | null {
  if (existing) return existing;
  return incoming ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findByCanonicalUrl(supabase: SupabaseLike, userId: string, canonicalUrl: string): Promise<any> {
  const { data, error } = await supabase
    .from("articles")
    .select("*")
    .eq("user_id", userId)
    .eq("source", "manual")
    .eq("canonical_url", canonicalUrl)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function resolveTagNames(supabase: SupabaseLike, userId: string, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const rawName of names) {
    const name = rawName.trim();
    if (!name) continue;
    const { data: existingTag, error: findError } = await supabase
      .from("topics")
      .select("id")
      .eq("user_id", userId)
      .ilike("name", name)
      .maybeSingle();
    if (findError) throw new Error(findError.message);
    if (existingTag) {
      ids.push(existingTag.id);
      continue;
    }
    const { data: created, error: createError } = await supabase
      .from("topics")
      .insert({ user_id: userId, name })
      .select("id")
      .single();
    if (createError) throw new Error(createError.message);
    ids.push(created.id);
  }
  return ids;
}

async function applyTags(
  supabase: SupabaseLike,
  userId: string,
  articleId: string,
  tagIds?: string[],
  tagNames?: string[],
): Promise<void> {
  const ids = [...(tagIds ?? [])];
  if (tagNames && tagNames.length > 0) {
    ids.push(...(await resolveTagNames(supabase, userId, tagNames)));
  }
  if (ids.length === 0) return;
  const { error } = await supabase
    .from("article_topics")
    .upsert(
      ids.map((topic_id) => ({ article_id: articleId, topic_id })),
      { onConflict: "article_id,topic_id", ignoreDuplicates: true },
    );
  if (error) throw new Error(error.message);
}

// Inserts a highlight; a duplicate (same article, normalized text) is a
// silent no-op per the DB's unique index.
async function insertHighlight(
  supabase: SupabaseLike,
  userId: string,
  articleId: string,
  rawQuote: string,
): Promise<boolean> {
  const text = normalizeHighlightText(rawQuote);
  if (!text) return false;
  const { error } = await supabase.from("highlights").insert({ user_id: userId, article_id: articleId, text });
  if (error) {
    if (error.code === "23505") return false;
    throw new Error(error.message);
  }
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchFullArticle(supabase: SupabaseLike, id: string): Promise<any> {
  const { data, error } = await supabase
    .from("articles")
    .select("*, article_topics(topic:topics(*)), highlights(id, text, created_at)")
    .eq("id", id)
    .order("created_at", { foreignTable: "highlights", ascending: true })
    .single();
  if (error) throw new Error(error.message);
  return {
    ...data,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    topics: (data.article_topics ?? []).map((entry: any) => entry.topic),
    article_topics: undefined,
    highlights: data.highlights ?? [],
  };
}

async function mergeIntoExisting(
  supabase: SupabaseLike,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  existing: any,
  input: CaptureItemInput,
): Promise<CaptureItemResult> {
  const update: Record<string, unknown> = { last_captured_at: new Date().toISOString() };

  let noteAppended = false;
  if (input.note && input.note.trim()) {
    update.personal_notes = appendNote(existing.personal_notes, input.note);
    noteAppended = true;
  }

  const mergedDepth = mergeDepthFlag(existing.depth_flag, input.depth_flag);
  if (mergedDepth !== existing.depth_flag) {
    update.depth_flag = mergedDepth;
  }

  const { error: updateError } = await supabase.from("articles").update(update).eq("id", existing.id);
  if (updateError) throw new Error(updateError.message);

  let quoteAdded = false;
  if (input.quote && input.quote.trim()) {
    quoteAdded = await insertHighlight(supabase, existing.user_id, existing.id, input.quote);
  }

  await applyTags(supabase, existing.user_id, existing.id, input.tag_ids, input.tag_names);

  const item = await fetchFullArticle(supabase, existing.id);
  return { item, merged: true, quoteAdded, noteAppended };
}

export async function captureItem(
  supabase: SupabaseLike,
  userId: string,
  input: CaptureItemInput,
): Promise<CaptureItemResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input.url);
  } catch {
    throw new Error("url must be a valid URL");
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("url must be http(s)");
  }

  const c1 = canonicalizeUrl(parsedUrl.toString());
  let existing = await findByCanonicalUrl(supabase, userId, c1);

  let meta: Awaited<ReturnType<typeof fetchLinkMetadata>> | null = null;
  let canonicalUrl = c1;

  if (!existing) {
    meta = await fetchLinkMetadata(parsedUrl.toString());
    if (meta.finalUrl) {
      let c2: string | null = null;
      try {
        c2 = canonicalizeUrl(meta.finalUrl);
      } catch {
        c2 = null;
      }
      if (c2 && c2 !== c1) {
        existing = await findByCanonicalUrl(supabase, userId, c2);
        canonicalUrl = c2;
      }
    }
  }

  if (existing) {
    return mergeIntoExisting(supabase, existing, input);
  }

  const metaResult = meta ?? (await fetchLinkMetadata(parsedUrl.toString()));
  const headline = metaResult.title || parsedUrl.hostname;

  const { data: inserted, error: insertError } = await supabase
    .from("articles")
    .insert({
      user_id: userId,
      source: "manual",
      link: parsedUrl.toString(),
      canonical_url: canonicalUrl,
      headline,
      og_image_url: metaResult.imageUrl,
      og_description: metaResult.description,
      domain: metaResult.domain,
      extracted_text: metaResult.extractedText,
      personal_notes: input.note?.trim() || null,
      depth_flag: input.depth_flag ?? null,
      last_captured_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const raceExisting = await findByCanonicalUrl(supabase, userId, canonicalUrl);
      if (raceExisting) return mergeIntoExisting(supabase, raceExisting, input);
    }
    throw new Error(insertError.message);
  }

  let quoteAdded = false;
  if (input.quote && input.quote.trim()) {
    quoteAdded = await insertHighlight(supabase, userId, inserted.id, input.quote);
  }

  await applyTags(supabase, userId, inserted.id, input.tag_ids, input.tag_names);

  const item = await fetchFullArticle(supabase, inserted.id);
  return { item, merged: false, quoteAdded, noteAppended: false };
}

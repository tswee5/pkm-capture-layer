# Spec: Ingestion & Normalization Layer

## 1. What this feature does

Pull content from all capture sources — TLDR main newsletter, TLDR AI newsletter, Twitter/X likes & bookmarks, and manual file/link uploads — and convert each item into one consistent internal data shape, tagged with its source and a timestamp, so the UI layer can group and render everything uniformly. This spec also covers fixing known bugs in the existing TLDR parser (ad leakage, missing section, ordering).

## 2. Current implementation (starting point — not greenfield)

**File:** `lib/parseTLDR.ts`

**Functions:**
- `classifyNewsletter(subject, html)` — classifies an email as `tldr` or `tldr_ai` primarily via `utm_source=tldrnewsletter` / `utm_source=tldrai` in the raw HTML body, with a subject-line fallback for pre-2026 format. Working correctly, no changes needed.
- `parseTldrHtml(html)` — main parser. Finds `<a>` anchors, decodes TLDR's tracking-wrapper URLs (`tracking.tldrnewsletter.com/CL0/<encoded-url>/`), strips UTM params, filters out non-article links via `SKIP_PATTERNS` and `isArticleUrl`, extracts headline + summary text between anchors, and assigns `orderIndex` (sequential, post-filter) and `sectionLabel` per article.
- `extractSectionMarkers(html)` — scans `<td>`, `<th>`, `<h1-6>`, `<p>` blocks under 80 chars for known section header text (via `SECTION_PATTERNS`), records each match's character offset.
- `sectionAt(anchorIndex)` — returns the label of the last section marker preceding a given anchor's position.

**Known issues to fix, with likely root cause based on code review:**

1. **Sponsored content leakage (partial fix in place, unverified).** `SPONSOR_LABEL = /\(sponsored?\)/i` checks both the anchor headline and the raw HTML slice between anchors, which should catch inline `(Sponsor)`/`(Sponsored)` tags. Not yet verified against a clean re-sync — needs confirmation against real fixtures rather than further code changes, unless verification turns up new leakage patterns.
2. **Top-of-newsletter sponsor not filtered (e.g. "Try Wispr Flow Free →").** Root cause: this block has no `(Sponsor)` label and its link's `utm_medium` isn't `sponsorship`, so it passes both `isArticleUrl` and `SPONSOR_LABEL`/`NOISE_PATTERN` checks untouched. Needs a new detection strategy — e.g. treat any anchor appearing before the first recognized section marker as suspect, or find another structural marker TLDR uses for top-of-email sponsor blocks (inspect real fixture HTML to confirm the pattern before implementing).
3. **Section headers with emoji prefixes not matching (e.g. "🚀 Headlines & Launches").** `SECTION_PATTERNS` regexes don't require the emoji so an exact text match should still work, but the 80-char length cap in `extractSectionMarkers` may be truncating/excluding blocks where emoji + surrounding markup push the stripped text over the limit. Needs confirmation against a real fixture — if confirmed, likely fix is stripping emoji before the length check or raising the cap.
4. **"Big Tech & Startups" section missing entirely; DB shows `order_index` starting at 1, not 0.** Two symptoms that may or may not share a root cause — don't assume they're the same bug without confirming against fixtures. Possible causes to investigate: an article at index 0 being filtered by `isArticleUrl`/`SKIP_PATTERNS`/`NOISE_PATTERN` (would explain the offset), a downstream DB dedup step removing it after parsing (would not be a parser bug), or the "Big Tech & Startups" section marker itself failing to match for the same reason as issue 3.

## 3. Interface (target state)

Each source should have its own ingestion function, but all must output the same normalized item shape.

**Normalized item shape:**
```
{
  id: string,            // stable unique id (hash of source+title+date is fine)
  source: "tldr_main" | "tldr_ai" | "twitter" | "manual_upload",
  title: string,
  url: string | null,
  summary: string | null,
  published_at: datetime,  // when the content was created/sent (not when ingested)
  ingested_at: datetime,   // when our system pulled it in
  raw_metadata: object      // anything source-specific worth keeping, e.g. tweet author, newsletter section
}
```

**Source functions:**
- `parse_tldr_main(email_html) -> list[NormalizedItem]` — wraps existing `classifyNewsletter` + `parseTldrHtml`, mapping `ParsedArticle` (`headline`, `link`, `summary`, `orderIndex`, `sectionLabel`) into the normalized shape (`sectionLabel` and `orderIndex` go into `raw_metadata`).
- `parse_tldr_ai(email_html) -> list[NormalizedItem]` — same wrapper, `classifyNewsletter` result `tldr_ai`.
- `parse_twitter_bookmarks(...) -> list[NormalizedItem]` (interface TBD based on existing Twitter ingestion method — reuse current logic, just wrap output in normalized shape)
- `parse_manual_upload(file_or_link) -> list[NormalizedItem]`

All four feed into a single `ingest_all() -> list[NormalizedItem]` that concatenates and returns everything, sorted by `published_at` ascending.

## 4. Edge cases & constraints

- **Ad filtering (TLDR):** No ad/sponsor block should ever be returned as an item — this includes inline `(Sponsor)`-labeled articles (issue 1 above) and structurally-different top-of-newsletter sponsor blocks with no label (issue 2 above). Confirm both against real saved sample emails; don't consider this done from code inspection alone.
- **Section labeling (TLDR):** Every article must get the correct `sectionLabel`, including sections with emoji-prefixed headers (issue 3) and "Big Tech & Startups" specifically (issue 4). Verify against real fixtures that include an emoji-prefixed header and a Big Tech & Startups section.
- **Article ordering (TLDR):** Articles must be returned in the same order they appear in the original email, top to bottom, with no gap at the start (`order_index` should start at 0 for the first real article, not 1 — investigate and fix per issue 4).
- **Duplicate handling:** If the same URL/article appears in both TLDR main and TLDR AI (rare but possible), keep both — they're tagged with different sources and that's meaningful context, not a duplicate to collapse.
- **Missing fields:** If a field can't be parsed (e.g. no summary available), set it to `null` rather than omitting the key or throwing.
- **Empty input:** If an email or upload has zero parseable items, return an empty list, not an error.
- **Malformed input:** If the HTML structure doesn't match what the parser expects (e.g. TLDR changes their template again), fail loudly with a clear error rather than silently returning partial/garbage data.

## 5. Done criteria

- [ ] All four source functions implemented and returning the normalized item shape
- [ ] `ingest_all()` merges and sorts by `published_at`
- [ ] `classifyNewsletter` behavior preserved unchanged (not a known issue, don't touch)
- [ ] Issue 1 (inline sponsor leakage) verified fixed against real saved sample emails
- [ ] Issue 2 (top-of-newsletter unlabeled sponsor) fixed and verified against real saved sample emails
- [ ] Issue 3 (emoji-prefixed section headers not matching) root cause confirmed and fixed
- [ ] Issue 4 (Big Tech & Startups missing / order_index starting at 1) root cause confirmed and fixed
- [ ] Articles returned in correct original top-to-bottom order, verified against real saved sample emails
- [ ] Test suite exists in `tests/` covering all four issues above plus normalized shape correctness, using 2-3 real saved TLDR emails (including at least one with an emoji-prefixed header and a Big Tech & Startups section) as fixtures in `tests/fixtures/`
- [ ] All tests pass
- [ ] `raw_metadata` retains source-specific detail (newsletter section name for TLDR, author for Twitter, etc.) without breaking the common shape
- [ ] Existing working behavior for non-buggy sources/functions is preserved (no regressions to Twitter or manual upload ingestion, or to `classifyNewsletter`)

## 6. Out of scope

- UI rendering, section headers, date grouping — covered in the separate UI feed spec
- Triage actions (deep-dive / surface-level / purge) — covered elsewhere
- Twitter ingestion mechanism itself (assume existing method is reused, only the output normalization is new work here)
- Deduplication logic beyond what's described above
- Any Obsidian/backend sync — this spec ends at producing normalized items, not writing them anywhere permanent

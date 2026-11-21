import { describe, expect, it } from "vitest";
import { estimateBookmarkTimes, extractArticleFromTweet } from "../../lib/twitter";

const NOW = new Date("2026-11-21T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

function strictlyDecreasing(dates: Date[]) {
  for (let i = 1; i < dates.length; i++) {
    expect(dates[i].getTime()).toBeLessThan(dates[i - 1].getTime());
  }
}

describe("estimateBookmarkTimes", () => {
  it("live sync: stamps new bookmarks at ~now, keeping API (most-recent-first) order", () => {
    const times = estimateBookmarkTimes([hoursAgo(500), hoursAgo(1), null], NOW, hoursAgo(0.1));
    expect(times[0].getTime()).toBe(NOW.getTime());
    strictlyDecreasing(times);
    // All land after the previous sync — i.e. above anything captured before it.
    for (const t of times) expect(t.getTime()).toBeGreaterThan(new Date(hoursAgo(0.1)).getTime());
  });

  it("first sync (backfill): uses tweet post time, never out of API order", () => {
    // Bookmarked newest-first, but the 2nd was posted *after* the 1st.
    const times = estimateBookmarkTimes([hoursAgo(48), hoursAgo(10), hoursAgo(200)], NOW, null);
    expect(times[0].toISOString()).toBe(hoursAgo(48));
    strictlyDecreasing(times);
    expect(times[2].toISOString()).toBe(hoursAgo(200));
  });

  it("stale sync (>7 days): backfill, but floored above the previous sync", () => {
    const last = hoursAgo(24 * 30);
    const times = estimateBookmarkTimes([hoursAgo(5), hoursAgo(24 * 365), hoursAgo(24 * 400)], NOW, last);
    expect(times[0].toISOString()).toBe(hoursAgo(5));
    strictlyDecreasing(times);
    for (const t of times) expect(t.getTime()).toBeGreaterThan(new Date(last).getTime());
  });

  it("never stamps in the future", () => {
    const times = estimateBookmarkTimes([new Date(NOW.getTime() + 60_000).toISOString()], NOW, null);
    expect(times[0].getTime()).toBeLessThanOrEqual(NOW.getTime());
  });
});

describe("extractArticleFromTweet", () => {
  const authors = new Map([["u1", { id: "u1", name: "Ada", username: "ada" }]]);

  it("links to the tweet itself and keeps the external article separately", () => {
    const a = extractArticleFromTweet(
      {
        id: "123",
        text: "Great read on compilers https://t.co/abc",
        author_id: "u1",
        entities: { urls: [{ url: "https://t.co/abc", expanded_url: "https://example.com/post", display_url: "example.com/post" }] },
      },
      "bookmark",
      authors,
    );
    expect(a.link).toBe("https://x.com/ada/status/123");
    expect(a.externalUrl).toBe("https://example.com/post");
    expect(a.headline).toBe("Great read on compilers");
  });

  it("prefers the full note_tweet text and gives media-only tweets a readable title", () => {
    const long = extractArticleFromTweet(
      { id: "1", text: "truncated…", note_tweet: { text: "The full long-form text" }, author_id: "u1" },
      "bookmark",
      authors,
    );
    expect(long.summary).toBe("The full long-form text");

    const media = extractArticleFromTweet({ id: "2", text: "https://t.co/img", author_id: "u1" }, "bookmark", authors);
    expect(media.headline).toBe("Ada (@ada) — media post");
  });
});

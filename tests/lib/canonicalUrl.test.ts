import { describe, expect, it } from "vitest";
import { canonicalizeUrl } from "../../lib/canonicalUrl";

describe("canonicalizeUrl", () => {
  it("normalizes scheme to https", () => {
    expect(canonicalizeUrl("http://example.com/post")).toBe("https://example.com/post");
  });

  it("rejects non-http(s) schemes", () => {
    expect(() => canonicalizeUrl("ftp://example.com/file")).toThrow();
  });

  it("lowercases the host and strips a leading www.", () => {
    expect(canonicalizeUrl("https://WWW.Example.COM/Post")).toBe("https://example.com/Post");
  });

  it("drops default ports", () => {
    expect(canonicalizeUrl("https://example.com:443/post")).toBe("https://example.com/post");
    expect(canonicalizeUrl("http://example.com:80/post")).toBe("https://example.com/post");
  });

  it("keeps a non-default port", () => {
    expect(canonicalizeUrl("http://example.com:8080/post")).toBe("https://example.com:8080/post");
  });

  it("rewrites twitter.com and mobile hosts to x.com and drops all query params", () => {
    expect(canonicalizeUrl("https://twitter.com/user/status/123?s=20")).toBe(
      "https://x.com/user/status/123",
    );
    expect(canonicalizeUrl("https://mobile.twitter.com/user/status/123")).toBe(
      "https://x.com/user/status/123",
    );
    expect(canonicalizeUrl("https://mobile.x.com/user/status/123?t=abc")).toBe(
      "https://x.com/user/status/123",
    );
  });

  it("removes the fragment, including text fragments", () => {
    expect(canonicalizeUrl("https://example.com/post#section")).toBe("https://example.com/post");
    expect(canonicalizeUrl("https://example.com/post#:~:text=hello")).toBe(
      "https://example.com/post",
    );
  });

  it("removes tracking params", () => {
    expect(
      canonicalizeUrl(
        "https://example.com/post?utm_source=x&utm_medium=y&fbclid=1&gclid=2&dclid=3&msclkid=4&mc_cid=5&mc_eid=6&_hsenc=7&_hsmi=8&igshid=9&ref=10&ref_src=11&ref_url=12&source=13&smid=14&cmpid=15",
      ),
    ).toBe("https://example.com/post");
  });

  it("strips si only on youtube/spotify hosts, and leaves it alone elsewhere", () => {
    expect(canonicalizeUrl("https://youtube.com/watch?v=abc&si=xyz")).toBe(
      "https://youtube.com/watch?v=abc",
    );
    expect(canonicalizeUrl("https://example.com/post?si=xyz")).toBe(
      "https://example.com/post?si=xyz",
    );
  });

  it("sorts remaining query params by key and drops ? when none remain", () => {
    expect(canonicalizeUrl("https://example.com/post?b=2&a=1")).toBe(
      "https://example.com/post?a=1&b=2",
    );
    expect(canonicalizeUrl("https://example.com/post?utm_source=x")).toBe(
      "https://example.com/post",
    );
  });

  it("removes a trailing slash unless the path is just /", () => {
    expect(canonicalizeUrl("https://example.com/post/")).toBe("https://example.com/post");
    expect(canonicalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("keeps path case as given", () => {
    expect(canonicalizeUrl("https://example.com/Some/Path")).toBe(
      "https://example.com/Some/Path",
    );
  });

  it("rewrites youtu.be/<id> to youtube.com/watch?v=<id> and keeps t", () => {
    expect(canonicalizeUrl("https://youtu.be/abc123?t=42")).toBe(
      "https://youtube.com/watch?t=42&v=abc123",
    );
    expect(canonicalizeUrl("https://youtu.be/abc123")).toBe(
      "https://youtube.com/watch?v=abc123",
    );
  });

  it("is idempotent", () => {
    const urls = [
      "http://WWW.Example.com:80/Post/?utm_source=x&b=2&a=1#frag",
      "https://twitter.com/user/status/123?s=20",
      "https://youtu.be/abc123?t=42&utm_source=y",
      "https://example.com/",
      "https://example.com:8080/post?z=1&a=2",
    ];
    for (const url of urls) {
      const once = canonicalizeUrl(url);
      const twice = canonicalizeUrl(once);
      expect(twice).toBe(once);
    }
  });
});

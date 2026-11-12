import { describe, expect, it } from "vitest";
import { parseTextFragment, resolveTextFragmentQuote } from "../../lib/textFragment";

describe("parseTextFragment", () => {
  it("returns null when there is no text fragment", () => {
    expect(parseTextFragment("https://example.com/post")).toBeNull();
  });

  it("handles start-only", () => {
    expect(parseTextFragment("https://example.com/post#:~:text=hello%20world")).toEqual({
      prefix: undefined,
      textStart: "hello world",
      textEnd: undefined,
      suffix: undefined,
    });
  });

  it("handles start+end", () => {
    expect(parseTextFragment("https://example.com/post#:~:text=hello,world")).toEqual({
      prefix: undefined,
      textStart: "hello",
      textEnd: "world",
      suffix: undefined,
    });
  });

  it("handles a prefix", () => {
    expect(parseTextFragment("https://example.com/post#:~:text=before-,hello")).toEqual({
      prefix: "before",
      textStart: "hello",
      textEnd: undefined,
      suffix: undefined,
    });
  });

  it("handles a suffix", () => {
    expect(parseTextFragment("https://example.com/post#:~:text=hello,-after")).toEqual({
      prefix: undefined,
      textStart: "hello",
      textEnd: undefined,
      suffix: "after",
    });
  });

  it("handles prefix, start, end, and suffix together", () => {
    expect(
      parseTextFragment("https://example.com/post#:~:text=before-,hello,world,-after"),
    ).toEqual({
      prefix: "before",
      textStart: "hello",
      textEnd: "world",
      suffix: "after",
    });
  });

  it("percent-decodes each segment", () => {
    expect(
      parseTextFragment("https://example.com/post#:~:text=50%25%20off,-the%20price"),
    ).toEqual({
      prefix: undefined,
      textStart: "50% off",
      textEnd: undefined,
      suffix: "the price",
    });
  });
});

describe("resolveTextFragmentQuote", () => {
  it("returns textStart alone when there is no textEnd", () => {
    expect(resolveTextFragmentQuote({ textStart: "hello world" }, null)).toBe("hello world");
  });

  it("finds the span between start and end in extractedText", () => {
    const extractedText = "Some intro. hello there, world. Some outro.";
    expect(
      resolveTextFragmentQuote({ textStart: "hello there", textEnd: "world." }, extractedText),
    ).toBe("hello there, world.");
  });

  it("falls back to '<start> … <end>' when the span isn't found", () => {
    expect(
      resolveTextFragmentQuote({ textStart: "hello", textEnd: "world" }, "unrelated text"),
    ).toBe("hello … world");
    expect(resolveTextFragmentQuote({ textStart: "hello", textEnd: "world" }, null)).toBe(
      "hello … world",
    );
  });
});

import { describe, expect, it } from "vitest";
import { appendNote, formatDateStamp, mergeDepthFlag, normalizeHighlightText } from "../../lib/capture";

describe("normalizeHighlightText", () => {
  it("trims and collapses runs of spaces/tabs", () => {
    expect(normalizeHighlightText("  hello   world  ")).toBe("hello world");
  });

  it("keeps a single newline between paragraphs, collapsing runs of newlines", () => {
    expect(normalizeHighlightText("para one\n\n\npara two")).toBe("para one\npara two");
  });

  it("strips wrapping straight double quotes", () => {
    expect(normalizeHighlightText('"a quoted sentence"')).toBe("a quoted sentence");
  });

  it("strips wrapping curly quotes", () => {
    expect(normalizeHighlightText("“a quoted sentence”")).toBe("a quoted sentence");
  });

  it("does not strip a single quote char that isn't a wrapping pair", () => {
    expect(normalizeHighlightText("it's a test")).toBe("it's a test");
  });

  it("caps at 5000 characters", () => {
    const long = "a".repeat(6000);
    expect(normalizeHighlightText(long).length).toBe(5000);
  });
});

describe("formatDateStamp", () => {
  it("formats in America/New_York as 'Mon D, YYYY'", () => {
    // Noon UTC is still the same calendar day in America/New_York year-round.
    expect(formatDateStamp(new Date("2026-11-11T12:00:00Z"))).toBe("Nov 11, 2026");
  });
});

describe("appendNote", () => {
  const now = new Date("2026-11-11T12:00:00Z");

  it("stores the note with no date prefix when there are no existing notes", () => {
    expect(appendNote(null, "a new note", now)).toBe("a new note");
    expect(appendNote("", "a new note", now)).toBe("a new note");
    expect(appendNote("   ", "a new note", now)).toBe("a new note");
  });

  it("appends a date-stamped line when notes already exist, never overwriting", () => {
    expect(appendNote("existing note", "a follow-up", now)).toBe(
      "existing note\n\n[Nov 11, 2026] a follow-up",
    );
  });
});

describe("mergeDepthFlag", () => {
  it("sets depth_flag only if it is currently null", () => {
    expect(mergeDepthFlag(null, "deep")).toBe("deep");
    expect(mergeDepthFlag(null, undefined)).toBeNull();
    expect(mergeDepthFlag(null, null)).toBeNull();
  });

  it("never overrides an existing choice", () => {
    expect(mergeDepthFlag("surface", "deep")).toBe("surface");
    expect(mergeDepthFlag("deep", "surface")).toBe("deep");
    expect(mergeDepthFlag("surface", null)).toBe("surface");
  });
});

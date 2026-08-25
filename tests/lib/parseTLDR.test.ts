import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { classifyNewsletter, parseTldrHtml } from "../../lib/parseTLDR";

function loadFixture(name: string): string {
  return readFileSync(path.join(__dirname, "..", "fixtures", name), "utf-8");
}

const tldrAiAug24 = loadFixture("tldr-ai-2026-08-24.html");

describe("classifyNewsletter", () => {
  it("classifies via utm_source in the HTML body, unchanged behavior", () => {
    expect(classifyNewsletter("TLDR AI", tldrAiAug24)).toBe("tldr_ai");
  });
});

describe("parseTldrHtml — real TLDR AI fixture (2026-08-24)", () => {
  const articles = parseTldrHtml(tldrAiAug24);
  const headlines = articles.map((a) => a.headline);

  it("returns every real article, including ones behind links.tldrnewsletter.com shortlinks", () => {
    const expectedHeadlines = [
      "Hugging Face's $13B Valuation (3 minute read)",
      "DeepSeek releases experimental Flash vision model that rivals Opus 4.8 on agent benchmarks (2 minute read)",
      "Anthropic will give defenders what its strongest model finds, but not the model itself (3 minute read)",
      "Grok Bot is now included with more plans (4 minute read)",
      "Verifiable Domains Will Eat The World (15 minute read)",
      "The summer of open weights (6 minute read)",
      "Measuring benchmark optimization in speech recognition (13 minute read)",
      "The Evolution of the Agent Harness (10 minute read)",
      "Building a 24/7 Multi-Agent System: The SpaceXAI Playbook (100 minute read)",
      "Anthropic's Cheaper Opus 5 Overtakes Fable 5 in Corporate Spending (4 minute read)",
      "Who Eats Memory Costs? (9 minute read)",
      "OpenAI temporarily cuts GPT-5.6 Sol API pricing (3 minute read)",
      "More data than open-source AI is taking share from OpenAI and Anthropic (1 minute read)",
      "The AI-Native SDLC playbook (47 minute read)",
      "Meta hires OpenAI veteran Luke Metz (1 minute read)",
      "Inherent, founded by DeepMind alumni, says its AI 'teammate' just outperformed Anthropic and OpenAI at replicating research (5 minute read)",
      "A startup trains AI on living human skin tissue (6 minute read)",
    ];
    expect(headlines).toEqual(expectedHeadlines);
  });

  it("excludes every (Sponsor)-labeled article, including their inline CTA sub-links", () => {
    const bannedSubstrings = [
      "Two numbers explain why millions stopped typing",
      "Remember when you used to spend hours typing prompts",
      "Are you rate-limited by your typing speed",
      "Are AI models breaking the shift-left model",
      "Try Wispr Flow Free",
      "Download Flow",
      "Use Flow for free",
      "Start for free",
      "Join Sonatype and IDC for a live webinar",
    ];
    for (const banned of bannedSubstrings) {
      expect(headlines.some((h) => h.includes(banned))).toBe(false);
    }
  });

  it("excludes the unlabeled job-posting sponsor block", () => {
    expect(headlines.some((h) => h.includes("GTM Engineer"))).toBe(false);
  });

  it("excludes everything in the 'Love TLDR' referral/advertise/sign-off footer", () => {
    const bannedSubstrings = [
      "create your own role",
      "Inc.'s Best Bootstrapped businesses",
      "Track your referrals",
      "advertise with us",
      "Apply here",
      "Manage your subscriptions",
    ];
    for (const banned of bannedSubstrings) {
      expect(headlines.some((h) => h.includes(banned))).toBe(false);
    }
  });

  it("assigns correct section labels, including the renamed 'Deep Dives & Analysis' and 'Engineering & Research' headers", () => {
    const bySection = (label: string) =>
      articles.filter((a) => a.sectionLabel === label).map((a) => a.headline);

    expect(bySection("Headlines & Launches")).toEqual([
      "Hugging Face's $13B Valuation (3 minute read)",
      "DeepSeek releases experimental Flash vision model that rivals Opus 4.8 on agent benchmarks (2 minute read)",
      "Anthropic will give defenders what its strongest model finds, but not the model itself (3 minute read)",
      "Grok Bot is now included with more plans (4 minute read)",
    ]);

    expect(bySection("Deep Dives & Analysis")).toEqual([
      "Verifiable Domains Will Eat The World (15 minute read)",
      "The summer of open weights (6 minute read)",
      "Measuring benchmark optimization in speech recognition (13 minute read)",
    ]);

    expect(bySection("Engineering & Research")).toEqual([
      "The Evolution of the Agent Harness (10 minute read)",
      "Building a 24/7 Multi-Agent System: The SpaceXAI Playbook (100 minute read)",
    ]);

    expect(bySection("Miscellaneous")).toEqual([
      "Anthropic's Cheaper Opus 5 Overtakes Fable 5 in Corporate Spending (4 minute read)",
      "Who Eats Memory Costs? (9 minute read)",
    ]);

    expect(bySection("Quick Links")).toEqual([
      "OpenAI temporarily cuts GPT-5.6 Sol API pricing (3 minute read)",
      "More data than open-source AI is taking share from OpenAI and Anthropic (1 minute read)",
      "The AI-Native SDLC playbook (47 minute read)",
      "Meta hires OpenAI veteran Luke Metz (1 minute read)",
      "Inherent, founded by DeepMind alumni, says its AI 'teammate' just outperformed Anthropic and OpenAI at replicating research (5 minute read)",
      "A startup trains AI on living human skin tissue (6 minute read)",
    ]);
  });

  it("assigns sequential, gap-free orderIndex starting at 0, matching original top-to-bottom order", () => {
    expect(articles.map((a) => a.orderIndex)).toEqual(articles.map((_, i) => i));
    expect(articles[0].orderIndex).toBe(0);
  });

  it("never returns null summary/link for a successfully parsed article", () => {
    for (const article of articles) {
      expect(article.link).toMatch(/^https?:\/\//);
      expect(typeof article.summary).toBe("string");
    }
  });
});

describe("parseTldrHtml — repeated calls (regression: shared global regex state)", () => {
  it("returns the same result on a second call, not an empty array", () => {
    const first = parseTldrHtml(tldrAiAug24);
    const second = parseTldrHtml(tldrAiAug24);
    expect(second.length).toBe(first.length);
    expect(second.map((a) => a.headline)).toEqual(first.map((a) => a.headline));
  });
});

describe("parseTldrHtml — edge cases", () => {
  it("returns an empty array for HTML with no parseable articles", () => {
    expect(parseTldrHtml("<html><body>no articles here</body></html>")).toEqual([]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseTldrHtml("")).toEqual([]);
  });
});

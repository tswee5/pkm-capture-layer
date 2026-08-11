import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchTldrMessages, getValidGmailAccessToken } from "@/lib/gmail";
import { classifyNewsletter, parseTldrHtml } from "@/lib/parseTLDR";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("raw") === "1"; // ?raw=1 dumps full HTML of first email
  const msgCount = parseInt(searchParams.get("n") ?? "1", 10);

  const accessToken = await getValidGmailAccessToken(userData.user.id);
  const messages = await fetchTldrMessages(accessToken, msgCount);

  if (raw && messages[0]) {
    // Return raw HTML so you can inspect the actual newsletter structure
    return new Response(messages[0].html, {
      headers: { "Content-Type": "text/html" },
    });
  }

  const debug = messages.map((msg) => {
    const source = classifyNewsletter(msg.subject, msg.html);
    const articles = source ? parseTldrHtml(msg.html) : [];

    // Extract section markers the same way the parser does, for visibility
    const sectionPattern = /<(?:td|th|h[1-6]|p)[^>]*>([\s\S]*?)<\/(?:td|th|h[1-6]|p)>/gi;
    const sectionKeywords = [
      "Headlines & Launches", "Research & Innovation", "Engineering & Resources",
      "Big Tech & Startups", "Science & Futuristic Technology",
      "Programming, Design & Data Science", "Miscellaneous", "Quick Links",
    ];
    const detectedSections: { label: string; charPosition: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = sectionPattern.exec(msg.html)) !== null) {
      const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const match = sectionKeywords.find((k) =>
        text.toLowerCase().includes(k.toLowerCase())
      );
      if (match) detectedSections.push({ label: match, charPosition: m.index });
    }

    return {
      subject: msg.subject,
      date: msg.date,
      source,
      htmlLength: msg.html.length,
      detectedSectionMarkers: detectedSections,
      parsedArticles: articles.map((a) => ({
        orderIndex: a.orderIndex,
        sectionLabel: a.sectionLabel,
        headline: a.headline,
        summaryPreview: a.summary.slice(0, 120),
      })),
    };
  });

  return NextResponse.json(debug, { headers: { "Content-Type": "application/json" } });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchLinkMetadata } from "@/lib/linkMetadata";
import type { CaptureInput } from "@/types";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: CaptureInput = await request.json();
  if (!body.url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(body.url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("invalid protocol");
    }
  } catch {
    return NextResponse.json({ error: "url must be a valid http(s) URL" }, { status: 400 });
  }

  const meta = await fetchLinkMetadata(parsedUrl.toString());
  const headline = meta.title || parsedUrl.hostname;

  const { data, error } = await supabase
    .from("articles")
    .insert({
      user_id: userData.user.id,
      source: "manual",
      link: parsedUrl.toString(),
      headline,
      og_image_url: meta.imageUrl,
      og_description: meta.description,
      domain: meta.domain,
      extracted_text: meta.extractedText,
      personal_notes: body.notes ?? null,
      depth_flag: body.depth_flag ?? null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (body.tag_ids && body.tag_ids.length > 0) {
    const { error: tagError } = await supabase
      .from("article_topics")
      .insert(body.tag_ids.map((topic_id) => ({ article_id: data.id, topic_id })));
    if (tagError) {
      return NextResponse.json({ error: tagError.message }, { status: 500 });
    }
  }

  const { data: withTags, error: refetchError } = await supabase
    .from("articles")
    .select("*, article_topics(topic:topics(*))")
    .eq("id", data.id)
    .single();

  if (refetchError) {
    return NextResponse.json({ error: refetchError.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      ...withTags,
      topics: (withTags.article_topics ?? []).map((entry: { topic: unknown }) => entry.topic),
      article_topics: undefined,
    },
    { status: 201 },
  );
}

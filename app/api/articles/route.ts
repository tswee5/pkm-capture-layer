import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const topicId = searchParams.get("topic_id");
  const source = searchParams.get("source");
  const tweetType = searchParams.get("tweet_type");
  const depthFlag = searchParams.get("depth_flag");
  const search = searchParams.get("q");

  let query = supabase
    .from("articles")
    .select("*, article_topics(topic:topics(*))")
    .order("newsletter_date", { ascending: false, nullsFirst: false })
    .order("source", { ascending: true })   // tldr before tldr_ai within same day
    .order("order_index", { ascending: true })
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }
  if (source) {
    query = query.eq("source", source);
  }
  if (tweetType) {
    query = query.eq("tweet_type", tweetType);
  }
  if (depthFlag) {
    query = query.eq("depth_flag", depthFlag);
  }
  if (search) {
    query = query.textSearch("search_vector", search, { type: "websearch" });
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let articles = (data ?? []).map((article) => ({
    ...article,
    topics: (article.article_topics ?? []).map(
      (entry: { topic: unknown }) => entry.topic,
    ),
    article_topics: undefined,
  }));

  if (topicId) {
    articles = articles.filter((article) =>
      article.topics.some((topic: { id: string }) => topic.id === topicId),
    );
  }

  return NextResponse.json(articles);
}

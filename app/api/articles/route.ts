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

  let query = supabase
    .from("articles")
    .select("*, article_topics(topic:topics(*))")
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
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

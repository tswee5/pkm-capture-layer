import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: { article_id?: string; topic_id?: string } = await request.json();
  if (!body.article_id || !body.topic_id) {
    return NextResponse.json(
      { error: "article_id and topic_id are required" },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("article_topics")
    .insert({ article_id: body.article_id, topic_id: body.topic_id });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const articleId = searchParams.get("article_id");
  const topicId = searchParams.get("topic_id");
  if (!articleId || !topicId) {
    return NextResponse.json(
      { error: "article_id and topic_id are required" },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("article_topics")
    .delete()
    .eq("article_id", articleId)
    .eq("topic_id", topicId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

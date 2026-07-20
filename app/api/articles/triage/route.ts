import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { TriageUpdate } from "@/types";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: TriageUpdate = await request.json();
  if (!body.article_id) {
    return NextResponse.json({ error: "article_id is required" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.status !== undefined) update.status = body.status;
  if (body.depth_flag !== undefined) update.depth_flag = body.depth_flag;
  if (body.personal_notes !== undefined) update.personal_notes = body.personal_notes;
  if (body.chat_summary !== undefined) update.chat_summary = body.chat_summary;

  const { data, error } = await supabase
    .from("articles")
    .update(update)
    .eq("id", body.article_id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

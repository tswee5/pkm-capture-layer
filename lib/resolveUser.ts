// Resolves which auth.users row a non-session-authenticated caller (the MCP
// server, or the token-authenticated /api/capture route) should act as.
// supabase.auth.admin.listUsers() does not guarantee order, and this project
// has in practice had two Google accounts sign in at different times (only
// one with real saved data) — so this never just takes users[0]. See
// CLAUDE.md's "Two Google accounts" note.
//
// No Next-only APIs or "@/" aliases — imported relatively by both the app
// (lib/supabase/admin.ts callers) and the MCP server, which have their own
// separate node_modules installs of @supabase/supabase-js. Typed structurally
// (not the exact SupabaseClient class) so both installs' clients satisfy it.

export interface AdminSupabaseLike {
  auth: {
    admin: {
      listUsers(): Promise<{
        data: { users: { id: string; email?: string | null }[] };
        error: { message: string } | null;
      }>;
    };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

export async function resolveUserId(supabase: AdminSupabaseLike): Promise<string> {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw new Error(`Could not list users: ${error.message}`);
  if (data.users.length === 0) throw new Error("No user found in this Supabase project.");

  const pinnedEmail = process.env.CAPTURE_USER_EMAIL?.toLowerCase();
  if (pinnedEmail) {
    const match = data.users.find((u) => u.email?.toLowerCase() === pinnedEmail);
    if (!match) throw new Error(`No user found with email ${process.env.CAPTURE_USER_EMAIL}`);
    return match.id;
  }

  if (data.users.length === 1) return data.users[0].id;

  const withCounts = await Promise.all(
    data.users.map(async (u) => {
      const { count } = await supabase
        .from("articles")
        .select("id", { count: "exact", head: true })
        .eq("user_id", u.id);
      return { id: u.id, email: u.email, count: count ?? 0 };
    }),
  );
  withCounts.sort((a, b) => b.count - a.count);
  console.error(
    `Multiple Supabase accounts found; using ${withCounts[0].email} (${withCounts[0].count} saved items). Set CAPTURE_USER_EMAIL to pin a different account explicitly.`,
  );
  return withCounts[0].id;
}

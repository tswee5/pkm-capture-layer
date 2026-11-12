// One-off backfill for migration 0006_quotes_dedup.sql: computes
// canonical_url for every existing manual row (Postgres can't run our TS
// canonicalizeUrl()), then folds any duplicate (user_id, canonical_url)
// groups into their oldest row before the partial unique index is created.
//
// Run with: npx tsx scripts/backfill-canonical-urls.ts
// Requires SUPABASE_PAT (see CLAUDE.md "Supabase" section) in the
// environment — this talks to the Management API directly, the same way
// CLAUDE.md's documented curl command does, since there's no DB password.
//
// Safe to re-run: backfilling an already-correct canonical_url is a no-op,
// and the duplicate-fold step only ever touches groups it still finds.

import { canonicalizeUrl } from "../lib/canonicalUrl";

const PROJECT_REF = "rcxppzrbdvhhkczphudg";
const PAT = process.env.SUPABASE_PAT;

if (!PAT) {
  console.error("SUPABASE_PAT must be set in the environment.");
  process.exit(1);
}

interface ArticleRow {
  id: string;
  user_id: string;
  link: string | null;
  canonical_url: string | null;
  personal_notes: string | null;
  depth_flag: "surface" | "deep" | null;
  created_at: string;
  last_captured_at: string;
}

async function runQuery<T = unknown>(query: string): Promise<T> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  if (!res.ok) {
    throw new Error(`Management API error ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

function sqlLiteral(value: string | null): string {
  if (value === null) return "null";
  return `'${value.replace(/'/g, "''")}'`;
}

function formatDateStamp(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function main() {
  console.log("Snapshotting manual articles to articles_backup_20261111...");
  await runQuery(
    `create table if not exists articles_backup_20261111 as select * from articles where source = 'manual';`,
  );

  const rows = await runQuery<ArticleRow[]>(
    `select id, user_id, link, canonical_url, personal_notes, depth_flag, created_at, last_captured_at
     from articles where source = 'manual' order by created_at asc;`,
  );

  console.log(`Found ${rows.length} manual rows. Computing canonical URLs...`);

  const withCanonical = rows.map((row) => {
    if (!row.link) return { ...row, canonical: null as string | null };
    try {
      return { ...row, canonical: canonicalizeUrl(row.link) };
    } catch {
      return { ...row, canonical: null as string | null };
    }
  });

  const updates = withCanonical.filter(
    (row) => row.canonical && row.canonical !== row.canonical_url,
  );
  if (updates.length > 0) {
    console.log(`Backfilling canonical_url for ${updates.length} row(s)...`);
    const caseLines = updates
      .map((row) => `when id = ${sqlLiteral(row.id)} then ${sqlLiteral(row.canonical)}`)
      .join(" ");
    const ids = updates.map((row) => sqlLiteral(row.id)).join(", ");
    await runQuery(
      `update articles set canonical_url = case ${caseLines} end where id in (${ids});`,
    );
  } else {
    console.log("canonical_url already up to date for every row.");
  }

  const groups = new Map<string, typeof withCanonical>();
  for (const row of withCanonical) {
    if (!row.canonical) continue;
    const key = `${row.user_id}::${row.canonical}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const duplicateGroups = Array.from(groups.values()).filter((group) => group.length > 1);
  if (duplicateGroups.length === 0) {
    console.log("No duplicate (user_id, canonical_url) groups found. Nothing to fold.");
  } else {
    console.log(`Found ${duplicateGroups.length} duplicate group(s). Folding...`);
    for (const group of duplicateGroups) {
      const sorted = [...group].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      const survivor = sorted[0];
      const duplicates = sorted.slice(1);

      let mergedNotes = survivor.personal_notes;
      for (const dup of duplicates) {
        if (!dup.personal_notes || !dup.personal_notes.trim()) continue;
        const stamp = formatDateStamp(dup.created_at);
        mergedNotes = mergedNotes && mergedNotes.trim()
          ? `${mergedNotes}\n\n[${stamp}] ${dup.personal_notes.trim()}`
          : dup.personal_notes.trim();
      }

      const mergedDepthFlag =
        survivor.depth_flag ?? duplicates.find((d) => d.depth_flag)?.depth_flag ?? null;

      const allTimestamps = [survivor, ...duplicates].map((r) =>
        new Date(r.last_captured_at ?? r.created_at).getTime(),
      );
      const newestLastCaptured = new Date(Math.max(...allTimestamps)).toISOString();

      const duplicateIds = duplicates.map((d) => d.id);
      console.log(
        `  kept ${survivor.id}, folded [${duplicateIds.join(", ")}] (canonical_url: ${survivor.canonical})`,
      );

      await runQuery(
        `update articles set
           personal_notes = ${sqlLiteral(mergedNotes)},
           depth_flag = ${mergedDepthFlag ? sqlLiteral(mergedDepthFlag) : "null"},
           last_captured_at = ${sqlLiteral(newestLastCaptured)}
         where id = ${sqlLiteral(survivor.id)};`,
      );

      await runQuery(
        `update article_topics set article_id = ${sqlLiteral(survivor.id)}
         where article_id in (${duplicateIds.map(sqlLiteral).join(", ")})
         on conflict do nothing;`,
      ).catch(async () => {
        // article_topics has no upsert-style ON CONFLICT via plain UPDATE;
        // move topics one at a time, skipping ones the survivor already has.
        for (const dupId of duplicateIds) {
          await runQuery(
            `insert into article_topics (article_id, topic_id)
             select ${sqlLiteral(survivor.id)}, topic_id from article_topics where article_id = ${sqlLiteral(dupId)}
             on conflict (article_id, topic_id) do nothing;`,
          );
        }
      });

      await runQuery(`delete from articles where id in (${duplicateIds.map(sqlLiteral).join(", ")});`);
    }
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { TopicSidebar } from "@/components/TopicSidebar";
import { DayGroup } from "@/components/DayGroup";
import { ArticleCard } from "@/components/ArticleCard";
import { TweetCard } from "@/components/TweetCard";
import { FeedTabs, type FeedSource } from "@/components/FeedTabs";
import type { Article, DepthFlag, Status, Topic, TweetType } from "@/types";

type FilterTab = "all" | "pending" | "keep" | "purge";

interface DashboardClientProps {
  userEmail?: string;
}

export function DashboardClient({ userEmail }: DashboardClientProps) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [activeSource, setActiveSource] = useState<FeedSource>("tldr");
  const [twitterSubTab, setTwitterSubTab] = useState<TweetType>("like");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [uploadUrl, setUploadUrl] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailLastSyncedAt, setGmailLastSyncedAt] = useState<string | null>(null);
  const [gmailSyncing, setGmailSyncing] = useState(false);
  const [twitterConnected, setTwitterConnected] = useState(false);
  const [twitterLastSyncedAt, setTwitterLastSyncedAt] = useState<string | null>(null);
  const [twitterSyncing, setTwitterSyncing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const loadGmailStatus = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("user_integrations")
      .select("last_synced_at")
      .eq("provider", "gmail")
      .maybeSingle();
    setGmailConnected(!!data);
    setGmailLastSyncedAt(data?.last_synced_at ?? null);
  }, []);

  const loadTwitterStatus = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("user_integrations")
      .select("last_synced_at")
      .eq("provider", "twitter")
      .maybeSingle();
    setTwitterConnected(!!data);
    setTwitterLastSyncedAt(data?.last_synced_at ?? null);
  }, []);

  const loadArticles = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterTab !== "all") params.set("status", filterTab);
    if (selectedTopicId) params.set("topic_id", selectedTopicId);
    params.set("source", activeSource);
    if (activeSource === "twitter") params.set("tweet_type", twitterSubTab);
    const res = await fetch(`/api/articles?${params.toString()}`);
    if (res.ok) setArticles(await res.json());
  }, [filterTab, selectedTopicId, activeSource, twitterSubTab]);

  const loadTopics = useCallback(async () => {
    const res = await fetch("/api/topics");
    if (res.ok) setTopics(await res.json());
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadArticles(), loadTopics()]).finally(() => setLoading(false));
  }, [loadArticles, loadTopics]);

  useEffect(() => {
    loadGmailStatus();
    loadTwitterStatus();
  }, [loadGmailStatus, loadTwitterStatus]);

  const updateArticleLocally = (id: string, patch: Partial<Article>) => {
    setArticles((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    );
  };

  const handleTriage = async (
    articleId: string,
    patch: { status?: Status; depth_flag?: DepthFlag; personal_notes?: string; chat_summary?: string },
  ) => {
    // Immediately remove purged articles from the "all" and "pending" views
    if (patch.status === "purge" && (filterTab === "all" || filterTab === "pending")) {
      setArticles((prev) => prev.filter((a) => a.id !== articleId));
    } else {
      updateArticleLocally(articleId, patch);
    }
    await fetch("/api/articles/triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ article_id: articleId, ...patch }),
    });
  };

  const handleToggleTopic = async (
    articleId: string,
    topicId: string,
    linked: boolean,
  ) => {
    const article = articles.find((a) => a.id === articleId);
    if (!article) return;

    const topic = topics.find((t) => t.id === topicId);
    const nextTopics = linked
      ? [...(article.topics ?? []), topic!]
      : (article.topics ?? []).filter((t) => t.id !== topicId);
    updateArticleLocally(articleId, { topics: nextTopics });

    if (linked) {
      await fetch("/api/articles/link-topic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ article_id: articleId, topic_id: topicId }),
      });
    } else {
      await fetch(
        `/api/articles/link-topic?article_id=${articleId}&topic_id=${topicId}`,
        { method: "DELETE" },
      );
    }
    loadTopics();
  };

  const handleCreateTopic = async (name: string) => {
    const res = await fetch("/api/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const topic = await res.json();
      setTopics((prev) => [...prev, topic]);
    }
  };

  const handleUpload = async () => {
    if (!uploadUrl.trim()) return;
    setUploading(true);
    try {
      const res = await fetch("/api/articles/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: uploadUrl.trim(), title: uploadTitle.trim() || undefined }),
      });
      if (res.ok) {
        const article = await res.json();
        setArticles((prev) => [article, ...prev]);
        setUploadUrl("");
        setUploadTitle("");
      }
    } finally {
      setUploading(false);
    }
  };

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    if (type === "error") return; // stays until manually dismissed so the detail is readable
    setTimeout(() => setToast(null), 4000);
  };

  // The Gmail/Twitter OAuth callbacks are server-side redirects that report failure via
  // an `?error=` query param on the dashboard URL — there's no fetch() call for those,
  // so the sync-toast error handling above never sees them.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (!error) return;

    const messages: Record<string, string> = {
      twitter_auth: "Twitter connect failed: the authorization request was invalid or expired. Try connecting again.",
      twitter_token: "Twitter connect failed while exchanging the authorization code for a token. Check the Vercel logs for /api/auth/twitter/callback for the exact reason.",
      gmail_auth: "Gmail connect failed: the authorization request was invalid or expired. Try connecting again.",
      gmail_token: "Gmail connect failed while exchanging the authorization code for a token. Check the Vercel logs for /api/auth/gmail/callback for the exact reason.",
      auth: "You're not signed in — please sign in again.",
    };
    showToast(messages[error] ?? `Connection failed (${error}).`, "error");

    params.delete("error");
    const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
    window.history.replaceState({}, "", newUrl);
  }, []);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const handleConnectTwitter = () => {
    window.location.href = "/api/auth/twitter";
  };

  const handleSyncTwitter = async () => {
    setTwitterSyncing(true);
    try {
      const res = await fetch("/api/sync/twitter", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        await Promise.all([loadArticles(), loadTwitterStatus()]);
        showToast(`Twitter synced — ${body.inserted ?? 0} new, ${body.skipped ?? 0} skipped`, "success");
      } else {
        console.error("Twitter sync failed", res.status, body);
        showToast(`Twitter sync failed (${res.status}): ${body.error ?? res.statusText}`, "error");
      }
    } finally {
      setTwitterSyncing(false);
    }
  };

  const handleConnectGmail = () => {
    window.location.href = "/api/auth/gmail";
  };

  const handleSyncGmail = async () => {
    setGmailSyncing(true);
    try {
      const res = await fetch("/api/sync/gmail", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        await Promise.all([loadArticles(), loadGmailStatus()]);
        showToast(`TLDR synced — ${body.inserted ?? 0} new articles, ${body.skipped ?? 0} skipped`, "success");
      } else {
        console.error("Gmail sync failed", res.status, body);
        showToast(`Gmail sync failed (${res.status}): ${body.error ?? res.statusText}`, "error");
        // A dead refresh token gets the integration row deleted server-side (lib/gmail.ts);
        // re-check status so the sidebar button flips to "Connect Gmail" right away.
        await loadGmailStatus();
      }
    } finally {
      setGmailSyncing(false);
    }
  };

  return (
    <div className="relative flex h-screen">
      <TopicSidebar
        topics={topics}
        selectedTopicId={selectedTopicId}
        onSelectTopic={(id) => {
          setSelectedTopicId(id);
          setSidebarOpen(false);
        }}
        onCreateTopic={handleCreateTopic}
        userEmail={userEmail}
        onSignOut={handleSignOut}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        gmailConnected={gmailConnected}
        gmailSyncing={gmailSyncing}
        gmailLastSyncedAt={gmailLastSyncedAt}
        onConnectGmail={handleConnectGmail}
        onSyncGmail={handleSyncGmail}
        twitterConnected={twitterConnected}
        twitterSyncing={twitterSyncing}
        twitterLastSyncedAt={twitterLastSyncedAt}
        onConnectTwitter={handleConnectTwitter}
        onSyncTwitter={handleSyncTwitter}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border text-text-secondary hover:text-text-primary md:hidden"
              aria-label="Open menu"
            >
              ☰
            </button>
            <div className="min-w-0 flex-1">
              <FeedTabs
                activeSource={activeSource}
                onSelectSource={setActiveSource}
                twitterSubTab={twitterSubTab}
                onSelectTwitterSubTab={setTwitterSubTab}
              />
            </div>
          </div>
          <div className="flex gap-1">
            {(["all", "pending", "keep", "purge"] as FilterTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilterTab(tab)}
                className={`min-h-[36px] rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                  filterTab === tab
                    ? "bg-accent text-white"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </header>

        {activeSource === "manual" && (
          <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:px-6">
            <input
              value={uploadUrl}
              onChange={(e) => setUploadUrl(e.target.value)}
              placeholder="Paste a URL to capture..."
              className="min-h-[40px] flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-base text-text-primary outline-none focus:border-accent"
            />
            <input
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
              placeholder="Title (optional)"
              className="min-h-[40px] rounded-md border border-border bg-surface px-3 py-1.5 text-base text-text-primary outline-none focus:border-accent sm:w-48"
            />
            <button
              onClick={handleUpload}
              disabled={uploading || !uploadUrl.trim()}
              className="min-h-[40px] rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {uploading ? "Adding..." : "Add"}
            </button>
          </div>
        )}

        <main className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {loading ? (
            <p className="text-sm text-text-secondary">Loading...</p>
          ) : articles.length === 0 ? (
            <p className="text-sm text-text-secondary">Nothing here yet.</p>
          ) : activeSource === "tldr" || activeSource === "tldr_ai" ? (
            <GroupedArticleList
              articles={articles}
              topics={topics}
              onTriage={handleTriage}
              onToggleTopic={handleToggleTopic}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {articles.map((article) =>
                activeSource === "twitter" ? (
                  <TweetCard
                    key={article.id}
                    article={article}
                    allTopics={topics}
                    onTriage={(status) => handleTriage(article.id, { status })}
                    onDepthChange={(depth_flag) => handleTriage(article.id, { depth_flag })}
                    onSavePersonalNotes={(personal_notes) => handleTriage(article.id, { personal_notes })}
                    onSaveChatSummary={(chat_summary) => handleTriage(article.id, { chat_summary })}
                    onToggleTopic={(topicId, linked) => handleToggleTopic(article.id, topicId, linked)}
                  />
                ) : (
                  <ArticleCard
                    key={article.id}
                    article={article}
                    allTopics={topics}
                    onTriage={(status) => handleTriage(article.id, { status })}
                    onDepthChange={(depth_flag) => handleTriage(article.id, { depth_flag })}
                    onSavePersonalNotes={(personal_notes) => handleTriage(article.id, { personal_notes })}
                    onSaveChatSummary={(chat_summary) => handleTriage(article.id, { chat_summary })}
                    onToggleTopic={(topicId, linked) => handleToggleTopic(article.id, topicId, linked)}
                  />
                ),
              )}
            </div>
          )}
        </main>
      </div>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 max-w-md rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg transition-all ${
            toast.type === "success" ? "bg-keep" : "bg-purge"
          }`}
        >
          <div className="flex items-start gap-3">
            <span className="whitespace-pre-wrap break-words">{toast.message}</span>
            {toast.type === "error" && (
              <button
                onClick={() => setToast(null)}
                className="shrink-0 opacity-80 hover:opacity-100"
                aria-label="Dismiss"
              >
                ×
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function GroupedArticleList({
  articles,
  topics,
  onTriage,
  onToggleTopic,
}: {
  articles: Article[];
  topics: Topic[];
  onTriage: (id: string, patch: { status?: Status; depth_flag?: DepthFlag; personal_notes?: string; chat_summary?: string }) => void;
  onToggleTopic: (articleId: string, topicId: string, linked: boolean) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);

  const groups = useMemo(() => {
    const map = new Map<string, Article[]>();
    for (const article of articles) {
      const key = article.newsletter_date ?? article.created_at.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(article);
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [articles]);

  return (
    <div className="flex flex-col gap-2">
      {groups.map(([date, groupArticles]) => (
        <DayGroup
          key={date}
          date={date}
          articles={groupArticles}
          allTopics={topics}
          defaultExpanded={date === today}
          onTriage={onTriage}
          onToggleTopic={onToggleTopic}
        />
      ))}
    </div>
  );
}

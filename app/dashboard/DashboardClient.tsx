"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { TopicSidebar } from "@/components/TopicSidebar";
import { ArticleCard } from "@/components/ArticleCard";
import { SyncStatus } from "@/components/SyncStatus";
import type { Article, DepthFlag, Status, Topic } from "@/types";

type FilterTab = "all" | "pending" | "keep" | "purge";

interface DashboardClientProps {
  userEmail?: string;
}

export function DashboardClient({ userEmail }: DashboardClientProps) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
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
    const res = await fetch(`/api/articles?${params.toString()}`);
    if (res.ok) setArticles(await res.json());
  }, [filterTab, selectedTopicId]);

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
    updateArticleLocally(articleId, patch);
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
      if (res.ok) {
        await Promise.all([loadArticles(), loadTwitterStatus()]);
      } else {
        const body = await res.json().catch(() => ({}));
        alert(`Twitter sync failed: ${body.error ?? res.statusText}`);
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
      if (res.ok) {
        await Promise.all([loadArticles(), loadGmailStatus()]);
      } else {
        const body = await res.json().catch(() => ({}));
        alert(`Gmail sync failed: ${body.error ?? res.statusText}`);
      }
    } finally {
      setGmailSyncing(false);
    }
  };

  return (
    <div className="flex h-screen">
      <TopicSidebar
        topics={topics}
        selectedTopicId={selectedTopicId}
        onSelectTopic={setSelectedTopicId}
        onCreateTopic={handleCreateTopic}
        userEmail={userEmail}
        onSignOut={handleSignOut}
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
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex gap-1">
            {(["all", "pending", "keep", "purge"] as FilterTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilterTab(tab)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                  filterTab === tab
                    ? "bg-accent text-white"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          <SyncStatus />
        </header>

        <div className="flex items-center gap-2 border-b border-border px-6 py-3">
          <input
            value={uploadUrl}
            onChange={(e) => setUploadUrl(e.target.value)}
            placeholder="Paste a URL to capture..."
            className="flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent"
          />
          <input
            value={uploadTitle}
            onChange={(e) => setUploadTitle(e.target.value)}
            placeholder="Title (optional)"
            className="w-48 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent"
          />
          <button
            onClick={handleUpload}
            disabled={uploading || !uploadUrl.trim()}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {uploading ? "Adding..." : "Add"}
          </button>
        </div>

        <main className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <p className="text-sm text-text-secondary">Loading...</p>
          ) : articles.length === 0 ? (
            <p className="text-sm text-text-secondary">No articles yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {articles.map((article) => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  allTopics={topics}
                  onTriage={(status) => handleTriage(article.id, { status })}
                  onDepthChange={(depth_flag) => handleTriage(article.id, { depth_flag })}
                  onSavePersonalNotes={(personal_notes) =>
                    handleTriage(article.id, { personal_notes })
                  }
                  onSaveChatSummary={(chat_summary) =>
                    handleTriage(article.id, { chat_summary })
                  }
                  onToggleTopic={(topicId, linked) =>
                    handleToggleTopic(article.id, topicId, linked)
                  }
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

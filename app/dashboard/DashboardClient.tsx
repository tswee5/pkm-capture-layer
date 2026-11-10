"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { ItemCard } from "@/components/ItemCard";
import { QuickCapture } from "@/components/QuickCapture";
import { FilterBar } from "@/components/FilterBar";
import type { Article, DepthFlag, Topic } from "@/types";

interface DashboardClientProps {
  userEmail?: string;
}

export function DashboardClient({ userEmail }: DashboardClientProps) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [tags, setTags] = useState<Topic[]>([]);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [readingMode, setReadingMode] = useState<DepthFlag | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    if (type === "error") return;
    setTimeout(() => setToast(null), 4000);
  };

  const loadArticles = useCallback(async () => {
    const params = new URLSearchParams({ source: "manual" });
    if (readingMode) params.set("depth_flag", readingMode);
    if (search.trim()) params.set("q", search.trim());
    const res = await fetch(`/api/articles?${params.toString()}`);
    if (res.ok) setArticles(await res.json());
  }, [readingMode, search]);

  const loadTags = useCallback(async () => {
    const res = await fetch("/api/topics");
    if (res.ok) setTags(await res.json());
  }, []);

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for an in-flight fetch triggered by filter changes, not a render-time computation
    setLoading(true);
    Promise.all([loadArticles(), loadTags()]).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [loadArticles, loadTags]);

  const updateArticleLocally = (id: string, patch: Partial<Article>) => {
    setArticles((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };

  const handleCapture = async (input: {
    url: string;
    notes?: string;
    depth_flag?: DepthFlag | null;
    tag_ids: string[];
  }): Promise<boolean> => {
    try {
      const res = await fetch("/api/articles/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showToast(`Couldn't save that link: ${body.error ?? res.statusText}`, "error");
        return false;
      }
      const article = await res.json();
      setArticles((prev) => [article, ...prev]);
      loadTags();
      return true;
    } catch {
      showToast("Couldn't save that link — check your connection.", "error");
      return false;
    }
  };

  const handleSaveNotes = async (id: string, personal_notes: string) => {
    updateArticleLocally(id, { personal_notes });
    await fetch("/api/articles/triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ article_id: id, personal_notes }),
    });
  };

  const handleSaveTitle = async (id: string, headline: string) => {
    updateArticleLocally(id, { headline });
    const res = await fetch("/api/articles/triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ article_id: id, headline }),
    });
    if (!res.ok) showToast("Couldn't save the title change.", "error");
  };

  const handleSetReadingMode = async (id: string, depth_flag: DepthFlag | null) => {
    updateArticleLocally(id, { depth_flag });
    await fetch("/api/articles/triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ article_id: id, depth_flag }),
    });
  };

  const handleToggleTag = async (articleId: string, tagId: string, linked: boolean) => {
    const article = articles.find((a) => a.id === articleId);
    if (!article) return;
    const tag = tags.find((t) => t.id === tagId);
    const nextTags = linked
      ? [...(article.topics ?? []), tag!]
      : (article.topics ?? []).filter((t) => t.id !== tagId);
    updateArticleLocally(articleId, { topics: nextTags });

    if (linked) {
      await fetch("/api/articles/link-topic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ article_id: articleId, topic_id: tagId }),
      });
    } else {
      await fetch(`/api/articles/link-topic?article_id=${articleId}&topic_id=${tagId}`, {
        method: "DELETE",
      });
    }
    loadTags();
  };

  const handleCreateTag = async (name: string): Promise<Topic | void> => {
    const res = await fetch("/api/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const tag = await res.json();
      setTags((prev) => [...prev, tag]);
      return tag;
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this saved item? This can't be undone.")) return;
    setArticles((prev) => prev.filter((a) => a.id !== id));
    await fetch(`/api/articles/${id}`, { method: "DELETE" });
  };

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const visibleArticles = selectedTagId
    ? articles.filter((a) => (a.topics ?? []).some((t) => t.id === selectedTagId))
    : articles;

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex items-center justify-between">
        <span className="text-lg font-semibold tracking-tight text-text-primary">Capture</span>
        <div className="flex items-center gap-3">
          {userEmail && <span className="hidden text-xs text-text-secondary sm:inline">{userEmail}</span>}
          <button onClick={handleSignOut} className="text-xs text-text-secondary hover:text-text-primary">
            Sign out
          </button>
        </div>
      </header>

      <QuickCapture allTags={tags} onCreateTag={handleCreateTag} onCapture={handleCapture} />

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        tags={tags}
        selectedTagId={selectedTagId}
        onSelectTag={setSelectedTagId}
        readingMode={readingMode}
        onSelectReadingMode={setReadingMode}
      />

      <main className="flex flex-col gap-3">
        {loading ? (
          <p className="text-sm text-text-secondary">Loading...</p>
        ) : visibleArticles.length === 0 ? (
          <p className="text-sm text-text-secondary">
            Nothing saved yet — paste a link above to get started.
          </p>
        ) : (
          visibleArticles.map((article) => (
            <ItemCard
              key={article.id}
              article={article}
              allTags={tags}
              onSaveNotes={(notes) => handleSaveNotes(article.id, notes)}
              onSaveTitle={(headline) => handleSaveTitle(article.id, headline)}
              onSetReadingMode={(mode) => handleSetReadingMode(article.id, mode)}
              onToggleTag={(tagId, linked) => handleToggleTag(article.id, tagId, linked)}
              onCreateTag={handleCreateTag}
              onDelete={() => handleDelete(article.id)}
            />
          ))
        )}
      </main>

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

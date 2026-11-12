"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function UpdatePasswordPage() {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        window.location.href = "/";
        return;
      }
      setReady(true);
    });
  }, []);

  const handleSubmit = async () => {
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setDone(true);
      setTimeout(() => {
        window.location.href = "/dashboard";
      }, 1500);
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <p className="text-sm text-text-secondary">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="flex w-full max-w-xs flex-col items-center gap-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-text-primary">Set your password</h1>

        {done ? (
          <p className="text-sm text-text-secondary">Password set — taking you to your saved items...</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            className="flex w-full flex-col gap-3"
          >
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password"
              className="min-h-[44px] w-full rounded-md border border-border bg-surface px-3 text-base text-text-primary outline-none focus:border-accent"
            />
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm password"
              className="min-h-[44px] w-full rounded-md border border-border bg-surface px-3 text-base text-text-primary outline-none focus:border-accent"
            />
            {error && <p className="text-sm text-purge">{error}</p>}
            <button
              type="submit"
              disabled={submitting || !password || !confirm}
              className="min-h-[44px] rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Save password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

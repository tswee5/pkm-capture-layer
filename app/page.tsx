"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "sign_in" | "forgot_password";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  const handleGoogleLogin = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  const handlePasswordSignIn = async () => {
    if (!email.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      window.location.href = "/dashboard";
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestReset = async () => {
    if (!email.trim()) {
      setError("Enter your email first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?next=/auth/update-password`,
      });
      if (resetError) {
        setError(resetError.message);
        return;
      }
      setResetSent(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="flex w-full max-w-xs flex-col items-center gap-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-text-primary">Capture</h1>
        <p className="text-text-secondary">
          Save what you find. Add a note, tag it, come back to it later.
        </p>

        {mode === "sign_in" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handlePasswordSignIn();
            }}
            className="flex w-full flex-col gap-3"
          >
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="min-h-[44px] w-full rounded-md border border-border bg-surface px-3 text-base text-text-primary outline-none focus:border-accent"
            />
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="min-h-[44px] w-full rounded-md border border-border bg-surface px-3 text-base text-text-primary outline-none focus:border-accent"
            />
            {error && <p className="text-sm text-purge">{error}</p>}
            <button
              type="submit"
              disabled={submitting || !email.trim() || !password}
              className="min-h-[44px] rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {submitting ? "Signing in..." : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("forgot_password");
                setError(null);
              }}
              className="text-xs text-text-secondary hover:text-text-primary"
            >
              Forgot password / set a password
            </button>
          </form>
        ) : (
          <div className="flex w-full flex-col gap-3">
            {resetSent ? (
              <p className="text-sm text-text-secondary">
                Check your email for a link to set your password, then come back and sign in.
              </p>
            ) : (
              <>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  className="min-h-[44px] w-full rounded-md border border-border bg-surface px-3 text-base text-text-primary outline-none focus:border-accent"
                />
                {error && <p className="text-sm text-purge">{error}</p>}
                <button
                  onClick={handleRequestReset}
                  disabled={submitting || !email.trim()}
                  className="min-h-[44px] rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                >
                  {submitting ? "Sending..." : "Email me a set-password link"}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setMode("sign_in");
                setError(null);
                setResetSent(false);
              }}
              className="text-xs text-text-secondary hover:text-text-primary"
            >
              Back to sign in
            </button>
          </div>
        )}

        <div className="flex w-full items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs text-text-secondary">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <button
          onClick={handleGoogleLogin}
          className="min-h-[44px] w-full rounded-md border border-border px-5 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface"
        >
          Continue with Google
        </button>
      </div>
    </div>
  );
}

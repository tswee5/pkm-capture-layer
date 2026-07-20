"use client";

import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const handleLogin = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-text-primary">
          Capture
        </h1>
        <p className="max-w-sm text-text-secondary">
          Triage articles from TLDR, Twitter, and the web into a single
          queue.
        </p>
        <button
          onClick={handleLogin}
          className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}

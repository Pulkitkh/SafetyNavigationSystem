"use client";

import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Callout } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useSession } from "@/lib/client/hooks";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const { refresh } = useSession();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [next, setNext] = useState("");

  useEffect(() => {
    const n = new URLSearchParams(window.location.search).get("next");
    // Only follow same-site relative paths.
    setNext(n && n.startsWith("/") && !n.startsWith("//") ? n : "");
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/auth/${mode}`, {
        method: "POST",
        json: mode === "login" ? { email: form.email, password: form.password } : form,
      });
      await refresh();
      router.replace(next || (mode === "register" ? "/contacts?welcome=1" : "/"));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const other = mode === "login" ? "/register" : "/login";
  return (
    <main id="main" className="pt-safe mx-auto max-w-sm px-5 pb-nav">
      <div className="mt-6 flex flex-col items-center text-center">
        <span className="hero-gradient flex h-14 w-14 items-center justify-center rounded-2xl shadow-card" aria-hidden>
          <ShieldCheck className="h-7 w-7" />
        </span>
        <h1 className="mt-4 text-[1.65rem] font-extrabold tracking-tight text-ink">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
        <p className="mt-1 text-[15px] text-ink-2">
          {mode === "login" ? "Sign in to share journeys and alert your contacts." : "Free. Lets your trusted contacts follow your journeys and get your SOS instantly."}
        </p>
      </div>
      <form onSubmit={submit} className="card mt-6 space-y-4 p-5" noValidate={false}>
        {mode === "register" && (
          <div>
            <label htmlFor="a-name" className="label">
              Your name
            </label>
            <input id="a-name" className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} autoComplete="name" />
          </div>
        )}
        <div>
          <label htmlFor="a-email" className="label">
            Email
          </label>
          <input id="a-email" className="field" type="email" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoComplete="email" />
        </div>
        {mode === "register" && (
          <div>
            <label htmlFor="a-phone" className="label">
              Mobile number <span className="font-normal text-ink-3">(optional)</span>
            </label>
            <input
              id="a-phone"
              className="field"
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              autoComplete="tel"
              placeholder="98765 43210"
              aria-describedby="a-phone-hint"
            />
            <p id="a-phone-hint" className="mt-1 text-[13px] text-ink-3">
              Shown to your contacts on your live link, so they can call you.
            </p>
          </div>
        )}
        <div>
          <label htmlFor="a-pass" className="label">
            Password
          </label>
          <div className="relative">
            <input
              id="a-pass"
              className="field pr-12"
              type={show ? "text" : "password"}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              minLength={mode === "register" ? 8 : 1}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              aria-describedby={mode === "register" ? "a-pass-hint" : undefined}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Hide password" : "Show password"}
              aria-pressed={show}
              className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-ink-3 hover:bg-surface-3"
            >
              {show ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
            </button>
          </div>
          {mode === "register" && (
            <p id="a-pass-hint" className="mt-1 text-[13px] text-ink-3">
              At least 8 characters.
            </p>
          )}
        </div>
        {error && <Callout tone="danger">{error}</Callout>}
        <button disabled={busy} className="btn btn-primary w-full text-base">
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>
      <p className="mt-5 text-center text-[15px] text-ink-2">
        {mode === "login" ? "New to SafeNav? " : "Already have an account? "}
        <Link href={next ? `${other}?next=${encodeURIComponent(next)}` : other} className="font-bold text-brand-ink">
          {mode === "login" ? "Create an account" : "Sign in"}
        </Link>
      </p>
    </main>
  );
}

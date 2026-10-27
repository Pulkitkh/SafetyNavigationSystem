"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { useSession } from "@/lib/client/hooks";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const { refresh } = useSession();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      const next = new URLSearchParams(window.location.search).get("next");
      // Only follow same-site relative paths.
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : mode === "register" ? "/contacts?welcome=1" : "/");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const field = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
  return (
    <main className="mx-auto max-w-sm px-5 pb-nav pt-[max(2rem,env(safe-area-inset-top))]">
      <h1 className="text-2xl font-bold text-slate-900">{mode === "login" ? "Sign in" : "Create your account"}</h1>
      <p className="mt-1 text-sm text-slate-600">
        {mode === "login" ? "Sign in to share journeys and alert your contacts." : "An account lets your trusted contacts follow your journeys live."}
      </p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        {mode === "register" && (
          <label className="block text-sm font-medium text-slate-700">
            Name
            <input className={`${field} mt-1`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} autoComplete="name" />
          </label>
        )}
        <label className="block text-sm font-medium text-slate-700">
          Email
          <input className={`${field} mt-1`} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoComplete="email" />
        </label>
        {mode === "register" && (
          <label className="block text-sm font-medium text-slate-700">
            Mobile number <span className="font-normal text-slate-500">(optional, shown to your contacts)</span>
            <input className={`${field} mt-1`} type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" placeholder="98765 43210" />
          </label>
        )}
        <label className="block text-sm font-medium text-slate-700">
          Password
          <input
            className={`${field} mt-1`}
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            minLength={mode === "register" ? 8 : 1}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </label>
        {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-800" role="alert">{error}</p>}
        <button disabled={busy} className="w-full rounded-xl bg-brand-600 py-3 font-semibold text-white disabled:opacity-50">
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-600">
        {mode === "login" ? (
          <>
            New here? <Link href="/register" className="font-medium text-brand-600">Create an account</Link>
          </>
        ) : (
          <>
            Already have an account? <Link href="/login" className="font-medium text-brand-600">Sign in</Link>
          </>
        )}
      </p>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/Nav";
import { api } from "@/lib/client/api";
import { useSession } from "@/lib/client/hooks";
import { store } from "@/lib/client/store";

export default function AccountPage() {
  const router = useRouter();
  const { me, loading, refresh } = useSession();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (me) {
      setName(me.name);
      setPhone(me.phone ?? "");
    }
  }, [me]);

  if (loading) return <main className="p-6 text-slate-600">Loading…</main>;
  if (!me) {
    return (
      <main className="p-6">
        <Link href="/login?next=/account" className="text-brand-600 underline">
          Sign in
        </Link>
      </main>
    );
  }

  const save = async (patch: Record<string, unknown>) => {
    setMsg(null);
    try {
      await api("/api/auth/me", { method: "PATCH", json: patch });
      await refresh();
      setMsg("Saved");
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    store.setJourney(null);
    store.setContacts([]);
    await refresh();
    router.replace("/");
  };

  return (
    <main className="mx-auto max-w-lg pb-nav">
      <PageHeader title="Account" subtitle={me.email} />
      <div className="space-y-4 px-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save({ name, phone: phone.trim() || null });
          }}
          className="space-y-2 rounded-2xl bg-white p-4 shadow-sm"
        >
          <label className="block text-sm font-medium text-slate-700">
            Name
            <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Mobile number (shown to your contacts on the live link)
            <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <button className="rounded-xl bg-brand-600 px-4 py-2 font-semibold text-white">Save</button>
        </form>

        <label className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-sm">
          <input type="checkbox" className="mt-1 h-5 w-5" checked={me.autoSos} onChange={(e) => save({ autoSos: e.target.checked })} />
          <span className="text-sm text-slate-700">
            <span className="block font-medium text-slate-900">Automatic SOS</span>
            If you don&apos;t answer a safety check-in within 60 seconds during a journey, SafeNav raises an SOS for you.
          </span>
        </label>

        {msg && <p className="text-sm text-slate-600">{msg}</p>}

        <div className="flex gap-3 text-sm">
          <Link href="/contacts" className="text-brand-600 underline">
            Trusted contacts
          </Link>
          <Link href="/about" className="text-brand-600 underline">
            How SafeNav works
          </Link>
        </div>
        <button onClick={logout} className="w-full rounded-xl border border-slate-300 bg-white py-2.5 font-medium text-slate-800">
          Sign out
        </button>
      </div>
    </main>
  );
}

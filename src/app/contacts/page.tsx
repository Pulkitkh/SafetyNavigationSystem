"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/Nav";
import { api } from "@/lib/client/api";
import { useSession } from "@/lib/client/hooks";
import { detectPlatform, smsUri } from "@/lib/sos";

const RELATIONS = ["Mother", "Father", "Sister", "Brother", "Spouse", "Partner", "Friend", "Colleague", "Other"];
const MAX = 5;

export default function ContactsPage() {
  const { me, loading, contacts, refreshContacts } = useSession();
  const [form, setForm] = useState({ name: "", phone: "", relation: "Friend" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "other">("other");

  useEffect(() => {
    setWelcome(new URLSearchParams(window.location.search).get("welcome") === "1");
    setPlatform(detectPlatform(navigator.userAgent));
  }, []);

  if (loading) return <main className="p-6 text-slate-600">Loading…</main>;
  if (!me) {
    return (
      <main className="mx-auto max-w-lg pb-nav">
        <PageHeader title="Trusted contacts" subtitle="The people alerted when you send SOS." />
        <div className="mx-4 rounded-2xl bg-white p-4 text-sm text-slate-700">
          <Link href="/login?next=/contacts" className="font-medium text-brand-600">Sign in</Link> to save up to {MAX} trusted contacts. They&apos;re stored on
          your phone too, so SOS works without internet.
        </div>
      </main>
    );
  }

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/contacts", { method: "POST", json: form });
      setForm({ name: "", phone: "", relation: "Friend" });
      await refreshContacts();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Remove ${name} from trusted contacts?`)) return;
    await api(`/api/contacts/${id}`, { method: "DELETE" }).catch((err) => setError((err as Error).message));
    await refreshContacts();
  };

  const makePrimary = async (id: string) => {
    await api(`/api/contacts/${id}`, { method: "PATCH", json: { isPrimary: true } }).catch((err) => setError((err as Error).message));
    await refreshContacts();
  };

  const testMessage = `Hi, I've added you as an emergency contact on SafeNav. If I'm in trouble you'll get an SOS from me with my live location. — ${me.name}`;

  return (
    <main className="mx-auto max-w-lg pb-nav">
      <PageHeader title="Trusted contacts" subtitle={`Up to ${MAX} people who get your SOS and journey links.`} />
      <div className="space-y-4 px-4">
        {welcome && contacts.length === 0 && (
          <p className="rounded-2xl bg-brand-50 p-4 text-sm text-brand-700">Welcome! Add at least one person you trust. SafeNav can only alert people you add here.</p>
        )}

        <ul className="space-y-2">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700" aria-hidden>
                {c.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900">
                  {c.name} {c.isPrimary && <span className="ml-1 rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-semibold text-white">PRIMARY</span>}
                </p>
                <p className="text-sm text-slate-500">
                  {c.relation} · {c.phone}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 text-xs">
                {!c.isPrimary && (
                  <button onClick={() => makePrimary(c.id)} className="text-brand-600">
                    Make primary
                  </button>
                )}
                <button onClick={() => remove(c.id, c.name)} className="text-red-600">
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>

        {contacts.length > 0 && (
          <a href={smsUri(contacts.map((c) => c.phone), testMessage, platform)} className="block rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-center text-sm font-medium text-slate-800">
            Tell them they&apos;re your emergency contacts
          </a>
        )}

        {contacts.length < MAX ? (
          <form onSubmit={add} className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="font-semibold text-slate-900">Add a contact</h2>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              aria-label="Name"
            />
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Mobile number, e.g. 98765 43210"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              required
              aria-label="Mobile number"
            />
            <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2" value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value })} aria-label="Relation">
              {RELATIONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
            <button disabled={busy} className="w-full rounded-xl bg-brand-600 py-2.5 font-semibold text-white disabled:opacity-50">
              {busy ? "Adding…" : "Add contact"}
            </button>
          </form>
        ) : (
          <p className="text-sm text-slate-600">You&apos;ve added the maximum of {MAX} contacts.</p>
        )}

        <div className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-700">
          <p className="font-medium text-slate-900">How alerts reach them</p>
          <p className="mt-1">
            On SOS your phone opens a ready-to-send SMS to all contacts with your location and a live tracking link. SMS works without mobile data. If
            automatic SMS is enabled on the server, it is also sent for you without a tap.
          </p>
        </div>
      </div>
    </main>
  );
}

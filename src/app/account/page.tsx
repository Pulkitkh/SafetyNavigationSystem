"use client";

import { Info, LogOut, Settings, ShieldAlert, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/Nav";
import { ShareLiveCard } from "@/components/ShareLiveCard";
import { initials } from "@/components/Sos";
import { Callout, EmptyState, ListRow, Toggle } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useSession } from "@/lib/client/hooks";
import { store } from "@/lib/client/store";

export default function AccountPage() {
  const router = useRouter();
  const { me, loading, refresh, contacts } = useSession();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (me) {
      setName(me.name);
      setPhone(me.phone ?? "");
    }
  }, [me]);

  if (loading) return <main id="main" className="flex min-h-dvh items-center justify-center text-ink-2">Loading…</main>;
  if (!me) {
    return (
      <main id="main" className="mx-auto max-w-lg pb-nav">
        <PageHeader title="Account" back="/safety" />
        <div className="card mx-4">
          <EmptyState
            icon={Users}
            title="You're not signed in"
            text="Sign in to share journeys live and alert your contacts automatically."
            action={
              <Link href="/login?next=/account" className="btn btn-primary w-full">
                Sign in
              </Link>
            }
          />
        </div>
      </main>
    );
  }

  const save = async (patch: Record<string, unknown>) => {
    setMsg(null);
    setSaving(true);
    try {
      await api("/api/auth/me", { method: "PATCH", json: patch });
      await refresh();
      setMsg({ ok: true, text: "Saved" });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
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
    <main id="main" className="mx-auto max-w-lg pb-nav">
      <PageHeader title="Account" back="/safety" />
      <div className="space-y-5 px-4">
        <div className="flex items-center gap-4 px-1">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xl font-extrabold text-brand-soft-ink" aria-hidden>
            {initials(me.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xl font-extrabold text-ink">{me.name}</p>
            <p className="truncate text-sm text-ink-2">{me.email}</p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save({ name, phone: phone.trim() || null });
          }}
          className="card space-y-4 p-4"
        >
          <div>
            <label htmlFor="acc-name" className="label">
              Name
            </label>
            <input id="acc-name" className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
          <div>
            <label htmlFor="acc-phone" className="label">
              Mobile number
            </label>
            <input id="acc-phone" className="field" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" aria-describedby="acc-phone-hint" />
            <p id="acc-phone-hint" className="mt-1 text-[13px] text-ink-3">
              Shown to your contacts on your live link, so they can call you.
            </p>
          </div>
          <button disabled={saving} className="btn btn-primary w-full">
            {saving ? "Saving…" : "Save changes"}
          </button>
          {msg && <Callout tone={msg.ok ? "good" : "danger"}>{msg.text}</Callout>}
        </form>

        <ShareLiveCard />

        <div className="card overflow-hidden">
          <Toggle
            icon={ShieldAlert}
            tone="sos"
            label="Automatic SOS"
            description="During a journey or safety timer, if you don't answer a check-in within 60 seconds, SafeNav raises the SOS for you."
            checked={me.autoSos}
            onChange={(v) => void save({ autoSos: v })}
          />
        </div>

        <div className="card divide-y divide-line overflow-hidden">
          <ListRow href="/contacts" icon={Users} title="Trusted contacts" text={`${contacts.length} of 5 added`} />
          <ListRow href="/safety#settings" icon={Settings} tone="neutral" title="Settings on this phone" text="Shake to SOS, automatic SMS, theme" />
          <ListRow href="/about" icon={Info} tone="neutral" title="How SafeNav works" text="Scores, data sources and limits" />
        </div>

        <button onClick={logout} className="btn btn-outline w-full">
          <LogOut className="h-5 w-5" aria-hidden />
          Sign out
        </button>
      </div>
    </main>
  );
}

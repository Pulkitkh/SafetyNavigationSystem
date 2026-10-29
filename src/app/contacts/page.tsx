"use client";

import { BellOff, BellRing, Check, Copy, MessageCircle, MessageSquareText, MoreVertical, Phone, Plus, Send, Share2, Star, Trash2, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/Nav";
import { initials } from "@/components/Sos";
import { Badge, Callout, EmptyState, IconTile, Sheet } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useSession } from "@/lib/client/hooks";
import type { StoredContact } from "@/lib/client/store";
import { detectPlatform, smsUri, whatsappUri } from "@/lib/sos";

const RELATIONS = ["Mother", "Father", "Sister", "Brother", "Spouse", "Partner", "Friend", "Colleague", "Other"];
const MAX = 5;

interface Invite {
  contact: StoredContact;
  url: string;
  message: string;
}

export default function ContactsPage() {
  const { me, loading, contacts, refreshContacts } = useSession();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", relation: "Friend" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "other">("other");
  const [invite, setInvite] = useState<Invite | null>(null);
  const [menu, setMenu] = useState<StoredContact | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setWelcome(new URLSearchParams(window.location.search).get("welcome") === "1");
    setPlatform(detectPlatform(navigator.userAgent));
  }, []);

  // Contacts open their invite on their own phone; refresh when coming back to see who's linked.
  useEffect(() => {
    const onFocus = () => document.visibilityState === "visible" && void refreshContacts();
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [refreshContacts]);

  if (loading) {
    return (
      <main id="main" className="mx-auto max-w-lg pb-nav">
        <PageHeader title="Trusted contacts" icon={<Users />} />
        <div className="space-y-2 px-4" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="card h-24 animate-pulse" />
          ))}
        </div>
      </main>
    );
  }

  if (!me) {
    return (
      <main id="main" className="mx-auto max-w-lg pb-nav">
        <PageHeader title="Trusted contacts" subtitle="The people alerted the moment you press SOS." icon={<Users />} />
        <div className="card mx-4">
          <EmptyState
            icon={Users}
            title="Who should we alert?"
            text={`Create a free account to add up to ${MAX} trusted contacts. They get your SOS automatically, with your live location.`}
            action={
              <div className="grid gap-2">
                <Link href="/register?next=/contacts" className="btn btn-primary w-full">
                  Create account
                </Link>
                <Link href="/login?next=/contacts" className="btn btn-ghost w-full">
                  I have an account
                </Link>
              </div>
            }
          />
        </div>
      </main>
    );
  }

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { contact } = await api<{ contact: StoredContact }>("/api/contacts", { method: "POST", json: form });
      setForm({ name: "", phone: "", relation: "Friend" });
      await refreshContacts();
      setAdding(false);
      // Straight into the one step that makes alerts automatic.
      void openInvite(contact);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openInvite = async (c: StoredContact) => {
    setError(null);
    setCopied(false);
    try {
      const res = await api<{ url: string; message: string }>(`/api/contacts/${c.id}/invite`, { method: "POST" });
      setInvite({ contact: c, ...res });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (c: StoredContact) => {
    setMenu(null);
    if (!confirm(`Remove ${c.name} from trusted contacts? They will stop getting your alerts.`)) return;
    await api(`/api/contacts/${c.id}`, { method: "DELETE" }).catch((err) => setError((err as Error).message));
    await refreshContacts();
  };

  const stopAlerts = async (c: StoredContact) => {
    setMenu(null);
    if (!confirm(`Stop automatic alerts to ${c.name}? Their invite link stops working too. You can send a new one later.`)) return;
    await api(`/api/contacts/${c.id}/invite`, { method: "DELETE" }).catch((err) => setError((err as Error).message));
    await refreshContacts();
  };

  const makePrimary = async (c: StoredContact) => {
    setMenu(null);
    await api(`/api/contacts/${c.id}`, { method: "PATCH", json: { isPrimary: true } }).catch((err) => setError((err as Error).message));
    await refreshContacts();
  };

  const linkedCount = contacts.filter((c) => (c.alerts?.push ?? 0) + (c.alerts?.telegram ?? 0) + (c.alerts?.whatsapp ?? 0) > 0).length;

  return (
    <main id="main" className="mx-auto max-w-lg pb-nav">
      <PageHeader
        title="Trusted contacts"
        subtitle={contacts.length ? `${linkedCount} of ${contacts.length} get instant alerts` : "The people alerted the moment you press SOS."}
        icon={<Users />}
        action={
          contacts.length > 0 && contacts.length < MAX ? (
            <button onClick={() => setAdding(true)} className="btn btn-primary btn-sm shrink-0">
              <Plus className="h-4 w-4" aria-hidden />
              Add
            </button>
          ) : undefined
        }
      />
      <div className="space-y-4 px-4">
        {error && <Callout tone="danger">{error}</Callout>}
        {welcome && contacts.length === 0 && (
          <Callout tone="brand" icon={UserPlus} title="Welcome to SafeNav">
            Add at least one person you trust. SafeNav can only alert people you add here.
          </Callout>
        )}

        {contacts.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={UserPlus}
              title="Add your first contact"
              text="A parent, partner or friend who'd come or call for help. They don't need to install anything."
              action={
                <button onClick={() => setAdding(true)} className="btn btn-primary w-full">
                  <Plus className="h-5 w-5" aria-hidden />
                  Add a contact
                </button>
              }
            />
          </div>
        ) : (
          <ul className="space-y-3">
            {contacts.map((c, i) => {
              const linked = (c.alerts?.push ?? 0) + (c.alerts?.telegram ?? 0) + (c.alerts?.whatsapp ?? 0);
              return (
                <li key={c.id} className={`card rise rise-${Math.min(i + 1, 4)} p-4`}>
                  <div className="flex items-center gap-3">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-soft text-base font-extrabold text-brand-soft-ink" aria-hidden>
                      {initials(c.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-extrabold leading-snug text-ink">{c.name}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
                        <span>{c.relation}</span>
                        {c.isPrimary && (
                          <Badge tone="brand" icon={Star}>
                            Primary
                          </Badge>
                        )}
                      </p>
                      <p className="text-sm tabular-nums text-ink-2">{c.phone}</p>
                    </div>
                    <a href={`tel:${c.phone}`} aria-label={`Call ${c.name}`} className="tap flex h-11 w-11 items-center justify-center rounded-full text-ink-2">
                      <Phone className="h-5 w-5" aria-hidden />
                    </a>
                    <button onClick={() => setMenu(c)} aria-label={`More options for ${c.name}`} className="tap -mr-2 flex h-11 w-11 items-center justify-center rounded-full text-ink-2">
                      <MoreVertical className="h-5 w-5" aria-hidden />
                    </button>
                  </div>
                  <div className={`mt-3 flex items-center gap-3 rounded-2xl p-3 ${linked ? "bg-good-soft" : "bg-caution-soft"}`}>
                    {linked ? <BellRing className="h-5 w-5 shrink-0 text-good" aria-hidden /> : <BellOff className="h-5 w-5 shrink-0 text-caution" aria-hidden />}
                    <p className="min-w-0 flex-1 text-sm text-ink">
                      {linked ? (
                        <>
                          <b>Instant alerts on</b>
                          {" · "}
                          {[c.alerts?.push ? `${c.alerts.push} phone${c.alerts.push > 1 ? "s" : ""}` : null, c.alerts?.whatsapp ? "WhatsApp" : null, c.alerts?.telegram ? "Telegram" : null]
                            .filter(Boolean)
                            .join(" + ")}
                        </>
                      ) : (
                        <>
                          <b>Not getting instant alerts yet.</b> Send them their link once.
                        </>
                      )}
                    </p>
                    <button onClick={() => void openInvite(c)} className={`btn btn-sm shrink-0 ${linked ? "btn-outline" : "btn-primary"}`}>
                      {linked ? "Re-send" : "Invite"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {contacts.length >= MAX && <p className="px-1 text-sm text-ink-2">You&apos;ve added the maximum of {MAX} contacts.</p>}

        <section className="card p-4" aria-labelledby="how-title">
          <h2 id="how-title" className="font-extrabold text-ink">
            How your SOS reaches them
          </h2>
          <ul className="mt-3 space-y-3">
            <li className="flex gap-3">
              <IconTile icon={BellRing} tone="good" size="sm" />
              <p className="text-sm text-ink-2">
                <b className="text-ink">Instant alert on their phone or WhatsApp.</b> They open their invite link once and turn on alerts. After that every
                SOS reaches them with your live location, with nothing for you to do.
              </p>
            </li>
            <li className="flex gap-3">
              <IconTile icon={MessageSquareText} tone="info" size="sm" />
              <p className="text-sm text-ink-2">
                <b className="text-ink">SMS from your phone.</b> In the Android app, SOS texts everyone automatically from your SIM, even without internet. On
                other phones it&apos;s one tap.
              </p>
            </li>
            <li className="flex gap-3">
              <IconTile icon={Check} tone="brand" size="sm" />
              <p className="text-sm text-ink-2">
                <b className="text-ink">You see who&apos;s been reached</b> and who has opened your alert, on the SOS screen.
              </p>
            </li>
          </ul>
        </section>
      </div>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add a trusted contact">
        <form onSubmit={add} className="space-y-4">
          <div>
            <label htmlFor="c-name" className="label">
              Name
            </label>
            <input id="c-name" className="field" placeholder="e.g. Priya Sharma" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoComplete="name" />
          </div>
          <div>
            <label htmlFor="c-phone" className="label">
              Mobile number
            </label>
            <input
              id="c-phone"
              className="field"
              placeholder="98765 43210"
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              required
              autoComplete="tel"
              aria-describedby="c-phone-hint"
            />
            <p id="c-phone-hint" className="mt-1 text-[13px] text-ink-3">
              Indian numbers work without +91.
            </p>
          </div>
          <div>
            <span className="label">Relation</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Relation">
              {RELATIONS.map((r) => (
                <button type="button" key={r} role="radio" aria-checked={form.relation === r} data-on={form.relation === r} onClick={() => setForm({ ...form, relation: r })} className="chip">
                  {r}
                </button>
              ))}
            </div>
          </div>
          {error && <Callout tone="danger">{error}</Callout>}
          <button disabled={busy} className="btn btn-primary w-full">
            {busy ? "Adding…" : "Add contact"}
          </button>
        </form>
      </Sheet>

      <Sheet open={!!invite} onClose={() => setInvite(null)} title={invite ? `Turn on alerts for ${invite.contact.name.split(" ")[0]}` : ""}>
        {invite && (
          <div className="space-y-4">
            <p className="text-[15px] text-ink-2">
              Send this link to {invite.contact.name.split(" ")[0]}. When they open it on their phone and tap <b className="text-ink">Turn on alerts</b>, your SOS
              will reach them instantly from then on.
            </p>
            <div className="card-inset break-all p-3 text-sm text-ink-2">{invite.url}</div>
            <div className="grid gap-2">
              <a href={whatsappUri(invite.contact.phone, invite.message)} target="_blank" rel="noopener noreferrer" className="btn bg-[#128c4b] text-white">
                <MessageCircle className="h-5 w-5" aria-hidden />
                Send on WhatsApp
              </a>
              <a href={smsUri([invite.contact.phone], invite.message, platform)} className="btn btn-outline">
                <Send className="h-5 w-5" aria-hidden />
                Send by SMS
              </a>
              <div className="grid grid-cols-2 gap-2">
                {"share" in navigator && (
                  <button onClick={() => void navigator.share({ title: "SafeNav alerts", text: invite.message }).catch(() => {})} className="btn btn-ghost">
                    <Share2 className="h-5 w-5" aria-hidden />
                    Other app
                  </button>
                )}
                <button
                  onClick={() =>
                    void navigator.clipboard?.writeText(invite.url).then(
                      () => setCopied(true),
                      () => {},
                    )
                  }
                  className="btn btn-ghost"
                >
                  {copied ? <Check className="h-5 w-5" aria-hidden /> : <Copy className="h-5 w-5" aria-hidden />}
                  {copied ? "Copied" : "Copy link"}
                </button>
              </div>
            </div>
            <p className="text-[13px] text-ink-3">The link only lets them receive your alerts. A new link replaces this one.</p>
          </div>
        )}
      </Sheet>

      <Sheet open={!!menu} onClose={() => setMenu(null)} title={menu?.name ?? ""}>
        {menu && (
          <div className="-mx-5 divide-y divide-line">
            {!menu.isPrimary && (
              <button onClick={() => void makePrimary(menu)} className="tap flex min-h-14 w-full items-center gap-3 px-5 text-left font-semibold text-ink">
                <Star className="h-5 w-5 text-ink-2" aria-hidden />
                Make primary contact
              </button>
            )}
            {(menu.alerts?.push ?? 0) + (menu.alerts?.telegram ?? 0) + (menu.alerts?.whatsapp ?? 0) > 0 && (
              <button onClick={() => void stopAlerts(menu)} className="tap flex min-h-14 w-full items-center gap-3 px-5 text-left font-semibold text-ink">
                <BellOff className="h-5 w-5 text-ink-2" aria-hidden />
                Stop instant alerts
              </button>
            )}
            <button onClick={() => void remove(menu)} className="tap flex min-h-14 w-full items-center gap-3 px-5 text-left font-semibold text-danger">
              <Trash2 className="h-5 w-5" aria-hidden />
              Remove contact
            </button>
          </div>
        )}
      </Sheet>
    </main>
  );
}

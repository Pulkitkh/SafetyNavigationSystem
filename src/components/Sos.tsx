"use client";

import { BellRing, Check, ChevronDown, Eye, LoaderCircle, MessageSquareText, Phone, Send, Share2, ShieldCheck, Siren, TriangleAlert, UserPlus, Volume2, VolumeX, X } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, formatAgo, newShareToken } from "@/lib/client/api";
import { batteryLevel, useGeolocation, usePrefs, useSession } from "@/lib/client/hooks";
import { nativeSos, type NativeSosOutcome, type SmsResult } from "@/lib/client/native";
import { useShake } from "@/lib/client/shake";
import { store, type StoredContact } from "@/lib/client/store";
import { detectPlatform, EMERGENCY_NUMBERS, mapsLink, smsUri, sosMessage, whatsappUri } from "@/lib/sos";

type Trigger = "manual" | "missed_checkin" | "deviation";
type Channel = "sms_device" | "push" | "telegram" | "whatsapp" | "fcm" | "sms_gateway";

interface Reach {
  delivered: Channel[];
  failed: Channel[];
  seenAt: string | null;
  /** The contact's answer from the SafeNav app. */
  response?: string | null;
}

interface SosState {
  trigger: Trigger;
  /** A practice run: nothing is sent to anyone. */
  drill: boolean;
  /** Raised by the Android app itself while SafeNav was closed. */
  fromNative: boolean;
  token: string;
  tripId: string | null;
  liveUrl: string | null;
  message: string;
  server: "pending" | "ok" | "failed" | "skipped";
  serverError?: string;
  sms: "pending" | "done" | "unavailable";
  /** Per contact id. */
  reach: Record<string, Reach>;
  startedAt: number;
}

interface SosApi {
  active: boolean;
  /** `note` adds context to the message, e.g. where the person said they would be. */
  trigger: (trigger?: Trigger, note?: string) => void;
  /** Practice: shows exactly what an SOS would do, without alerting anyone. */
  drill: () => void;
  /** A shake was detected (by the browser, or by the Android app while it's open). */
  shake: () => void;
  /** Show an SOS the Android app already sent. */
  adopt: (o: NativeSosOutcome) => void;
}

const SosContext = createContext<SosApi | null>(null);

export function useSos() {
  const ctx = useContext(SosContext);
  if (!ctx) throw new Error("useSos must be used inside SosProvider");
  return ctx;
}

const REASON: Record<Trigger, string | null> = {
  manual: null,
  missed_checkin: "missed a safety check-in",
  deviation: "unexpected route change",
};

const CHANNEL_LABEL: Record<Channel, string> = {
  sms_device: "SMS",
  sms_gateway: "SMS",
  push: "App alert",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  fcm: "SafeNav app",
};

function addReach(map: Record<string, Reach>, id: string, channel: Channel, ok: boolean): Record<string, Reach> {
  const r = map[id] ?? { delivered: [], failed: [], seenAt: null };
  const list = ok ? r.delivered : r.failed;
  if (list.includes(channel)) return map;
  return { ...map, [id]: { ...r, [ok ? "delivered" : "failed"]: [...list, channel] } };
}

function smsToReach(map: Record<string, Reach>, contacts: StoredContact[], results: SmsResult[]) {
  let next = map;
  for (const r of results) {
    const c = contacts.find((x) => x.phone === r.to);
    if (c) next = addReach(next, c.id, "sms_device", r.ok);
  }
  return next;
}

export function SosProvider({ children }: { children: ReactNode }) {
  const { me, contacts } = useSession();
  const [sos, setSos] = useState<SosState | null>(null);
  const [shakeCountdown, setShakeCountdown] = useState<number | null>(null);
  const [prefs] = usePrefs();
  const geo = useGeolocation(!!sos && !sos.drill);
  const followUpSent = useRef(false);

  const trigger = useCallback(
    (trigger: Trigger = "manual", note?: string, drill = false) => {
      if (sos) return;
      const journey = store.journey();
      const token = journey?.shareToken ?? newShareToken();
      const fix = store.lastFix();
      const fresh = fix && Date.now() - fix.at < 10 * 60_000 ? fix : null;
      const name = me?.name ?? store.userName() ?? "Your contact";
      const liveUrl = me ? `${window.location.origin}/t/${token}` : null;
      const message = sosMessage({
        name,
        liveUrl,
        lat: fresh?.lat,
        lng: fresh?.lng,
        accuracyM: fresh?.accuracy,
        vehicle: journey?.vehicle,
        reason: [REASON[trigger], note?.trim()].filter(Boolean).join(": ") || null,
      });
      navigator.vibrate?.(drill ? [80] : [300, 150, 300, 150, 600]);
      const native = nativeSos();
      const smsPossible = !drill && !!native && prefs.autoSms && contacts.length > 0;
      followUpSent.current = !!fresh;
      setSos({
        trigger,
        drill,
        fromNative: false,
        token,
        tripId: journey?.tripId ?? null,
        liveUrl,
        message,
        server: me && !drill ? "pending" : "skipped",
        sms: smsPossible ? "pending" : "unavailable",
        reach: {},
        startedAt: Date.now(),
      });
      if (drill) {
        store.setSosDrillAt(Date.now());
        return;
      }

      // 1. SMS from the phone's own SIM: needs no internet, so it goes first.
      if (smsPossible) {
        void native!
          .getStatus()
          .then((st) => (st.sms === "granted" ? native!.sendSms({ numbers: contacts.map((c) => c.phone), message }) : { results: [] as SmsResult[] }))
          .then(({ results }) => setSos((s) => s && { ...s, sms: results.length ? "done" : "unavailable", reach: smsToReach(s.reach, contacts, results) }))
          .catch(() => setSos((s) => s && { ...s, sms: "unavailable" }));
      }

      // 2. The server alerts every contact's linked phone (app notification, Telegram) and starts the live link.
      if (!me) return;
      api<{ tripId: string; liveUrl: string | null; message: string; reach: { contactId: string; delivered: Channel[]; failed: Channel[] }[] }>("/api/sos", {
        method: "POST",
        json: { shareToken: token, tripId: journey?.tripId, lat: fresh?.lat, lng: fresh?.lng, accuracy: fresh?.accuracy, trigger },
      })
        .then((res) =>
          setSos((s) => {
            if (!s) return s;
            let reach = s.reach;
            for (const r of res.reach ?? []) {
              for (const ch of r.delivered) reach = addReach(reach, r.contactId, ch, true);
              for (const ch of r.failed) reach = addReach(reach, r.contactId, ch, false);
            }
            return { ...s, server: "ok", tripId: res.tripId, liveUrl: res.liveUrl ?? s.liveUrl, message: res.liveUrl ? s.message : res.message, reach };
          }),
        )
        .catch((err: Error) => setSos((s) => s && { ...s, server: "failed", serverError: err.message }));
    },
    [me, sos, contacts, prefs.autoSms],
  );

  const adopt = useCallback(
    (o: NativeSosOutcome) => {
      let reach: Record<string, Reach> = smsToReach({}, contacts, o.sms ?? []);
      for (const r of o.reach ?? []) {
        for (const ch of r.delivered as Channel[]) reach = addReach(reach, r.contactId, ch, true);
        for (const ch of r.failed as Channel[]) reach = addReach(reach, r.contactId, ch, false);
      }
      followUpSent.current = true;
      setSos({
        trigger: "manual",
        drill: false,
        fromNative: true,
        token: o.token,
        tripId: o.tripId || null,
        liveUrl: o.liveUrl ?? null,
        message: sosMessage({ name: me?.name ?? store.userName() ?? "Your contact", liveUrl: o.liveUrl }),
        server: o.server ?? "skipped",
        serverError: o.serverError,
        sms: o.sms ? "done" : "unavailable",
        reach,
        startedAt: o.at,
      });
    },
    [contacts, me],
  );

  // Who has opened the alert: refreshed while the SOS is open.
  useEffect(() => {
    if (!sos?.tripId || sos.server !== "ok") return;
    const load = () =>
      api<{ contacts: { contactId: string; delivered: Channel[]; failed: Channel[]; seenAt: string | null; response: string | null }[] }>(`/api/sos/${sos.tripId}`)
        .then(({ contacts: rows }) =>
          setSos((s) => {
            if (!s) return s;
            const reach = { ...s.reach };
            for (const r of rows) {
              const cur = reach[r.contactId] ?? { delivered: [], failed: [], seenAt: null };
              reach[r.contactId] = {
                delivered: [...new Set([...cur.delivered, ...r.delivered])],
                failed: [...new Set([...cur.failed, ...r.failed])].filter((c) => !r.delivered.includes(c)),
                seenAt: r.seenAt ?? cur.seenAt,
                response: r.response ?? cur.response ?? null,
              };
            }
            return { ...s, reach };
          }),
        )
        .catch(() => {});
    void load();
    const id = setInterval(load, 6000);
    return () => clearInterval(id);
  }, [sos?.tripId, sos?.server]);

  // Keep the live link updated every 10 s, and text the location once if the first SMS went without one.
  const fixRef = useRef(geo.fix);
  fixRef.current = geo.fix;
  const sosRef = useRef(sos);
  sosRef.current = sos;
  const live = !!sos && !sos.drill;
  useEffect(() => {
    if (!live) return;
    const push = async () => {
      const f = fixRef.current;
      const s = sosRef.current;
      if (!f || !s) return;
      if (!followUpSent.current && s.sms === "done") {
        followUpSent.current = true;
        void nativeSos()?.sendSms({ numbers: contacts.map((c) => c.phone), message: `SOS location update: ${mapsLink(f.lat, f.lng)}` });
      }
      if (!s.tripId || s.server !== "ok") return;
      await api(`/api/trips/${s.tripId}/location`, {
        method: "POST",
        json: { lat: f.lat, lng: f.lng, accuracy: f.accuracy, battery: await batteryLevel(), at: f.at },
      }).catch(() => {});
    };
    void push();
    const id = setInterval(push, 10_000);
    return () => clearInterval(id);
  }, [live, sos?.tripId, sos?.server, contacts]);

  const shake = useCallback(() => {
    if (sos || shakeCountdown != null) return;
    navigator.vibrate?.([200, 100, 200]);
    if (prefs.shakeCountdownS <= 0) trigger("manual");
    else setShakeCountdown(prefs.shakeCountdownS);
  }, [sos, shakeCountdown, prefs.shakeCountdownS, trigger]);

  // In the browser the page listens itself; in the Android app the native shake guard reports shakes instead.
  const [nativeGuard, setNativeGuard] = useState(false);
  useEffect(() => {
    void nativeSos()
      ?.getStatus()
      .then((s) => setNativeGuard(s.guardRunning))
      .catch(() => {});
  }, [prefs.shakeSos, prefs.shakeLocked]);
  useShake(prefs.shakeSos && !nativeGuard && !sos && shakeCountdown == null, shake);

  useEffect(() => {
    if (shakeCountdown == null) return;
    if (shakeCountdown <= 0) {
      setShakeCountdown(null);
      trigger("manual");
      return;
    }
    navigator.vibrate?.(60);
    const id = setTimeout(() => setShakeCountdown((n) => (n == null ? null : n - 1)), 1000);
    return () => clearTimeout(id);
  }, [shakeCountdown, trigger]);

  const close = useCallback(
    async (markSafe: boolean) => {
      if (markSafe && sos?.tripId && !sos.drill) {
        await api(`/api/trips/${sos.tripId}`, { method: "PATCH", json: { status: "ended", reason: "Marked safe" } }).catch(() => {});
        if (store.journey()?.tripId === sos.tripId) store.setJourney(null);
      }
      setSos(null);
    },
    [sos?.tripId, sos?.drill],
  );

  return (
    <SosContext.Provider value={{ active: !!sos, trigger: (t, n) => trigger(t, n), drill: () => trigger("manual", undefined, true), shake, adopt }}>
      {children}
      {sos && <SosScreen sos={sos} contacts={contacts} signedIn={!!me} gpsError={geo.error} onClose={close} />}
      {shakeCountdown != null && !sos && <ShakeCountdown seconds={shakeCountdown} total={prefs.shakeCountdownS} onSend={() => setShakeCountdown(0)} onCancel={() => setShakeCountdown(null)} />}
    </SosContext.Provider>
  );
}

function ShakeCountdown({ seconds, total, onSend, onCancel }: { seconds: number; total: number; onSend: () => void; onCancel: () => void }) {
  const C = 2 * Math.PI * 70;
  return (
    <div className="fade-in fixed inset-0 z-[110] flex items-center justify-center bg-gradient-to-b from-[#b3123a] to-[#7a0b28] p-6 text-center text-white" role="alertdialog" aria-modal="true" aria-labelledby="shake-title">
      <div className="w-full max-w-sm">
        <Siren className="mx-auto h-10 w-10" aria-hidden />
        <h2 id="shake-title" className="mt-3 text-2xl font-extrabold">
          Shake detected
        </h2>
        <p className="mt-1 text-white/85">Alerting your trusted contacts in</p>
        <div className="relative mx-auto my-6 h-40 w-40">
          <svg viewBox="0 0 160 160" className="-rotate-90" aria-hidden>
            <circle cx="80" cy="80" r="70" fill="none" stroke="rgb(255 255 255 / 0.2)" strokeWidth="8" />
            <circle cx="80" cy="80" r="70" fill="none" stroke="white" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(seconds / Math.max(1, total)) * C} ${C}`} style={{ transition: "stroke-dasharray 1s linear" }} />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-7xl font-extrabold tabular-nums" aria-live="assertive">
            {seconds}
          </span>
        </div>
        <div className="grid gap-3">
          <button onClick={onSend} className="btn bg-white text-lg text-[#b3123a]">
            <Send className="h-5 w-5" aria-hidden />
            Send SOS now
          </button>
          <button onClick={onCancel} className="btn text-lg text-white ring-2 ring-white/70 ring-inset">
            <X className="h-5 w-5" aria-hidden />
            Cancel, I&apos;m fine
          </button>
        </div>
      </div>
    </div>
  );
}

function SosScreen({
  sos,
  contacts,
  signedIn,
  gpsError,
  onClose,
}: {
  sos: SosState;
  contacts: StoredContact[];
  signedIn: boolean;
  gpsError: string | null;
  onClose: (markSafe: boolean) => void;
}) {
  const [platform, setPlatform] = useState<"ios" | "android" | "other">("other");
  const [siren, setSiren] = useState(false);
  const [confirmSafe, setConfirmSafe] = useState(false);
  const [more, setMore] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => setPlatform(detectPlatform(navigator.userAgent)), []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  useSiren(siren);

  const reached = contacts.filter((c) => (sos.reach[c.id]?.delivered.length ?? 0) > 0);
  const working = sos.server === "pending" || sos.sms === "pending";
  const unreached = contacts.filter((c) => !(sos.reach[c.id]?.delivered.length ?? 0));
  const phones = (unreached.length ? unreached : contacts).map((c) => c.phone);

  const share = async () => {
    try {
      await navigator.share({ title: "SOS", text: sos.message });
    } catch {
      await navigator.clipboard?.writeText(sos.message).catch(() => {});
    }
  };

  let headline: string;
  let sub: string;
  if (sos.drill) {
    headline = "Practice SOS";
    sub = "Nothing was sent. This is exactly what happens when you hold SOS for real.";
  } else if (!contacts.length) {
    headline = "Call for help";
    sub = "You have no trusted contacts yet, so call 112 or share your location below.";
  } else if (working && !reached.length) {
    headline = "Sending SOS…";
    sub = "Alerting your trusted contacts with your live location.";
  } else if (reached.length) {
    headline = reached.length === contacts.length ? "SOS sent to everyone" : `SOS sent to ${reached.length} of ${contacts.length}`;
    sub = sos.liveUrl && sos.server === "ok" ? "They can see your live location. Stay on the line with 112 if you're in danger." : "Your location was included. Call 112 if you're in danger.";
  } else {
    headline = "Couldn't alert contacts automatically";
    sub = "Send the message yourself below, and call 112 if you're in danger.";
  }

  return (
    <div className="fade-in fixed inset-0 z-[100] overflow-y-auto bg-gradient-to-b from-[#b3123a] via-[#93102f] to-[#5c0a1f] text-white" role="alertdialog" aria-modal="true" aria-labelledby="sos-title">
      <div className="pt-safe mx-auto flex min-h-full w-full max-w-lg flex-col gap-4 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {sos.drill && (
          <p className="rounded-full bg-white/15 px-4 py-1.5 text-center text-sm font-bold uppercase tracking-wider">Practice mode · nobody is alerted</p>
        )}
        <div className="flex items-start gap-3 pt-2">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15" aria-hidden>
            {working && !reached.length && !sos.drill ? <LoaderCircle className="h-6 w-6 animate-spin" /> : reached.length ? <Check className="h-7 w-7" strokeWidth={3} /> : <Siren className="h-6 w-6" />}
          </span>
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-white/75">
              {sos.fromNative ? "Sent by the SafeNav app" : sos.trigger === "manual" ? "SOS activated" : "Automatic SOS"}
            </p>
            <h1 id="sos-title" className="text-[1.65rem] font-extrabold leading-tight" aria-live="polite">
              {headline}
            </h1>
            <p className="mt-1 text-[15px] leading-snug text-white/90">{sub}</p>
          </div>
        </div>

        <a href="tel:112" className="btn min-h-16 justify-between bg-white px-5 text-red-700 shadow-lg">
          <span className="flex items-center gap-3 text-xl font-extrabold">
            <Phone className="h-6 w-6" aria-hidden />
            Call 112
          </span>
          <span className="text-sm font-semibold">Police · Fire · Ambulance</span>
        </a>

        <section className="rounded-3xl bg-black/20 p-4" aria-labelledby="reach-title">
          <h2 id="reach-title" className="flex items-center gap-2 font-bold">
            <BellRing className="h-5 w-5" aria-hidden />
            Trusted contacts
          </h2>
          {contacts.length === 0 ? (
            <Link href="/contacts" onClick={() => onClose(false)} className="btn mt-3 w-full bg-white/15 text-white">
              <UserPlus className="h-5 w-5" aria-hidden />
              Add trusted contacts for automatic alerts
            </Link>
          ) : (
            <ul className="mt-2 divide-y divide-white/10">
              {contacts.map((c) => (
                <ContactReachRow key={c.id} contact={c} reach={sos.reach[c.id]} pending={working} drill={sos.drill} now={now} />
              ))}
            </ul>
          )}
          <StatusNote sos={sos} signedIn={signedIn} />
        </section>

        {contacts.length > 0 && !sos.drill && (unreached.length > 0 || platform !== "other") && (
          <section className="grid gap-2">
            <a href={smsUri(phones, sos.message, platform)} className="btn bg-white/95 text-red-800">
              <MessageSquareText className="h-5 w-5" aria-hidden />
              {unreached.length && reached.length ? `Text the ${unreached.length} not reached` : reached.length ? "Also text from my phone" : `Text ${contacts.length > 1 ? "all contacts" : contacts[0].name.split(" ")[0]}`}
            </a>
            <div className="grid grid-cols-2 gap-2">
              {(unreached.length ? unreached : contacts).slice(0, 4).map((c) => (
                <a key={c.id} href={whatsappUri(c.phone, sos.message)} target="_blank" rel="noopener noreferrer" className="btn btn-sm bg-[#128c4b] text-white">
                  WhatsApp {c.name.split(" ")[0]}
                </a>
              ))}
            </div>
          </section>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setSiren((s) => !s)} aria-pressed={siren} className={`btn ${siren ? "bg-amber-300 text-red-950" : "bg-white/10 text-white ring-1 ring-white/40 ring-inset"}`}>
            {siren ? <VolumeX className="h-5 w-5" aria-hidden /> : <Volume2 className="h-5 w-5" aria-hidden />}
            {siren ? "Stop alarm" : "Loud alarm"}
          </button>
          <button onClick={share} className="btn bg-white/10 text-white ring-1 ring-white/40 ring-inset">
            <Share2 className="h-5 w-5" aria-hidden />
            Share
          </button>
        </div>

        <button onClick={() => setMore((m) => !m)} aria-expanded={more} className="flex items-center justify-between rounded-2xl bg-black/15 px-4 py-3 text-left text-sm font-semibold">
          Other helplines and the message sent
          <ChevronDown className={`h-4 w-4 transition-transform ${more ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {more && (
          <div className="fade-in space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {EMERGENCY_NUMBERS.filter((n) => n.number !== "112").map((n) => (
                <a key={n.number} href={`tel:${n.number}`} className="rounded-2xl bg-black/20 px-3 py-2.5">
                  <span className="block text-xl font-extrabold">{n.number}</span>
                  <span className="block text-sm leading-snug text-white/85">{n.label}</span>
                </a>
              ))}
            </div>
            <pre className="whitespace-pre-wrap rounded-2xl bg-black/20 p-3 font-sans text-sm text-white/90">{sos.message}</pre>
            {gpsError && <p className="text-sm text-white/85">{gpsError}</p>}
          </div>
        )}

        <div className="mt-auto pt-2">
          {sos.drill ? (
            <button onClick={() => onClose(false)} className="btn w-full bg-white text-red-800">
              <ShieldCheck className="h-5 w-5" aria-hidden />
              Finish practice
            </button>
          ) : confirmSafe ? (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => onClose(true)} className="btn bg-white text-red-800">
                Yes, I&apos;m safe
              </button>
              <button onClick={() => setConfirmSafe(false)} className="btn text-white ring-1 ring-white/60 ring-inset">
                Keep SOS on
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmSafe(true)} className="btn w-full text-white ring-1 ring-white/50 ring-inset">
              I&apos;m safe now, end SOS
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ContactReachRow({ contact, reach, pending, drill, now }: { contact: StoredContact; reach?: Reach; pending: boolean; drill: boolean; now: number }) {
  const delivered = [...new Set((reach?.delivered ?? []).map((c) => CHANNEL_LABEL[c]))];
  const failed = [...new Set((reach?.failed ?? []).map((c) => CHANNEL_LABEL[c]))].filter((c) => !delivered.includes(c));
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-bold" aria-hidden>
        {initials(contact.name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">
          {contact.name} <span className="font-normal text-white/70">· {contact.relation}</span>
        </p>
        <p className="text-sm text-white/85">
          {drill ? (
            "Would be alerted with your live location"
          ) : reach?.response ? (
            <span className="inline-flex items-center gap-1 font-extrabold text-emerald-200">
              <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
              {reach.response === "on_my_way" ? "On the way to you" : reach.response === "calling" ? "Calling you" : "Called 112 for you"}
            </span>
          ) : reach?.seenAt ? (
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-200">
              <Eye className="h-3.5 w-3.5" aria-hidden />
              Opened your alert {formatAgo(reach.seenAt, now)}
            </span>
          ) : delivered.length ? (
            `Reached by ${delivered.join(" + ")}`
          ) : pending ? (
            "Sending…"
          ) : failed.length ? (
            `${failed.join(", ")} didn't go through`
          ) : (
            "Not reached automatically"
          )}
        </p>
      </div>
      {!drill && (
        <a href={`tel:${contact.phone}`} aria-label={`Call ${contact.name}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15">
          <Phone className="h-5 w-5" aria-hidden />
        </a>
      )}
    </li>
  );
}

function StatusNote({ sos, signedIn }: { sos: SosState; signedIn: boolean }) {
  if (sos.drill) return <p className="mt-2 text-sm text-white/80">Contacts who turned on alerts get a notification instantly; in the Android app, an SMS also goes from your phone.</p>;
  if (!signedIn) return <p className="mt-2 text-sm text-white/85">Not signed in: automatic alerts and live tracking need an account. Text your contacts below.</p>;
  if (sos.server === "failed")
    return (
      <p className="mt-2 flex gap-2 text-sm text-white/90">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Couldn&apos;t reach SafeNav&apos;s server ({sos.serverError}). {sos.sms === "done" ? "Your SMS still went out." : "Text your contacts below."}
      </p>
    );
  return null;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Loud two-tone alarm through Web Audio; works without any audio file. */
export function useSiren(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    gain.gain.value = 0.9;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    let high = false;
    const id = setInterval(() => {
      high = !high;
      osc.frequency.setValueAtTime(high ? 1400 : 900, ctx.currentTime);
    }, 350);
    return () => {
      clearInterval(id);
      osc.stop();
      void ctx.close();
    };
  }, [on]);
}

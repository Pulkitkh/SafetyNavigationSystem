"use client";

import { BellRing, Check, LoaderCircle, MapPin, Phone, Send, ShieldCheck, Smartphone, SquarePlus, TriangleAlert } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Callout, IconTile } from "@/components/ui";

interface Invite {
  userName: string;
  contactName: string;
  vapidPublicKey: string | null;
  telegram: string | null;
  linked: { push: number; telegram: number };
}

type PushState = "unsupported" | "needs-install" | "idle" | "working" | "on" | "denied" | "error";

function keyBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua)) return "Android phone";
  if (/Mac/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  return "Browser";
}

/**
 * Opened by a trusted contact from their invite link. One tap here and every
 * SOS from the inviter reaches this phone instantly, with no action needed from
 * the person in danger.
 */
export default function GuardianInvitePage() {
  const { token } = useParams<{ token: string }>();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [push, setPush] = useState<PushState>("idle");
  const [pushError, setPushError] = useState<string | null>(null);
  const [test, setTest] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  useEffect(() => {
    fetch(`/api/guardian/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "This invite link is not valid");
        setInvite(body);
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);

  useEffect(() => {
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setPush(ios && !standalone ? "needs-install" : "unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setPush("denied");
      return;
    }
    // Already on for this browser?
    void navigator.serviceWorker.getRegistration("/").then(async (reg) => {
      const sub = await reg?.pushManager.getSubscription();
      if (sub && Notification.permission === "granted") setPush("on");
    });
  }, []);

  const turnOn = async () => {
    if (!invite?.vapidPublicKey) return;
    setPush("working");
    setPushError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPush(permission === "denied" ? "denied" : "idle");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(invite.vapidPublicKey) }));
      const res = await fetch(`/api/guardian/${encodeURIComponent(token)}/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON(), label: deviceLabel() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      setPush("on");
    } catch (e) {
      setPush("error");
      setPushError((e as Error).message);
    }
  };

  const sendTest = async () => {
    setTest("sending");
    try {
      const res = await fetch(`/api/guardian/${encodeURIComponent(token)}/test`, { method: "POST" });
      const body = await res.json();
      setTest(res.ok && body.sent > 0 ? "sent" : "failed");
    } catch {
      setTest("failed");
    }
  };

  if (error) {
    return (
      <main id="main" className="pt-safe mx-auto max-w-md px-4 pb-10">
        <div className="card mt-6 p-6 text-center">
          <IconTile icon={TriangleAlert} tone="caution" size="lg" />
          <h1 className="mt-3 text-xl font-extrabold text-ink">Link not valid</h1>
          <p className="mt-1 text-ink-2">{error}</p>
        </div>
      </main>
    );
  }

  if (!invite) {
    return (
      <main id="main" className="flex min-h-dvh items-center justify-center" aria-busy="true">
        <LoaderCircle className="h-8 w-8 animate-spin text-brand-ink" aria-label="Loading" />
      </main>
    );
  }

  const first = invite.userName.split(" ")[0];
  const on = push === "on";

  return (
    <main id="main" className="pt-safe mx-auto max-w-md px-4 pb-10">
      <div className="hero-gradient rise mt-4 rounded-3xl p-6 shadow-card">
        <ShieldCheck className="h-10 w-10" aria-hidden />
        <h1 className="mt-3 text-[1.65rem] font-extrabold leading-tight">
          {invite.contactName.split(" ")[0]}, {first} trusts you
        </h1>
        <p className="mt-2 text-[15px] leading-snug text-white/90">
          {invite.userName} added you as a trusted contact on SafeNav. Turn on alerts so you&apos;re told instantly, with their live location, if they ever
          press SOS.
        </p>
      </div>

      <section className="card rise rise-1 mt-4 p-5" aria-labelledby="push-title">
        <div className="flex items-start gap-3">
          <IconTile icon={on ? Check : BellRing} tone={on ? "good" : "brand"} />
          <div className="min-w-0">
            <h2 id="push-title" className="text-lg font-extrabold text-ink">
              {on ? "Alerts are on for this phone" : "Get alerts on this phone"}
            </h2>
            <p className="mt-0.5 text-sm text-ink-2">
              {on ? `If ${first} presses SOS, this phone shows an alert straight away. Keep notifications for this site allowed.` : "Free, and you don't need an account or another app."}
            </p>
          </div>
        </div>

        {push === "needs-install" ? (
          <div className="mt-4 space-y-2 rounded-2xl bg-surface-2 p-4 text-sm text-ink">
            <p className="font-bold">On iPhone, first add SafeNav to your Home Screen:</p>
            <p className="flex items-center gap-2">
              <span className="font-extrabold">1.</span> In Safari, tap Share, then <b>Add to Home Screen</b> <SquarePlus className="h-4 w-4" aria-hidden />
            </p>
            <p>
              <span className="font-extrabold">2.</span> Open SafeNav from your Home Screen and open this link again.
            </p>
          </div>
        ) : push === "unsupported" ? (
          <Callout tone="caution" icon={Smartphone}>
            This browser can&apos;t show alerts. Open the link in Chrome on Android, or Safari on iPhone{invite.telegram ? ", or use Telegram below" : ""}.
          </Callout>
        ) : push === "denied" ? (
          <div className="mt-4">
            <Callout tone="caution">Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then reload this page.</Callout>
          </div>
        ) : on ? (
          <button onClick={sendTest} disabled={test === "sending"} className="btn btn-outline mt-4 w-full">
            {test === "sent" ? <Check className="h-5 w-5 text-good" aria-hidden /> : <Send className="h-5 w-5" aria-hidden />}
            {test === "sending" ? "Sending…" : test === "sent" ? "Test alert sent" : test === "failed" ? "Test failed, try again" : "Send me a test alert"}
          </button>
        ) : (
          <button onClick={turnOn} disabled={push === "working" || !invite.vapidPublicKey} className="btn btn-primary mt-4 w-full text-base">
            {push === "working" ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : <BellRing className="h-5 w-5" aria-hidden />}
            {push === "working" ? "Turning on…" : "Turn on alerts"}
          </button>
        )}
        {!invite.vapidPublicKey && push !== "on" && <p className="mt-2 text-sm text-caution">App alerts aren&apos;t set up on this server yet.</p>}
        {pushError && <p className="mt-2 text-sm text-danger">Couldn&apos;t turn on alerts: {pushError}</p>}
      </section>

      {invite.telegram && (
        <section className="card rise rise-2 mt-4 p-5" aria-labelledby="tg-title">
          <h2 id="tg-title" className="font-extrabold text-ink">
            Prefer Telegram?
          </h2>
          <p className="mt-0.5 text-sm text-ink-2">Get the alert as a Telegram message with a map pin. Tap below, then Start.</p>
          <a href={invite.telegram} target="_blank" rel="noopener noreferrer" className="btn mt-3 w-full bg-[#229ED9] text-white">
            <Send className="h-5 w-5" aria-hidden />
            {invite.linked.telegram ? "Open Telegram (already linked)" : "Get alerts on Telegram"}
          </a>
        </section>
      )}

      <section className="rise rise-3 mt-6 space-y-3 px-1 text-sm text-ink-2" aria-label="What happens in an SOS">
        <p className="eyebrow">If an SOS comes in</p>
        <p className="flex gap-3">
          <MapPin className="h-5 w-5 shrink-0 text-brand-ink" aria-hidden />
          Tap the alert to see where {first} is, live on a map.
        </p>
        <p className="flex gap-3">
          <Phone className="h-5 w-5 shrink-0 text-brand-ink" aria-hidden />
          Call them. If they don&apos;t answer, call 112 and tell them the location.
        </p>
      </section>
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";
import { usePrefs, useSession } from "./hooks";
import { isAndroidApp, nativeSos } from "./native";
import { store } from "./store";

export interface ReadinessItem {
  id: "account" | "contacts" | "alerts" | "location" | "shake" | "sms" | "drill";
  title: string;
  text: string;
  done: boolean;
  href: string;
}

/**
 * The few things that make SOS work well, as a checklist. Shown on the home
 * and Safety screens so people finish setting up before they need it.
 */
export function useReadiness(): { items: ReadinessItem[]; done: number; next: ReadinessItem | null; ready: boolean } {
  const { me, contacts, loading } = useSession();
  const [prefs] = usePrefs();
  const [location, setLocation] = useState<boolean>(false);
  const [sms, setSms] = useState<boolean | null>(null);
  const [drill, setDrill] = useState(false);

  useEffect(() => {
    setDrill(!!store.sosDrillAt());
    if (store.lastFix()) setLocation(true);
    navigator.permissions
      ?.query({ name: "geolocation" as PermissionName })
      .then((p) => {
        setLocation(p.state === "granted");
        p.onchange = () => setLocation(p.state === "granted");
      })
      .catch(() => {});
    const native = nativeSos();
    if (native) {
      void native
        .getStatus()
        .then((s) => setSms(s.canSendSms ? s.sms === "granted" : null))
        .catch(() => {});
    }
  }, []);

  const linked = contacts.some((c) => (c.alerts?.push ?? 0) + (c.alerts?.telegram ?? 0) + (c.alerts?.whatsapp ?? 0) > 0);
  const items: ReadinessItem[] = [
    { id: "account", title: "Create your account", text: "Needed for live tracking and automatic alerts", done: !!me, href: "/register?next=/safety" },
    { id: "contacts", title: "Add trusted contacts", text: "Up to 5 people who get your SOS", done: contacts.length > 0, href: "/contacts" },
    { id: "alerts", title: "Turn on instant alerts", text: "Send each contact their invite link once", done: linked, href: "/contacts" },
    { id: "location", title: "Allow location", text: "So alerts and routes know where you are", done: location, href: "/safety#settings" },
    { id: "shake", title: "Turn on shake to SOS", text: "Shake hard to alert, no screen needed", done: prefs.shakeSos, href: "/safety#settings" },
  ];
  if (isAndroidApp() && sms !== null) {
    items.push({ id: "sms", title: "Allow automatic SMS", text: "SOS texts contacts with no tap, even offline", done: sms, href: "/safety#settings" });
  }
  items.push({ id: "drill", title: "Practise an SOS", text: "See what happens, without alerting anyone", done: drill, href: "/safety#drill" });

  const done = items.filter((i) => i.done).length;
  const next = loading ? null : (items.find((i) => !i.done) ?? null);
  return { items, done, next, ready: !next };
}

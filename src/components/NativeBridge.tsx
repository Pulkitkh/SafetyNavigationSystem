"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useSos } from "@/components/Sos";
import { usePrefs, useSession } from "@/lib/client/hooks";
import { api } from "@/lib/client/api";
// Registers Chrome's install-app event listener on every page, before any page asks for it.
import "@/lib/client/install";
import { nativeSos, registerAppDevice, sendToken } from "@/lib/client/native";
import { syncWebPush } from "@/lib/client/push";
import { store } from "@/lib/client/store";

/**
 * Inside the Android app, keeps the native SOS in step with the web app: who to
 * text, the user's name, the server, and the shake settings. The native side
 * keeps a copy so SOS works with the app closed or offline.
 */
export function NativeBridge() {
  const { me, contacts } = useSession();
  const [prefs] = usePrefs();
  const path = usePathname();
  const { shake, adopt } = useSos();
  const handlers = useRef({ shake, adopt });
  handlers.current = { shake, adopt };

  useEffect(() => {
    const native = nativeSos();
    if (!native) return;
    void native
      .configure({
        name: me?.name ?? store.userName() ?? "",
        baseUrl: window.location.origin,
        signedIn: !!me,
        contacts: contacts.map((c) => ({ name: c.name, phone: c.phone })),
        countdownS: prefs.shakeCountdownS,
        autoSms: prefs.autoSms,
        tripId: store.journey()?.tripId ?? "",
        shareLive: !!me?.shareLive,
      })
      .catch(() => {});
  }, [me, contacts, prefs.shakeCountdownS, prefs.autoSms, path]);

  // Signed in: this phone rings for SOS from anyone who added this account.
  useEffect(() => {
    if (!me || !nativeSos()) return;
    void api<{ fcm: { apiKey: string; appId: string; projectId: string; senderId: string } | null }>("/api/app/config")
      .then(({ fcm }) => (fcm ? registerAppDevice(fcm) : undefined))
      .catch(() => {});
    const sub = nativeSos()!.addListener("pushToken", ({ token }) => void sendToken(token));
    return () => {
      void sub.then((h) => h.remove());
    };
  }, [me]);

  // In a browser or the installed web app, notifications this browser allowed go to whoever is signed in now.
  const meId = me?.id;
  useEffect(() => {
    if (meId && !nativeSos()) void syncWebPush();
  }, [meId]);

  useEffect(() => {
    void nativeSos()
      ?.setShakeGuard({ enabled: prefs.shakeSos && prefs.shakeLocked })
      .catch(() => {});
  }, [prefs.shakeSos, prefs.shakeLocked]);

  useEffect(() => {
    const native = nativeSos();
    if (!native) return;
    const subs = [native.addListener("shake", () => handlers.current.shake()), native.addListener("nativeSos", (o) => handlers.current.adopt(o))];
    // An SOS sent while the app was closed: show it now and keep sharing location.
    void native
      .takePendingSos()
      .then(({ sos }) => {
        if (sos && Date.now() - sos.at < 3 * 3600_000) handlers.current.adopt(sos);
      })
      .catch(() => {});
    return () => {
      for (const s of subs) void s.then((h) => h.remove());
    };
  }, []);

  return null;
}

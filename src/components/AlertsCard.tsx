"use client";

import { BellOff, BellRing, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Callout, IconTile } from "@/components/ui";
import { useSession } from "@/lib/client/hooks";
import { isNativeApp } from "@/lib/client/native";
import { useWebPush } from "@/lib/client/push";

/**
 * Turns on alerts that arrive with SafeNav closed or the phone locked, in a
 * browser or the installed web app: SOS from people you protect, and "Are you
 * OK?" from SafeNav when your own journey or safety timer needs an answer.
 * The Android app does this by itself, so the card isn't shown there.
 */
export function AlertsCard({ compact = false }: { compact?: boolean }) {
  const { me } = useSession();
  const { state, error, enable } = useWebPush();
  const [native, setNative] = useState(false);
  useEffect(() => setNative(isNativeApp()), []);
  if (!me || native) return null;
  if (compact && state === "on") return null;

  const on = state === "on";
  return (
    <section className={`card p-4 ${on ? "" : "ring-2 ring-caution"}`} aria-labelledby="alerts-card-title">
      <div className="flex items-start gap-3">
        <IconTile icon={on ? BellRing : BellOff} tone={on ? "good" : "caution"} />
        <div className="min-w-0 flex-1">
          <h2 id="alerts-card-title" className="font-bold leading-snug text-ink">
            {on ? "Alerts on this phone are on" : "Get alerts with SafeNav closed"}
          </h2>
          <p className="mt-0.5 text-sm leading-snug text-ink-2">
            {on
              ? "SOS from people you protect, and SafeNav asking if you're OK, reach this phone even when the app is closed or the screen is off."
              : "Without this, you only see an SOS from people you protect, or SafeNav asking if you're OK, while the app is open on screen."}
          </p>
        </div>
      </div>
      {state === "off" || state === "working" || state === "error" ? (
        <button onClick={() => void enable()} disabled={state === "working"} className="btn btn-primary mt-3 w-full">
          {state === "working" ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : <BellRing className="h-5 w-5" aria-hidden />}
          {state === "working" ? "Turning on…" : "Turn on alerts"}
        </button>
      ) : null}
      {state === "denied" && (
        <div className="mt-3">
          <Callout tone="caution">
            Notifications are blocked for SafeNav. Open your browser&apos;s site settings for this page (the icon left of the address), allow Notifications, then
            come back here.
          </Callout>
        </div>
      )}
      {state === "needs-install" && (
        <div className="mt-3">
          <Callout tone="info">On iPhone, first add SafeNav to your Home Screen (Share, then Add to Home Screen) and open it from there.</Callout>
        </div>
      )}
      {state === "unsupported" && (
        <div className="mt-3">
          <Callout tone="caution">This browser can&apos;t show alerts with SafeNav closed. Use Chrome, or install the SafeNav app.</Callout>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Callout tone="danger">{error}</Callout>
        </div>
      )}
    </section>
  );
}

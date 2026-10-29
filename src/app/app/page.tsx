"use client";

import { Apple, Check, ChevronDown, Download, EllipsisVertical, MessageSquareText, MonitorDown, Radio, Share, ShieldCheck, Smartphone, SquarePlus, Vibrate } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/Nav";
import { Callout, IconTile } from "@/components/ui";
import { useInstall } from "@/lib/client/install";
import { isNativeApp } from "@/lib/client/native";
import { detectPlatform } from "@/lib/sos";

const APK_URL = process.env.NEXT_PUBLIC_ANDROID_APK_URL || "https://github.com/Pulkitkh/SafetyNavigationSystem/releases/latest/download/SafeNav.apk";

const WEB_APP_FEATURES = [
  "Hold SOS to alert contacts instantly, with your live location",
  "Safest routes, live journeys and the safety timer",
  "People I protect, with a full-screen alarm while SafeNav is open",
  "Opens from your home screen like any app, no APK and no Play Store",
];

/** What usually stops an APK installing, and the fix. */
const APK_FIXES = [
  { title: "\"For your security, your phone isn't allowed to install unknown apps\"", fix: "Tap Settings on that message and switch on Allow from this source for Chrome (or Files), then go back and tap Install." },
  { title: "Play Protect: \"Unsafe app blocked\" or \"Unknown app\"", fix: "Tap More details, then Install anyway. Google flags any app outside the Play Store that can send SMS; SafeNav only texts your own trusted contacts." },
  { title: "Samsung: \"Blocked by Auto Blocker\"", fix: "Settings → Security and privacy → Auto Blocker → turn it off while installing, then turn it back on." },
  { title: "Xiaomi, Redmi, POCO: the install is refused", fix: "Settings → Additional settings → Privacy → Install via unknown sources, allow Chrome. If asked for a 10-second warning, wait and tap Accept." },
  { title: "\"App not installed\"", fix: "Uninstall any older SafeNav first, make sure you have 50 MB free, and download the APK again (a half-finished download fails like this)." },
  { title: "Work or school phone", fix: "Phones managed by an employer often block all APKs. Use Install from Chrome above instead." },
];

const APP_FEATURES = [
  { icon: MessageSquareText, title: "SOS texts contacts automatically", text: "From your own SIM, with your location. No tap, no internet needed." },
  { icon: Vibrate, title: "Shake to SOS with the screen locked", text: "Phone in your pocket or bag? Shake hard to alert your contacts." },
  { icon: Radio, title: "Tracking that survives a locked screen", text: "Your contacts keep seeing you move during a journey." },
  { icon: Smartphone, title: "SOS from the home screen", text: "Long-press the SafeNav icon and tap Send SOS." },
];

export default function GetAppPage() {
  const [platform, setPlatform] = useState<"ios" | "android" | "other">("other");
  const { installed, canPrompt, install } = useInstall();
  const [native, setNative] = useState(false);
  const [fixesOpen, setFixesOpen] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform(navigator.userAgent));
    setNative(isNativeApp());
  }, []);

  if (native) {
    return (
      <main id="main" className="mx-auto max-w-lg pb-nav">
        <PageHeader title="You're using the app" back="/safety" />
        <div className="px-4">
          <Callout tone="good" icon={Check}>
            SafeNav for Android is installed. Turn on automatic SMS and shake to SOS in Safety → Settings.
          </Callout>
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="mx-auto max-w-lg pb-nav">
      <PageHeader title="Get the SafeNav app" subtitle="Free. The same account and contacts as the website." back="/safety" />
      <div className="space-y-5 px-4">
        {platform !== "ios" && (
          <section className="card overflow-hidden" aria-labelledby="web-title">
            <div className="hero-gradient p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-white/80">Easiest · recommended</p>
              <h2 id="web-title" className="mt-1 flex items-center gap-2 text-xl font-extrabold">
                <MonitorDown className="h-6 w-6" aria-hidden />
                Install from Chrome
              </h2>
              <p className="mt-1 text-sm text-white/85">No APK, no Play Store, nothing your phone can block. Takes 5 seconds.</p>
              {installed ? (
                <p className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-white/15 py-3 font-bold">
                  <Check className="h-5 w-5" aria-hidden />
                  Installed. Open SafeNav from your home screen.
                </p>
              ) : canPrompt ? (
                <button onClick={() => void install()} className="btn mt-4 w-full bg-white text-base text-[#3a2aa8]">
                  <Download className="h-5 w-5" aria-hidden />
                  Install SafeNav
                </button>
              ) : (
                <ol className="mt-4 space-y-2 rounded-2xl bg-white/15 p-4 text-sm">
                  <li className="flex items-center gap-2">
                    <b>1.</b> Open this page in <b>Chrome</b> and tap <EllipsisVertical className="h-4 w-4" aria-label="the menu" />
                  </li>
                  <li>
                    <b>2.</b> Tap <b>Add to Home screen</b>, then <b>Install</b>
                  </li>
                </ol>
              )}
            </div>
            <ul className="space-y-2 px-4 py-3 text-sm text-ink">
              {WEB_APP_FEATURES.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-good" strokeWidth={3} aria-hidden />
                  {f}
                </li>
              ))}
            </ul>
            <p className="border-t border-line bg-surface-2 px-4 py-3 text-[13px] text-ink-2">
              Not included: SMS straight from your SIM, shake with the screen locked, tracking with the screen off and ringing when SafeNav is closed. Those
              need the full app below.
            </p>
          </section>
        )}

        {platform !== "ios" && (
          <section className="card overflow-hidden" aria-labelledby="android-title">
            <div className="p-5">
              <h2 id="android-title" className="flex items-center gap-2 text-lg font-extrabold text-ink">
                <Smartphone className="h-5 w-5" aria-hidden />
                Full Android app
              </h2>
              <p className="mt-1 text-sm text-ink-2">Adds what a browser can&apos;t do in an emergency. Installed from a file, so your phone may ask you to allow it.</p>
              <a href={APK_URL} className="btn btn-outline mt-4 w-full">
                <Download className="h-5 w-5" aria-hidden />
                Download SafeNav.apk
              </a>
              <p className="mt-2 text-center text-xs text-ink-3">About 4 MB · Android 6 or newer</p>
            </div>
            <ul className="divide-y divide-line">
              {APP_FEATURES.map((f) => (
                <li key={f.title} className="flex gap-3 px-4 py-3">
                  <IconTile icon={f.icon} tone="brand" size="sm" />
                  <div>
                    <p className="font-bold text-ink">{f.title}</p>
                    <p className="text-sm text-ink-2">{f.text}</p>
                  </div>
                </li>
              ))}
            </ul>
            <button
              onClick={() => setFixesOpen((v) => !v)}
              aria-expanded={fixesOpen}
              className="tap flex min-h-12 w-full items-center justify-between border-t border-line px-4 text-left text-sm font-bold text-ink"
            >
              <span className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-caution" aria-hidden />
                Phone won&apos;t install it? Fixes
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform ${fixesOpen ? "rotate-180" : ""}`} aria-hidden />
            </button>
            {fixesOpen && (
              <ul className="fade-in divide-y divide-line border-t border-line">
                {APK_FIXES.map((f) => (
                  <li key={f.title} className="px-4 py-3 text-sm">
                    <p className="font-bold text-ink">{f.title}</p>
                    <p className="mt-0.5 text-ink-2">{f.fix}</p>
                  </li>
                ))}
              </ul>
            )}
            <ol className="space-y-1.5 border-t border-line bg-surface-2 px-4 py-3 text-sm text-ink-2">
              <li>
                <b className="text-ink">1.</b> Tap Download, then open <b className="text-ink">SafeNav.apk</b>.
              </li>
              <li>
                <b className="text-ink">2.</b> If asked, allow your browser to install apps, then tap Install.
              </li>
              <li>
                <b className="text-ink">3.</b> Open SafeNav, sign in, and allow location, SMS and notifications.
              </li>
            </ol>
          </section>
        )}

        <section className="card p-4" aria-labelledby="ios-title">
          <h2 id="ios-title" className="flex items-center gap-2 text-lg font-extrabold text-ink">
            <Apple className="h-5 w-5" aria-hidden />
            iPhone
          </h2>
          <p className="mt-1 text-sm text-ink-2">Add SafeNav to your Home Screen. It opens full screen like an app.</p>
          <ol className="mt-3 space-y-2 text-sm text-ink">
            <li className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-extrabold text-brand-soft-ink">1</span>
              Open this page in Safari and tap <Share className="h-4 w-4 text-info" aria-label="Share" />
            </li>
            <li className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-extrabold text-brand-soft-ink">2</span>
              Choose <b>Add to Home Screen</b> <SquarePlus className="h-4 w-4 text-ink-2" aria-hidden />
            </li>
          </ol>
          <p className="mt-3 text-[13px] text-ink-3">
            iPhones don&apos;t let apps send SMS by themselves, so on iPhone your contacts are alerted through SafeNav notifications or Telegram, plus an SMS you
            send with one tap.
          </p>
        </section>
      </div>
    </main>
  );
}

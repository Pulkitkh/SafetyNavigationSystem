"use client";

import { Apple, Check, Download, MessageSquareText, MonitorDown, Radio, Share, Smartphone, SquarePlus, Vibrate } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/Nav";
import { Callout, IconTile } from "@/components/ui";
import { isNativeApp } from "@/lib/client/native";
import { detectPlatform } from "@/lib/sos";

const APK_URL = process.env.NEXT_PUBLIC_ANDROID_APK_URL || "https://github.com/Pulkitkh/SafetyNavigationSystem/releases/latest/download/SafeNav.apk";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const APP_FEATURES = [
  { icon: MessageSquareText, title: "SOS texts contacts automatically", text: "From your own SIM, with your location. No tap, no internet needed." },
  { icon: Vibrate, title: "Shake to SOS with the screen locked", text: "Phone in your pocket or bag? Shake hard to alert your contacts." },
  { icon: Radio, title: "Tracking that survives a locked screen", text: "Your contacts keep seeing you move during a journey." },
  { icon: Smartphone, title: "SOS from the home screen", text: "Long-press the SafeNav icon and tap Send SOS." },
];

export default function GetAppPage() {
  const [platform, setPlatform] = useState<"ios" | "android" | "other">("other");
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [native, setNative] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform(navigator.userAgent));
    setNative(isNativeApp());
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
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
          <section className="card overflow-hidden" aria-labelledby="android-title">
            <div className="hero-gradient p-5">
              <h2 id="android-title" className="flex items-center gap-2 text-xl font-extrabold">
                <Smartphone className="h-6 w-6" aria-hidden />
                Android
              </h2>
              <p className="mt-1 text-sm text-white/85">The app adds what a browser can&apos;t do in an emergency.</p>
              <a href={APK_URL} className="btn mt-4 w-full bg-white text-base text-[#3a2aa8]">
                <Download className="h-5 w-5" aria-hidden />
                Download for Android
              </a>
              <p className="mt-2 text-center text-xs text-white/75">APK, about 4 MB · Android 6 or newer</p>
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

        {platform !== "ios" && !installed && (
          <section className="card p-4" aria-labelledby="web-title">
            <h2 id="web-title" className="flex items-center gap-2 text-lg font-extrabold text-ink">
              <MonitorDown className="h-5 w-5" aria-hidden />
              Install the web app
            </h2>
            <p className="mt-1 text-sm text-ink-2">A lighter option for computers and phones: no download from outside the browser.</p>
            {prompt ? (
              <button
                onClick={async () => {
                  await prompt.prompt();
                  const { outcome } = await prompt.userChoice;
                  if (outcome === "accepted") setInstalled(true);
                  setPrompt(null);
                }}
                className="btn btn-secondary mt-3 w-full"
              >
                Install SafeNav
              </button>
            ) : (
              <p className="mt-3 text-sm text-ink-2">Use your browser menu → Install app (or Add to Home screen).</p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

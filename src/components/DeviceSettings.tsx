"use client";

import { Accessibility, Palette, LocateFixed, MessageSquareText, MonitorSmartphone, Moon, Radio, Smartphone, Sun, Vibrate, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Callout, Segmented, Toggle } from "@/components/ui";
import { usePrefs } from "@/lib/client/hooks";
import { isAndroidApp, nativeSos, type NativeStatus } from "@/lib/client/native";
import { requestMotionPermission } from "@/lib/client/shake";
import { store, type Theme } from "@/lib/client/store";
import { voiceSupported } from "@/lib/client/voice";

/** Safety settings stored on this phone; they work without an account. */
export function DeviceSettings() {
  const [prefs, setPrefs] = usePrefs();
  const [motion, setMotion] = useState(true);
  const [voice, setVoice] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>("system");
  const [native, setNative] = useState<NativeStatus | null>(null);
  const [location, setLocation] = useState<PermissionState | "unknown">("unknown");
  const android = isAndroidApp();

  useEffect(() => {
    setMotion("DeviceMotionEvent" in window);
    setVoice(voiceSupported());
    setTheme(store.theme());
    void nativeSos()
      ?.getStatus()
      .then(setNative)
      .catch(() => {});
    navigator.permissions
      ?.query({ name: "geolocation" as PermissionName })
      .then((p) => {
        setLocation(p.state);
        p.onchange = () => setLocation(p.state);
      })
      .catch(() => {});
  }, []);

  const toggleShake = async (on: boolean) => {
    setNote(null);
    if (on && !(await requestMotionPermission())) {
      setNote("Motion access was refused. Allow it in your browser settings to use shake to SOS.");
      return;
    }
    if (on && android) {
      // The locked-screen countdown is a notification, which Android 13+ asks permission for.
      const s = await nativeSos()?.requestNotificationPermission().catch(() => null);
      if (s) setNative(s);
    }
    setPrefs({ shakeSos: on });
  };

  const toggleSms = async (on: boolean) => {
    setNote(null);
    const plugin = nativeSos();
    if (!plugin) return;
    if (on && native?.sms !== "granted") {
      const s = await plugin.requestSmsPermission().catch(() => null);
      if (s) setNative(s);
      if (s?.sms !== "granted") {
        setNote("SMS permission was refused. Allow SMS for SafeNav in Android Settings → Apps → SafeNav → Permissions.");
        return;
      }
    }
    setPrefs({ autoSms: on });
  };

  const askLocation = () => {
    navigator.geolocation?.getCurrentPosition(
      () => setLocation("granted"),
      () => {
        setLocation("denied");
        setNote("Location is blocked. Allow it for this site (or the SafeNav app) in your phone's settings.");
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  const smsOn = prefs.autoSms && native?.sms === "granted";

  return (
    <section id="settings" className="scroll-mt-4 space-y-3" aria-labelledby="settings-title">
      <h2 id="settings-title" className="px-1 text-base font-extrabold text-ink">
        Settings on this phone
      </h2>

      <div className="card divide-y divide-line overflow-hidden">
        <Toggle
          icon={Vibrate}
          tone="sos"
          label="Shake to SOS"
          description={
            motion
              ? android
                ? "Shake hard 4 times to alert your contacts, even with the screen locked."
                : "Shake hard 4 times to alert your contacts while SafeNav is open."
              : "This device has no motion sensor."
          }
          checked={prefs.shakeSos}
          onChange={(v) => void toggleShake(v)}
          disabled={!motion}
        />
        {prefs.shakeSos && (
          <div className="space-y-2 px-4 py-3">
            <p className="text-sm font-bold text-ink">Time to cancel before it sends</p>
            <Segmented
              label="Shake countdown"
              value={prefs.shakeCountdownS}
              onChange={(v) => setPrefs({ shakeCountdownS: v })}
              options={[
                { value: 0, label: "Instant" },
                { value: 3, label: "3 s" },
                { value: 5, label: "5 s" },
                { value: 10, label: "10 s" },
              ]}
            />
            <p className="text-[13px] text-ink-2">A short countdown stops accidental alerts, e.g. when running for a bus.</p>
          </div>
        )}
        {prefs.shakeSos && android && (
          <Toggle
            icon={Smartphone}
            tone="neutral"
            label="Works with screen locked"
            description="Keeps listening in the background with a small notification. Uses a little battery."
            checked={prefs.shakeLocked}
            onChange={(v) => setPrefs({ shakeLocked: v })}
          />
        )}
        {android && native?.canSendSms && (
          <Toggle
            icon={MessageSquareText}
            tone="good"
            label="Text contacts automatically"
            description={
              smsOn ? "SOS sends an SMS from your SIM at once, with your location. Works without internet." : "Allow SMS so SOS can text your contacts with no tap needed."
            }
            checked={smsOn}
            onChange={(v) => void toggleSms(v)}
          />
        )}
        <Toggle
          icon={Radio}
          tone="good"
          label="Tell contacts when I set off"
          description="Contacts with alerts on get your live link when a journey starts."
          checked={prefs.notifyOnStart}
          onChange={(v) => setPrefs({ notifyOnStart: v })}
        />
        <div className="flex min-h-16 items-center gap-3 px-4 py-3">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${location === "granted" ? "bg-good-soft text-good" : "bg-caution-soft text-caution"}`} aria-hidden>
            <LocateFixed className="h-[22px] w-[22px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-ink">Location</p>
            <p className="text-sm text-ink-2">{location === "granted" ? "Allowed. Alerts include where you are." : location === "denied" ? "Blocked in settings." : "Needed for routes and SOS."}</p>
          </div>
          {location !== "granted" && (
            <button onClick={askLocation} className="btn btn-secondary btn-sm">
              Allow
            </button>
          )}
        </div>
      </div>

      <div className="card divide-y divide-line overflow-hidden">
        <Toggle
          icon={Volume2}
          tone="info"
          label="Voice directions"
          description={voice ? "Spoken turns during a journey, so your phone can stay in your bag." : "Not supported here."}
          checked={prefs.voice}
          onChange={(v) => setPrefs({ voice: v })}
          disabled={!voice}
        />
        <Toggle
          icon={Accessibility}
          tone="brand"
          label="Step-free routes"
          description="Avoid steps and rough surfaces: for wheelchairs, walkers, strollers and older people."
          checked={prefs.stepFree}
          onChange={(v) => setPrefs({ stepFree: v })}
        />
        <div className="space-y-2 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-bold text-ink">
            <Palette className="h-4 w-4 text-ink-3" aria-hidden />
            Appearance
          </p>
          <Segmented
            label="Theme"
            value={theme}
            onChange={(t) => {
              setTheme(t);
              store.setTheme(t);
            }}
            options={[
              { value: "system", label: "Auto", icon: MonitorSmartphone },
              { value: "light", label: "Light", icon: Sun },
              { value: "dark", label: "Dark", icon: Moon },
            ]}
          />
          <p className="text-[13px] text-ink-2">Dark is easier on the eyes at night and less noticeable on a dark street.</p>
        </div>
      </div>

      {note && <Callout tone="caution">{note}</Callout>}
    </section>
  );
}

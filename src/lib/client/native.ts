"use client";

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { BackgroundGeolocationPlugin } from "@capacitor-community/background-geolocation";
import type { LastFix } from "./store";

/** True inside the Android/iOS app shell, false in a browser or installed PWA. */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function isAndroidApp(): boolean {
  try {
    return Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

let plugin: BackgroundGeolocationPlugin | null = null;
function backgroundGeolocation() {
  plugin ??= registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");
  return plugin;
}

/**
 * GPS that keeps running with the screen locked (Android shows a persistent
 * notification while it does). Returns a function that stops the watcher.
 */
export function watchBackgroundPosition(onFix: (fix: LastFix) => void, onError: (code: string | undefined) => void): () => void {
  let id: string | null = null;
  let stopped = false;
  void backgroundGeolocation()
    .addWatcher(
      {
        backgroundTitle: "SafeNav is protecting your journey",
        backgroundMessage: "Your trusted contacts can see your live location until you end the journey.",
        requestPermissions: true,
        stale: false,
        distanceFilter: 5,
      },
      (location, error) => {
        if (error) return onError(error.code);
        if (location) onFix({ lat: location.latitude, lng: location.longitude, accuracy: location.accuracy, at: location.time ?? Date.now() });
      },
    )
    .then((watcherId) => {
      if (stopped) void backgroundGeolocation().removeWatcher({ id: watcherId });
      else id = watcherId;
    })
    .catch(() => onError("UNAVAILABLE"));
  return () => {
    stopped = true;
    if (id) void backgroundGeolocation().removeWatcher({ id });
  };
}

export function openAppSettings() {
  void backgroundGeolocation().openSettings().catch(() => {});
}

// ------------------------------------------------------------ SOS (Android)

export type PermissionState = "granted" | "denied" | "prompt" | "prompt-with-rationale";

export interface NativeStatus {
  canSendSms: boolean;
  sms: PermissionState;
  notifications: PermissionState;
  guardEnabled: boolean;
  guardRunning: boolean;
  autoSms: boolean;
}

export interface SmsResult {
  to: string;
  ok: boolean;
  error?: string;
}

/** An SOS the Android app sent by itself (shake with screen locked, or the home-screen shortcut). */
export interface NativeSosOutcome {
  token: string;
  trigger: "shake" | "shortcut";
  at: number;
  liveUrl?: string;
  sms?: SmsResult[];
  server?: "ok" | "failed";
  serverError?: string;
  tripId?: string;
  reach?: { contactId: string; delivered: string[]; failed: string[] }[];
}

interface SafeNavNativePlugin {
  getStatus(): Promise<NativeStatus>;
  requestSmsPermission(): Promise<NativeStatus>;
  requestNotificationPermission(): Promise<NativeStatus>;
  sendSms(o: { numbers: string[]; message: string }): Promise<{ results: SmsResult[] }>;
  configure(o: {
    name?: string;
    baseUrl?: string;
    signedIn?: boolean;
    contacts?: { name: string; phone: string }[];
    countdownS?: number;
    autoSms?: boolean;
    tripId?: string;
    /** Always-on sharing: the native service reports location with the app closed. */
    shareLive?: boolean;
  }): Promise<NativeStatus>;
  setShakeGuard(o: { enabled: boolean }): Promise<NativeStatus>;
  takePendingSos(): Promise<{ sos: NativeSosOutcome | null }>;
  /** Starts Firebase so SOS alarms from people you protect ring this phone. */
  initPush(o: { apiKey: string; appId: string; projectId: string; senderId: string }): Promise<{ token: string }>;
  stopAlarm(): Promise<void>;
  addListener(event: "pushToken", cb: (o: { token: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: "shake", cb: () => void): Promise<PluginListenerHandle>;
  addListener(event: "nativeSos", cb: (o: NativeSosOutcome) => void): Promise<PluginListenerHandle>;
}

let sosPlugin: SafeNavNativePlugin | null = null;

/** The SOS plugin in the Android app; null in browsers, on iOS, or in an older app build without it. */
export function nativeSos(): SafeNavNativePlugin | null {
  if (!isAndroidApp()) return null;
  try {
    if (!Capacitor.isPluginAvailable("SafeNavNative")) return null;
  } catch {
    return null;
  }
  sosPlugin ??= registerPlugin<SafeNavNativePlugin>("SafeNavNative");
  return sosPlugin;
}

const PUSH_TOKEN_KEY = "safenav.pushToken";

/** Registers this phone with the server so SOS alarms from people the user protects ring it. */
export async function registerAppDevice(fcm: { apiKey: string; appId: string; projectId: string; senderId: string }) {
  const native = nativeSos();
  if (!native) return;
  const { token } = await native.initPush(fcm);
  await sendToken(token);
}

export async function sendToken(token: string) {
  const res = await fetch("/api/app/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, platform: "android" }) });
  if (res.ok) {
    try {
      localStorage.setItem(PUSH_TOKEN_KEY, token);
    } catch {
      // not critical
    }
  }
}

/** On sign-out: this phone stops ringing for that account. */
export async function unregisterAppDevice() {
  let token: string | null = null;
  try {
    token = localStorage.getItem(PUSH_TOKEN_KEY);
    localStorage.removeItem(PUSH_TOKEN_KEY);
  } catch {
    return;
  }
  if (token) await fetch("/api/app/devices", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => {});
}

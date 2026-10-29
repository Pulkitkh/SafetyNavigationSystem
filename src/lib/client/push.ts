"use client";

import { useCallback, useEffect, useState } from "react";
import { isNativeApp } from "./native";

/**
 * Alerts for this account in a browser or the installed web app, delivered by
 * Web Push even with SafeNav closed: SOS from people you protect, and the
 * server's "Are you OK?" when your own journey or safety timer needs an answer.
 * (The Android app uses Firebase instead; see native.ts.)
 */

export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on" | "working" | "error";

const WEB_PUSH_KEY = "safenav.webPush";

export function keyBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function supported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function initialState(): PushState {
  if (!supported()) {
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    return ios && !standalone ? "needs-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  return "off";
}

async function register(sub: PushSubscription) {
  const json = sub.toJSON();
  const res = await fetch("/api/app/devices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform: "web", token: json.endpoint, keys: json.keys }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  try {
    localStorage.setItem(WEB_PUSH_KEY, json.endpoint ?? "");
  } catch {
    // not critical
  }
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Asks for permission and links this browser to the signed-in account. */
export async function enableWebPush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const { vapidPublicKey } = (await (await fetch("/api/app/config")).json()) as { vapidPublicKey: string | null };
  if (!vapidPublicKey) throw new Error("Notifications aren't set up on this server yet");
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey) }));
  await register(sub);
  return "on";
}

/** On each visit while signed in: keeps this browser linked to the account that is signed in now. */
export async function syncWebPush() {
  if (!supported() || isNativeApp() || Notification.permission !== "granted") return;
  const sub = await currentSubscription();
  if (sub) await register(sub).catch(() => {});
}

/** On sign-out: this browser stops getting that account's alerts. */
export async function unregisterWebPush() {
  let endpoint: string | null = null;
  try {
    endpoint = localStorage.getItem(WEB_PUSH_KEY);
    localStorage.removeItem(WEB_PUSH_KEY);
  } catch {
    return;
  }
  if (endpoint) await fetch("/api/app/devices", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: endpoint }) }).catch(() => {});
}

export function useWebPush() {
  const [state, setState] = useState<PushState>("off");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const s = initialState();
    setState(s);
    if (s !== "off") return;
    void currentSubscription().then((sub) => {
      let linked = false;
      try {
        linked = !!sub && localStorage.getItem(WEB_PUSH_KEY) === sub.endpoint;
      } catch {
        // ignore
      }
      if (linked && Notification.permission === "granted") setState("on");
    });
  }, []);
  const enable = useCallback(async () => {
    setState("working");
    setError(null);
    try {
      setState(await enableWebPush());
    } catch (err) {
      setError((err as Error).message);
      setState("error");
    }
  }, []);
  return { state, error, enable };
}

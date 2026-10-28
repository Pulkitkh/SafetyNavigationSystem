"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";
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

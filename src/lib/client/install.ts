"use client";

import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Chrome fires this once per page load, often before React mounts: keep it globally.
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

/** Installing SafeNav from the browser (no APK): Chrome's own "Install app". */
export function useInstall() {
  const [, setTick] = useState(0);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const update = () => setTick((t) => t + 1);
    listeners.add(update);
    setInstalled(window.matchMedia("(display-mode: standalone)").matches || !!(navigator as Navigator & { standalone?: boolean }).standalone);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return {
    installed,
    canPrompt: !!deferred,
    install: async () => {
      if (!deferred) return false;
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      if (outcome === "accepted") setInstalled(true);
      return outcome === "accepted";
    },
  };
}

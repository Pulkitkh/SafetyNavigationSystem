"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { isNativeApp, watchBackgroundPosition } from "./native";
import { DEFAULT_PREFS, store, type LastFix, type Prefs, type StoredContact } from "./store";

export interface Me {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  autoSos: boolean;
  /** Always-on location sharing with linked trusted contacts. */
  shareLive: boolean;
}

interface SessionValue {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  contacts: StoredContact[];
  refreshContacts: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<StoredContact[]>([]);

  const refreshContacts = useCallback(async () => {
    try {
      const { contacts } = await api<{ contacts: StoredContact[] }>("/api/contacts");
      setContacts(contacts);
      store.setContacts(contacts);
    } catch {
      setContacts(store.contacts());
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api<{ user: Me | null }>("/api/auth/me");
      setMe(user);
      store.setUserName(user?.name ?? null);
      if (user) await refreshContacts();
      else {
        setContacts([]);
        store.setContacts([]);
      }
    } catch {
      // Offline: keep whatever the device remembers so SOS still has contacts.
      setContacts(store.contacts());
    } finally {
      setLoading(false);
    }
  }, [refreshContacts]);

  useEffect(() => {
    setContacts(store.contacts());
    void refresh();
  }, [refresh]);

  return <SessionContext.Provider value={{ me, loading, refresh, contacts, refreshContacts }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

export interface GeoState {
  fix: LastFix | null;
  error: string | null;
  /** Fixes since the hook mounted (bounded), for monitoring rules. */
  history: LastFix[];
}

/** Continuous GPS. The last fix is persisted so SOS has a location even before a fresh one arrives. */
export function useGeolocation(enabled = true, keepHistory = false): GeoState {
  const [state, setState] = useState<GeoState>({ fix: null, error: null, history: [] });
  const historyRef = useRef<LastFix[]>([]);

  useEffect(() => {
    const cachedFix = store.lastFix();
    if (cachedFix) setState((s) => ({ ...s, fix: s.fix ?? cachedFix }));
    const accept = (fix: LastFix) => {
      store.setLastFix(fix);
      if (keepHistory) historyRef.current = [...historyRef.current.slice(-300), fix];
      setState({ fix, error: null, history: keepHistory ? historyRef.current : [] });
    };
    // In the native app, journeys use background GPS so tracking survives a locked screen.
    if (enabled && keepHistory && isNativeApp()) {
      return watchBackgroundPosition(accept, (code) =>
        setState((s) => ({
          ...s,
          error:
            code === "NOT_AUTHORIZED"
              ? "Location permission is off. Allow \"Always\" location for SafeNav in Settings so it can protect you with the screen locked."
              : "Can't get your location right now. Move to an open area or check that GPS is on.",
        })),
      );
    }
    if (!enabled || typeof navigator === "undefined" || !navigator.geolocation) {
      if (enabled) setState((s) => ({ ...s, error: "Location is not supported on this device" }));
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => accept({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, at: pos.timestamp || Date.now() }),
      (err) => {
        const message =
          err.code === err.PERMISSION_DENIED
            ? "Location permission is off. Allow it in your browser settings so SafeNav can guide and protect you."
            : "Can't get your location right now. Move to an open area or check that GPS is on.";
        setState((s) => ({ ...s, error: message }));
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, keepHistory]);

  return state;
}

/** Keep the screen on during a journey; the browser stops GPS when the screen locks. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        // denied (e.g. battery saver); monitoring still works while the screen is on
      }
    };
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible" && !cancelled) void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}

interface BatteryManager {
  level: number;
}

export async function batteryLevel(): Promise<number | undefined> {
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
    return nav.getBattery ? (await nav.getBattery()).level : undefined;
  } catch {
    return undefined;
  }
}

/** Device preferences, kept in sync across components on the same page. */
export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  useEffect(() => {
    const sync = () => setPrefs(store.prefs());
    sync();
    window.addEventListener("safenav:prefs", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("safenav:prefs", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return [prefs, store.setPrefs];
}

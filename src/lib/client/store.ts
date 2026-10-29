"use client";

import type { LngLat } from "@/lib/geo";

/**
 * Small pieces of state kept on the device so the SOS screen works offline
 * and an active journey survives a reload.
 */

export interface StoredContact {
  id: string;
  name: string;
  phone: string;
  relation: string;
  isPrimary: boolean;
  /** Devices that get this contact's SOS alerts automatically. */
  alerts?: { push: number; telegram: number; whatsapp?: number };
}

export interface ActiveJourney {
  tripId: string;
  shareToken: string;
  mode: "walk" | "ride";
  destLabel: string;
  dest: LngLat;
  route: LngLat[];
  steps: { instruction: string; distance: number; location: LngLat }[];
  expectedArrival: number;
  vehicle?: string | null;
  startedAt: number;
}

export interface LastFix {
  lat: number;
  lng: number;
  accuracy: number;
  at: number;
}

/** Per-device preferences; they don't need an account. */
export interface Prefs {
  /** Plan routes without steps or rough surfaces. */
  stepFree: boolean;
  /** Spoken turn-by-turn directions during a journey. */
  voice: boolean;
  /** Shaking the phone hard starts an SOS countdown. */
  shakeSos: boolean;
  /** Seconds to cancel a shake-triggered SOS before it sends; 0 sends at once. */
  shakeCountdownS: number;
  /** Android app: keep listening for a shake with the screen locked. */
  shakeLocked: boolean;
  /** Android app: SOS texts contacts from the phone's SIM straight away. */
  autoSms: boolean;
  /** Journeys tell contacts with alerts turned on that you've set off. */
  notifyOnStart: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  stepFree: false,
  voice: true,
  shakeSos: false,
  shakeCountdownS: 3,
  shakeLocked: true,
  autoSms: true,
  notifyOnStart: true,
};

export type Theme = "system" | "light" | "dark";

/** A place remembered on this device for quick reuse. */
export interface SavedPlace {
  label: string;
  detail?: string;
  point: LngLat;
  tag?: "home" | "work";
}

export interface PlaceBook {
  favorites: SavedPlace[];
  recent: SavedPlace[];
}

const samePlace = (a: SavedPlace, b: SavedPlace) => Math.abs(a.point[0] - b.point[0]) < 1e-4 && Math.abs(a.point[1] - b.point[1]) < 1e-4;

/** A running safety timer: check in before `endsAt` or SOS is raised. */
export interface SafetyTimer {
  startedAt: number;
  endsAt: number;
  note?: string;
}

const KEYS = {
  timer: "safenav.timer",
  places: "safenav.places",
  prefs: "safenav.prefs",
  contacts: "safenav.contacts",
  journey: "safenav.journey",
  fix: "safenav.lastFix",
  user: "safenav.user",
  theme: "safenav.theme",
  sosDrill: "safenav.sosDrill",
};

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage may be unavailable (private mode); the app still works online
  }
}

export const store = {
  timer: () => read<SafetyTimer>(KEYS.timer),
  setTimer: (t: SafetyTimer | null) => {
    write(KEYS.timer, t);
    if (typeof window !== "undefined") window.dispatchEvent(new Event("safenav:timer"));
  },
  places: (): PlaceBook => ({ favorites: [], recent: [], ...(read<Partial<PlaceBook>>(KEYS.places) ?? {}) }),
  addRecent: (p: SavedPlace) => {
    const book = store.places();
    write(KEYS.places, { ...book, recent: [p, ...book.recent.filter((r) => !samePlace(r, p))].slice(0, 8) });
  },
  /** Adds or removes a favourite; returns whether it is now a favourite. */
  toggleFavorite: (p: SavedPlace): boolean => {
    const book = store.places();
    const exists = book.favorites.some((f) => samePlace(f, p));
    write(KEYS.places, { ...book, favorites: exists ? book.favorites.filter((f) => !samePlace(f, p)) : [p, ...book.favorites].slice(0, 20) });
    if (typeof window !== "undefined") window.dispatchEvent(new Event("safenav:places"));
    return !exists;
  },
  isFavorite: (p: SavedPlace) => store.places().favorites.some((f) => samePlace(f, p)),
  prefs: (): Prefs => ({ ...DEFAULT_PREFS, ...(read<Partial<Prefs>>(KEYS.prefs) ?? {}) }),
  setPrefs: (patch: Partial<Prefs>) => {
    write(KEYS.prefs, { ...store.prefs(), ...patch });
    if (typeof window !== "undefined") window.dispatchEvent(new Event("safenav:prefs"));
  },
  contacts: () => read<StoredContact[]>(KEYS.contacts) ?? [],
  setContacts: (c: StoredContact[]) => write(KEYS.contacts, c),
  journey: () => read<ActiveJourney>(KEYS.journey),
  setJourney: (j: ActiveJourney | null) => write(KEYS.journey, j),
  lastFix: () => read<LastFix>(KEYS.fix),
  setLastFix: (f: LastFix) => write(KEYS.fix, f),
  theme: (): Theme => read<Theme>(KEYS.theme) ?? "system",
  setTheme: (t: Theme) => {
    write(KEYS.theme, t);
    applyTheme(t);
  },
  /** When the user last practised an SOS, for the safety checklist. */
  sosDrillAt: () => read<number>(KEYS.sosDrill),
  setSosDrillAt: (t: number) => write(KEYS.sosDrill, t),
  userName: () => read<string>(KEYS.user),
  setUserName: (n: string | null) => write(KEYS.user, n),
};

export function applyTheme(t: Theme) {
  if (typeof document === "undefined") return;
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  window.dispatchEvent(new Event("safenav:theme"));
}

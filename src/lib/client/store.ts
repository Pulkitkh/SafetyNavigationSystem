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

const KEYS = {
  contacts: "safenav.contacts",
  journey: "safenav.journey",
  fix: "safenav.lastFix",
  user: "safenav.user",
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
  contacts: () => read<StoredContact[]>(KEYS.contacts) ?? [],
  setContacts: (c: StoredContact[]) => write(KEYS.contacts, c),
  journey: () => read<ActiveJourney>(KEYS.journey),
  setJourney: (j: ActiveJourney | null) => write(KEYS.journey, j),
  lastFix: () => read<LastFix>(KEYS.fix),
  setLastFix: (f: LastFix) => write(KEYS.fix, f),
  userName: () => read<string>(KEYS.user),
  setUserName: (n: string | null) => write(KEYS.user, n),
};

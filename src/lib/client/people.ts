"use client";

import { useCallback, useEffect, useState } from "react";
import type { Tone } from "@/components/ui";
import { api, formatAgo } from "./api";
import { useSession } from "./hooks";

export interface Person {
  userId: string;
  contactId: string;
  name: string;
  phone: string | null;
  relation: string;
  sharing: boolean;
  status: "sos" | "alert" | "journey" | "sharing" | "idle";
  location: { lat: number; lng: number; accuracy: number | null; at: string; battery: number | null; source: "live" | "trip" } | null;
  trip: {
    id: string;
    mode: "walk" | "ride";
    status: "active" | "alert" | "sos" | "ended";
    destLabel: string;
    dest: [number, number] | null;
    expectedArrival: string;
    alertReason: string | null;
    vehicle: string | null;
    startedAt: string;
  } | null;
  myResponse: string | null;
}

/** People who added the signed-in user as a trusted contact. Polls while the page is visible. */
export function usePeople(intervalMs = 20_000) {
  const { me } = useSession();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ people: Person[] }>("/api/people");
      setPeople(res.people);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!me) {
      setPeople(null);
      return;
    }
    void load();
    const id = setInterval(() => document.visibilityState === "visible" && void load(), intervalMs);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [me, load, intervalMs]);

  return { people, error, reload: load };
}

export async function respond(userId: string, response: "on_my_way" | "calling" | "called_112") {
  await api(`/api/people/${userId}/respond`, { method: "POST", json: { response } });
}

export const RESPONSE_TEXT: Record<string, string> = {
  on_my_way: "On the way",
  calling: "Calling you",
  called_112: "Called 112",
};

export const STATUS: Record<Person["status"], { text: string; tone: Tone }> = {
  sos: { text: "SOS", tone: "sos" },
  alert: { text: "Check-in pending", tone: "caution" },
  journey: { text: "On a journey", tone: "brand" },
  sharing: { text: "Sharing location", tone: "good" },
  idle: { text: "Not sharing", tone: "neutral" },
};

/** "Live · 2 min ago · 82%" or why there's no location. */
export function locationLine(p: Person) {
  if (!p.location) return p.sharing ? "Waiting for their first location" : "Location shared only during a journey or SOS";
  const age = Date.now() - new Date(p.location.at).getTime();
  const parts = [age < 5 * 60_000 ? "Live" : "Last seen", formatAgo(p.location.at)];
  if (p.location.battery != null) parts.push(`${Math.round(p.location.battery * 100)}% battery`);
  return parts.join(" · ");
}


import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db";
import { searchPlaces } from "@/lib/providers/geocode";
import { resetFailoverForTests } from "@/lib/providers/http";
import { olaEnabled, olaToPlace, resetOlaForTests, takeOlaQuota } from "@/lib/providers/ola";

const indore: [number, number] = [75.86, 22.72];

describe("Ola Maps predictions", () => {
  it("reads autocomplete-style results", () => {
    const p = olaToPlace(
      {
        description: "56 Dukan, New Palasia, Indore, Madhya Pradesh 452001, India",
        structured_formatting: { main_text: "56 Dukan", secondary_text: "New Palasia, Indore, Madhya Pradesh 452001, India" },
        geometry: { location: { lat: 22.7246, lng: 75.8839 } },
        types: ["food", "point_of_interest"],
      },
      indore,
    );
    expect(p).toMatchObject({ label: "56 Dukan", detail: "New Palasia, Indore, Madhya Pradesh", source: "ola", kind: "Food" });
    expect(p!.distance).toBeLessThan(3000);
  });

  it("drops the repeated short name and duplicate localities Ola returns", () => {
    const p = olaToPlace({
      structured_formatting: { main_text: "56 Dukan Street", secondary_text: "56 Dukan St, New Palasia, New Palasia, Indore, Madhya Pradesh, 452001, India" },
      geometry: { location: { lat: 22.7241, lng: 75.8845 } },
      types: ["street_address"],
    });
    expect(p!.detail).toBe("New Palasia, Indore, Madhya Pradesh");
    const q = olaToPlace({
      structured_formatting: { main_text: "Charminar", secondary_text: "Rd, 16-113, Unit No F-55, Char Kaman, Hyderabad, Telangana 500002" },
      geometry: { location: { lat: 17.36, lng: 78.47 } },
    });
    expect(q!.detail).toBe("Char Kaman, Hyderabad, Telangana");
    const mall = olaToPlace({
      structured_formatting: { main_text: "LuLu Mall", secondary_text: "Second Floor, Second Floor-Mezzanine & Third Floor, IBB-2, Amar Shaheed Path, Golf City, Lucknow" },
      geometry: { location: { lat: 26.78, lng: 80.99 } },
    });
    expect(mall!.detail).toBe("Amar Shaheed Path, Golf City, Lucknow");
  });

  it("reads text-search-style results and drops ones without coordinates", () => {
    expect(olaToPlace({ name: "AIIMS Bhopal", formatted_address: "Saket Nagar, Bhopal, India", geometry: { location: { lat: 23.2, lng: 77.46 } }, types: ["hospital"] })).toMatchObject({
      label: "AIIMS Bhopal",
      detail: "Saket Nagar, Bhopal",
      kind: "Hospital",
    });
    expect(olaToPlace({ description: "Somewhere" })).toBeNull();
  });

  it("caps requests per day", () => {
    resetOlaForTests();
    process.env.OLA_MAPS_DAILY_LIMIT = "2";
    const d = new Date("2026-10-29T10:00:00Z");
    expect([takeOlaQuota(d), takeOlaQuota(d), takeOlaQuota(d)]).toEqual([true, true, false]);
    expect(takeOlaQuota(new Date("2026-10-30T00:01:00Z"))).toBe(true); // new day
    delete process.env.OLA_MAPS_DAILY_LIMIT;
  });
});

describe("search with Ola Maps configured", () => {
  const calls: string[] = [];
  let photonUp = true;
  beforeAll(() => {
    process.env.DATABASE_URL = ":memory:";
    process.env.OLA_MAPS_API_KEY = "test-key";
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (url.includes("api.olamaps.io")) {
        expect((init?.headers as Record<string, string>)["X-Request-Id"]).toBeTruthy();
        return ok({
          status: "ok",
          predictions: [
            { structured_formatting: { main_text: "56 Dukan", secondary_text: "New Palasia, Indore" }, geometry: { location: { lat: 22.7246, lng: 75.8839 } } },
            { structured_formatting: { main_text: "Rajwada", secondary_text: "Indore" }, geometry: { location: { lat: 22.7186, lng: 75.8546 } } },
          ],
        });
      }
      if (url.includes("photon")) {
        if (!photonUp) throw new TypeError("fetch failed");
        return ok({ features: [{ geometry: { coordinates: [75.8547, 22.7186] }, properties: { name: "Rajwada", countrycode: "IN", city: "Indore" } }] });
      }
      throw new TypeError("fetch failed");
    });
  });
  beforeEach(() => {
    resetDbForTests();
    resetFailoverForTests();
    resetOlaForTests();
    calls.length = 0;
    photonUp = true;
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.OLA_MAPS_API_KEY;
    resetDbForTests();
  });

  it("merges Ola and OpenStreetMap results without duplicates and keeps the key out of cache keys", async () => {
    expect(olaEnabled()).toBe(true);
    const r = await searchPlaces("56 dukan", indore);
    expect(r.places.map((p) => p.label)).toEqual(["56 Dukan", "Rajwada"]); // Rajwada appears once
    expect(calls.find((u) => u.includes("olamaps"))).toContain("location=22.72000%2C75.86000");
  });

  it("still finds places through Ola when Photon is down", async () => {
    photonUp = false;
    const r = await searchPlaces("rajwada", indore);
    expect(r.places[0]).toMatchObject({ label: "Rajwada", source: "ola" });
    expect(r.degraded).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { haversine, type LngLat } from "@/lib/geo";
import {
  decodePlusCode,
  encodePlusCode,
  isShortMapLink,
  parseCoordinates,
  parseLocationInput,
  parseMapLink,
  recoverPlusCode,
} from "@/lib/location-input";
import { isGoogleMapsHost, mergePlaces, nominatimToPlace, photonToPlace, rankPlaces, type Place } from "@/lib/providers/geocode";

const close = (a: LngLat, b: LngLat, m: number) => expect(haversine(a, b)).toBeLessThan(m);

describe("coordinates", () => {
  it("reads decimal pairs in either order and DMS", () => {
    expect(parseCoordinates("28.6139, 77.2090")).toEqual([77.209, 28.6139]);
    expect(parseCoordinates("28.6139 77.2090")).toEqual([77.209, 28.6139]);
    expect(parseCoordinates("77.2090, 28.6139")).toEqual([77.209, 28.6139]);
    close(parseCoordinates(`28°36'50"N 77°12'32"E`)!, [77.2089, 28.6139], 20);
    expect(parseCoordinates("Connaught Place")).toBeNull();
    expect(parseCoordinates("0, 0")).toBeNull();
  });
});

describe("map links", () => {
  it("reads Google, WhatsApp, Apple and OpenStreetMap links", () => {
    expect(parseMapLink("https://www.google.com/maps/place/India+Gate/@28.6129,77.2295,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d28.612912!4d77.2295097")).toEqual([
      77.2295097, 28.612912,
    ]);
    expect(parseMapLink("https://maps.google.com/?q=22.7186,75.8546")).toEqual([75.8546, 22.7186]);
    expect(parseMapLink("https://www.google.com/maps/search/?api=1&query=19.0760%2C72.8777")).toEqual([72.8777, 19.076]);
    expect(parseMapLink("https://maps.apple.com/?ll=12.9716,77.5946&q=Bengaluru")).toEqual([77.5946, 12.9716]);
    expect(parseMapLink("https://www.openstreetmap.org/#map=17/22.71860/75.85460")).toEqual([75.8546, 22.7186]);
    expect(parseMapLink("geo:17.3616,78.4747?z=16")).toEqual([78.4747, 17.3616]);
    expect(isShortMapLink("https://maps.app.goo.gl/AbCdEf123")).toBe(true);
    expect(isShortMapLink("https://example.com/x")).toBe(false);
  });

  it("only lets the server follow Google map hosts", () => {
    expect(isGoogleMapsHost("https://maps.app.goo.gl/x")).toBe(true);
    expect(isGoogleMapsHost("https://www.google.com/maps/place/x")).toBe(true);
    expect(isGoogleMapsHost("https://www.google.co.in/maps")).toBe(true);
    expect(isGoogleMapsHost("http://maps.app.goo.gl/x")).toBe(false);
    expect(isGoogleMapsHost("https://169.254.169.254/latest")).toBe(false);
    expect(isGoogleMapsHost("https://google.com.evil.example/x")).toBe(false);
  });
});

describe("plus codes", () => {
  it("decodes a known code to its real location", () => {
    // Google Zürich, the reference example in the Open Location Code docs.
    close(decodePlusCode("8FVC9G8F+6X"), [8.5248, 47.3656], 60);
  });

  it("round-trips Indian locations at ~14 m precision", () => {
    for (const p of [
      [77.209, 28.6139],
      [75.8546, 22.7186],
      [72.8777, 19.076],
      [88.3639, 22.5726],
      [76.2673, 9.9312],
    ] as LngLat[]) {
      const code = encodePlusCode(p[0], p[1]);
      expect(code).toMatch(/^[23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2}$/);
      close(decodePlusCode(code), p, 12);
    }
  });

  it("recovers short codes from a nearby reference", () => {
    const indore: LngLat = [75.8546, 22.7186];
    const full = encodePlusCode(indore[0], indore[1]);
    const short = full.slice(4); // drop the region prefix, as Google Maps shows it
    close(recoverPlusCode(short, [75.86, 22.75]), indore, 15);
  });

  it("recognises codes typed with a locality", () => {
    expect(parseLocationInput("H4P4+XX Indore, MP")).toEqual({ kind: "shortcode", code: "H4P4+XX", locality: "Indore MP" });
    const full = parseLocationInput("7JJQH4P4+XX");
    expect(full?.kind).toBe("point");
    expect(parseLocationInput("Sarafa Bazaar")).toBeNull();
    expect(parseLocationInput("https://maps.app.goo.gl/abc")).toEqual({ kind: "shortlink", url: "https://maps.app.goo.gl/abc" });
  });
});

describe("geocoder results", () => {
  it("drops places outside India and labels place types", () => {
    const pk = photonToPlace({ geometry: { coordinates: [74.3, 31.5] }, properties: { name: "Sarafa Bazaar", countrycode: "PK" } });
    expect(pk).toBeNull();
    const metro = photonToPlace(
      { geometry: { coordinates: [77.2373, 28.5708] }, properties: { name: "Lajpat Nagar", countrycode: "IN", osm_key: "railway", osm_value: "station", city: "Delhi" } },
      [77.24, 28.57],
    );
    expect(metro).toMatchObject({ label: "Lajpat Nagar", kind: "Railway station", detail: "Delhi" });
    expect(metro!.distance).toBeLessThan(500);
  });

  it("merges duplicates from both services", () => {
    const a = nominatimToPlace({ lat: "22.7186", lon: "75.8546", name: "Rajwada", display_name: "Rajwada, Indore", category: "tourism", type: "attraction" });
    const b = { ...a, source: "photon" as const, lng: 75.8547 };
    const c = { ...a, label: "Sarafa Bazaar", lat: 22.7202 };
    expect(mergePlaces([[a], [b, c]])).toHaveLength(2);
    expect(a.kind).toBe("Attraction");
  });

  it("ranks name matches and nearby places first", () => {
    const mk = (label: string, detail: string, distance?: number): Place => ({ label, detail, lng: 0, lat: 0, distance });
    const near: LngLat = [75.87, 22.72];
    const ranked = rankPlaces(
      [mk("Surya Treasure Island Mall", "Durg", 700_000), mk("Treasure Island(TI)", "Indore", 1200), mk("McDonald's", "Bhanwarkuan Road", 900)],
      "Treasure Island mall",
      near,
    );
    expect(ranked[0].label).toBe("Treasure Island(TI)");
    const area = rankPlaces([mk("McDonald's", "Bhanwarkuan Road, Indore", 500), mk("Bhanwarkuan", "Indore", 800)], "Bhanwarkuan", near);
    expect(area[0].label).toBe("Bhanwarkuan");
  });
});

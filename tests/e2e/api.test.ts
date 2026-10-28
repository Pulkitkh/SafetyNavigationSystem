/**
 * End-to-end API test against a running server:
 *   E2E_BASE_URL=http://localhost:3000 npm test
 * Skipped when E2E_BASE_URL is not set. Uses whatever database the server is configured with.
 */
import { describe, expect, it } from "vitest";

const BASE = process.env.E2E_BASE_URL;
const run = BASE ? describe : describe.skip;
/** Calls that reach the public data services can wait out their full failover budget. */
const NETWORK_TIMEOUT = 120_000;

class Client {
  cookie = "";
  async call(path: string, init: { method?: string; json?: unknown; headers?: Record<string, string> } = {}) {
    const res = await fetch(`${BASE}${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...init.headers,
      },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }
}

const token = () => Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
const unique = Date.now().toString(36);
const route: [number, number][] = [
  [75.8577, 22.7196],
  [75.8601, 22.7231],
  [75.8633, 22.7262],
];

run("API end to end", () => {
  const asha = new Client();
  const ravi = new Client();
  let contactId = "";
  let tripId = "";
  const share = token();

  it("registers, rejects duplicates and reads the session", async () => {
    const reg = await asha.call("/api/auth/register", { method: "POST", json: { name: "Asha Verma", email: `asha-${unique}@example.com`, password: "correct horse", phone: "98765 43210" } });
    expect(reg.status).toBe(201);
    expect(reg.body.user.phone).toBe("+919876543210");
    const dup = await new Client().call("/api/auth/register", { method: "POST", json: { name: "X Y", email: `asha-${unique}@example.com`, password: "whatever123" } });
    expect(dup.status).toBe(409);
    const me = await asha.call("/api/auth/me");
    expect(me.body.user.name).toBe("Asha Verma");
    expect(me.body.user).not.toHaveProperty("passwordHash");
  });

  it("validates input and blocks cross-origin writes", async () => {
    const bad = await new Client().call("/api/auth/register", { method: "POST", json: { name: "A", email: "nope", password: "x" } });
    expect(bad.status).toBe(400);
    const cross = await asha.call("/api/contacts", { method: "POST", json: { name: "M", phone: "9876500000", relation: "Mother" }, headers: { Origin: "https://evil.example" } });
    expect(cross.status).toBe(403);
    const anon = await new Client().call("/api/contacts");
    expect(anon.status).toBe(401);
  });

  it("logs in with the right password only", async () => {
    const wrong = await new Client().call("/api/auth/login", { method: "POST", json: { email: `asha-${unique}@example.com`, password: "nope" } });
    expect(wrong.status).toBe(401);
    const ok = await ravi.call("/api/auth/register", { method: "POST", json: { name: "Ravi Kumar", email: `ravi-${unique}@example.com`, password: "another pass" } });
    expect(ok.status).toBe(201);
  });

  it("manages trusted contacts with ownership checks", async () => {
    const add = await asha.call("/api/contacts", { method: "POST", json: { name: "Maa", phone: "09876512345", relation: "Mother" } });
    expect(add.status).toBe(201);
    expect(add.body.contact).toMatchObject({ phone: "+919876512345", isPrimary: true });
    contactId = add.body.contact.id;
    const second = await asha.call("/api/contacts", { method: "POST", json: { name: "Priya", phone: "+91 91234 56789", relation: "Friend", isPrimary: true } });
    expect(second.status).toBe(201);
    const list = await asha.call("/api/contacts");
    expect(list.body.contacts.map((c: { name: string }) => c.name)).toEqual(["Priya", "Maa"]);
    const badPhone = await asha.call("/api/contacts", { method: "POST", json: { name: "Z", phone: "12345", relation: "Friend" } });
    expect(badPhone.status).toBe(400);
    const stolen = await ravi.call(`/api/contacts/${contactId}`, { method: "DELETE" });
    expect(stolen.status).toBe(404);
  });

  it("files reports, hides your own from voting, and lets others confirm", async () => {
    const rep = await asha.call("/api/reports", { method: "POST", json: { category: "poor_lighting", lat: 22.72, lng: 75.86, note: "Lights out near the underpass" } });
    expect(rep.status).toBe(201);
    expect(rep.body.report).not.toHaveProperty("userId");
    const id = rep.body.report.id;
    expect((await asha.call(`/api/reports/${id}/vote`, { method: "POST", json: { value: 1 } })).status).toBe(400);
    const vote = await ravi.call(`/api/reports/${id}/vote`, { method: "POST", json: { value: 1 } });
    expect(vote.body).toMatchObject({ upvotes: 1, flags: 0 });
    const again = await ravi.call(`/api/reports/${id}/vote`, { method: "POST", json: { value: 1 } });
    expect(again.body.upvotes).toBe(1);
    const list = await ravi.call("/api/reports?bbox=75.85,22.71,75.87,22.73");
    expect(list.body.reports.some((r: { id: string }) => r.id === id)).toBe(true);
    const badCat = await asha.call("/api/reports", { method: "POST", json: { category: "aliens", lat: 22.72, lng: 75.86 } });
    expect(badCat.status).toBe(400);
  });

  it("starts a ride, streams location and shows it on the public link", async () => {
    const bad = await asha.call("/api/trips", { method: "POST", json: { shareToken: share, mode: "ride", destLabel: "Home", dest: route[2], route, durationS: 900, vehiclePlate: "XYZ" } });
    expect(bad.status).toBe(400);
    const start = await asha.call("/api/trips", {
      method: "POST",
      json: { shareToken: share, mode: "ride", destLabel: "Home", dest: route[2], route, durationS: 900, vehicleType: "auto", vehiclePlate: "mp 09 ab 1234" },
    });
    expect(start.status).toBe(201);
    tripId = start.body.trip.id;
    const loc = await asha.call(`/api/trips/${tripId}/location`, { method: "POST", json: { lat: 22.7201, lng: 75.858, accuracy: 12, battery: 0.64 } });
    expect(loc.status).toBe(200);
    const notMine = await ravi.call(`/api/trips/${tripId}/location`, { method: "POST", json: { lat: 1, lng: 1 } });
    expect(notMine.status).toBe(404);

    const view = await new Client().call(`/api/share/${share}`);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ name: "Asha Verma", phone: "+919876543210", mode: "ride", status: "active", vehiclePlate: "MP09AB1234", vehicleType: "auto" });
    expect(view.body.last).toMatchObject({ lat: 22.7201, lng: 75.858, battery: 0.64 });
    expect(view.body.trail).toHaveLength(1);
    expect((await new Client().call(`/api/share/${token()}`)).status).toBe(404);
  });

  it("reroutes an open trip and the live link follows the new route", async () => {
    const newRoute = [route[0], [75.859, 22.7215], route[2]];
    const bad = await asha.call(`/api/trips/${tripId}/reroute`, { method: "POST", json: { route: [route[0]], durationS: 600 } });
    expect(bad.status).toBe(400);
    expect((await ravi.call(`/api/trips/${tripId}/reroute`, { method: "POST", json: { route: newRoute, durationS: 600 } })).status).toBe(404);
    const ok = await asha.call(`/api/trips/${tripId}/reroute`, { method: "POST", json: { route: newRoute, durationS: 600 } });
    expect(ok.status).toBe(200);
    expect(new Date(ok.body.trip.expectedArrival).getTime()).toBeGreaterThan(Date.now());
    const view = await new Client().call(`/api/share/${share}`);
    expect(view.body.route).toHaveLength(3);
  });

  it("raises a check-in alert and then an SOS on the same live link", async () => {
    expect((await asha.call(`/api/trips/${tripId}`, { method: "PATCH", json: { status: "alert", reason: "You haven't moved for a while." } })).status).toBe(200);
    expect((await new Client().call(`/api/share/${share}`)).body).toMatchObject({ status: "alert", alertReason: "You haven't moved for a while." });

    const sos = await asha.call("/api/sos", { method: "POST", json: { shareToken: share, tripId, lat: 22.7205, lng: 75.8585, accuracy: 9, trigger: "missed_checkin" } });
    expect(sos.status).toBe(200);
    expect(sos.body.tripId).toBe(tripId);
    expect(sos.body.liveUrl).toMatch(new RegExp(`/t/${share}$`));
    expect(sos.body.message).toContain("SOS: Asha Verma needs help (missed a safety check-in).");
    expect(sos.body.message).toContain("Vehicle: Auto-rickshaw MP09AB1234");
    expect(sos.body.contacts).toHaveLength(2);
    expect(sos.body.gateway).toBeNull();

    const view = await new Client().call(`/api/share/${share}`);
    expect(view.body.status).toBe("sos");
    expect(view.body.trail).toHaveLength(2);
    // An SOS can't be quietly downgraded, only ended.
    expect((await asha.call(`/api/trips/${tripId}`, { method: "PATCH", json: { status: "active" } })).status).toBe(409);
    expect((await asha.call(`/api/trips/${tripId}`, { method: "PATCH", json: { status: "ended", reason: "Marked safe" } })).status).toBe(200);
    const ended = await new Client().call(`/api/share/${share}`);
    expect(ended.body).toMatchObject({ status: "ended", alertReason: "Marked safe" });
  });

  it("creates a live link for an SOS outside any journey", async () => {
    const t = token();
    const sos = await ravi.call("/api/sos", { method: "POST", json: { shareToken: t, lat: 22.71, lng: 75.85 } });
    expect(sos.status).toBe(200);
    expect(sos.body.contacts).toHaveLength(0);
    const view = await new Client().call(`/api/share/${t}`);
    expect(view.body).toMatchObject({ name: "Ravi Kumar", status: "sos", dest: null, route: [] });
    const active = await ravi.call("/api/trips");
    expect(active.body.trip.status).toBe("sos");
  });

  it("reports upstream outages with a clear message instead of crashing", async () => {
    const plan = await asha.call("/api/routes/plan", { method: "POST", json: { from: route[0], to: route[2], mode: "walk" } });
    expect([200, 502]).toContain(plan.status);
    if (plan.status === 502) expect(plan.body.error).toMatch(/not responding/);
    else expect(plan.body.routes.length).toBeGreaterThan(0);
    const same = await asha.call("/api/routes/plan", { method: "POST", json: { from: route[0], to: route[0] } });
    expect(same.status).toBe(400);
  }, NETWORK_TIMEOUT);

  it("reports database and upstream health", async () => {
    const shallow = await new Client().call("/api/health?deep=0");
    expect(shallow.status).toBe(200);
    expect(shallow.body).toMatchObject({ ok: true, database: true });
    const deep = await new Client().call("/api/health");
    expect([200, 503]).toContain(deep.status);
    expect(deep.body.probes.length).toBeGreaterThan(5);
    expect(Object.keys(deep.body.services)).toContain("street data (Overpass)");
  }, NETWORK_TIMEOUT);

  it("resolves pasted coordinates, map links and plus codes in search", async () => {
    const c = new Client();
    for (const q of ["22.7186, 75.8546", "https://maps.google.com/?q=22.7186,75.8546", "7JJQPV93+CR"]) {
      const r = await c.call(`/api/geocode/search?q=${encodeURIComponent(q)}`);
      expect(r.status).toBe(200);
      expect(r.body.places).toHaveLength(1);
      expect(r.body.places[0].lat).toBeCloseTo(22.7186, 2);
      expect(r.body.places[0].lng).toBeCloseTo(75.8546, 2);
    }
    const short = await c.call(`/api/geocode/search?q=${encodeURIComponent("PV93+CR")}`);
    expect(short.status).toBe(422); // a short code needs a city or the user's location
    expect(short.body.error).toMatch(/city/);
    const nearby = await c.call(`/api/geocode/search?q=${encodeURIComponent("PV93+CR")}&lat=22.72&lng=75.86`);
    expect(nearby.body.places[0].lat).toBeCloseTo(22.7186, 2);
  }, NETWORK_TIMEOUT);

  it("checks an area, degrading clearly when street data is unavailable", async () => {
    const r = await new Client().call("/api/safety/area?lat=22.7186&lng=75.8546");
    expect([200, 502]).toContain(r.status);
    if (r.status === 200) {
      expect(r.body.area.score).toBeGreaterThanOrEqual(0);
      expect(r.body.area.factors).toHaveProperty("frontage");
    } else expect(r.body.error).toMatch(/OpenStreetMap data/);
    expect((await new Client().call("/api/safety/area?lat=abc")).status).toBe(400);
  }, NETWORK_TIMEOUT);

  it("logs out", async () => {
    expect((await asha.call("/api/auth/logout", { method: "POST" })).status).toBe(200);
    expect((await asha.call("/api/auth/me")).body.user).toBeNull();
  });
});

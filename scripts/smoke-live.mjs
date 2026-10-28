#!/usr/bin/env node
// Live smoke test against a running SafeNav server and the real public data services.
//
//   node scripts/smoke-live.mjs                      # http://localhost:3000
//   node scripts/smoke-live.mjs https://your-domain
//
// Plans real walks in several Indian cities by day and at night, and checks that
// routes come back scored, ranked and explained. Exits non-zero on any failure.

const BASE = (process.argv[2] || process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

const TRIPS = [
  { city: "Delhi", name: "Connaught Place → Janpath metro", from: [77.2167, 28.6315], to: [77.2193, 28.6247] },
  { city: "Mumbai", name: "CSMT → Flora Fountain", from: [72.8355, 18.9398], to: [72.8326, 18.9322] },
  { city: "Bengaluru", name: "MG Road metro → Brigade Road", from: [77.6095, 12.9755], to: [77.6070, 12.9719] },
  { city: "Indore", name: "Rajwada → Sarafa Bazaar", from: [75.8546, 22.7186], to: [75.8530, 22.7202] },
  { city: "Kolkata", name: "Park Street → New Market", from: [88.3520, 22.5530], to: [88.3510, 22.5605] },
];

function tonightIST() {
  const d = new Date();
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  ist.setUTCHours(22, 30, 0, 0); // 22:30 IST
  const t = new Date(ist.getTime() - 5.5 * 3600_000);
  return (t.getTime() < Date.now() ? new Date(t.getTime() + 86_400_000) : t).toISOString();
}
function tomorrowNoonIST() {
  const ist = new Date(Date.now() + 5.5 * 3600_000 + 86_400_000);
  ist.setUTCHours(12, 0, 0, 0);
  return new Date(ist.getTime() - 5.5 * 3600_000).toISOString();
}

async function post(path, body) {
  const t0 = Date.now();
  const res = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, ms: Date.now() - t0, body: await res.json().catch(() => ({})) };
}

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`  ✗ ${msg}`);
};

const health = await fetch(`${BASE}/api/health`).then(async (r) => ({ status: r.status, body: await r.json() }));
console.log(`Health ${health.status}:`, health.body.services);
for (const p of health.body.probes ?? []) console.log(`  ${p.ok ? "✓" : "✗"} ${p.service.padEnd(30)} ${String(p.ms).padStart(5)} ms  ${p.url}`);
if (!health.body.ok) fail("a critical upstream is down; results below may be unscored");

for (const trip of TRIPS) {
  for (const [label, departAt] of [
    ["day", tomorrowNoonIST()],
    ["night", tonightIST()],
  ]) {
    const r = await post("/api/routes/plan", { from: trip.from, to: trip.to, mode: "walk", departAt });
    console.log(`\n${trip.city}: ${trip.name} (${label}) → ${r.status} in ${r.ms} ms`);
    if (r.status !== 200) {
      fail(r.body.error || `HTTP ${r.status}`);
      continue;
    }
    const best = r.body.routes[0];
    if (r.body.dataNote) console.log(`  note: ${r.body.dataNote}`);
    if (!best?.safety) {
      fail("recommended route is not scored");
      continue;
    }
    const s = best.safety;
    console.log(
      `  ${r.body.routes.length} route(s); recommended ${best.distance} m, ${Math.round(best.duration / 60)} min, score ${s.score} (${s.band}), period ${s.period}, confidence ${s.confidence.level}`,
    );
    console.log(`  factors ${JSON.stringify(s.factors)}`);
    if (s.weakStretches.length) console.log(`  weak: ${s.weakStretches.map((w) => w.reasons.join("; ")).join(" | ")}`);
    if (r.body.weather) console.log(`  weather ${JSON.stringify(r.body.weather)}`);
    if (!best.tags.includes("recommended")) fail("first route is not tagged recommended");
    if (label === "night" && s.period === "day") fail("night departure scored as daylight");
    if (label === "day" && s.weights.lighting !== 0) fail("lighting weighted in daylight");
    if (!best.steps.length) fail("no turn-by-turn steps");
  }
}

const sf = await post("/api/routes/plan", { from: TRIPS[0].from, to: TRIPS[0].to, mode: "walk", stepFree: true });
console.log(`\nStep-free Delhi → ${sf.status}; steps on recommended route: ${sf.body.routes?.[0]?.safety?.stats.steps ?? "n/a"}`);
if (sf.status !== 200) fail(sf.body.error || "step-free plan failed");

console.log(failures ? `\n${failures} check(s) failed` : "\nAll live checks passed");
process.exit(failures ? 1 : 0);

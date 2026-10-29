import { endpoints, userAgent } from "./http";
import { osrmBases } from "./osrm";
import { OVERPASS_MIRRORS } from "./overpass";

export interface ProbeResult {
  service: string;
  url: string;
  ok: boolean;
  status?: number;
  ms: number;
  error?: string;
}

async function probe(service: string, url: string, timeoutMs = 8000): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { "User-Agent": userAgent() }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    await res.arrayBuffer();
    return { service, url, ok: res.ok, status: res.status, ms: Date.now() - t0 };
  } catch (err) {
    return { service, url, ok: false, ms: Date.now() - t0, error: (err as Error).message };
  }
}

// Two points about 1 km apart in central Delhi.
const A = "77.2167,28.6315";
const B = "77.2090,28.6250";

/** Checks every live upstream the planner depends on, including fallbacks. */
export async function checkUpstreams(): Promise<ProbeResult[]> {
  const probes: Promise<ProbeResult>[] = [];
  for (const base of osrmBases("walk")) probes.push(probe("routing (walk)", `${base}/route/v1/driving/${A};${B}?overview=false`));
  for (const base of osrmBases("ride")) probes.push(probe("routing (ride)", `${base}/route/v1/driving/${A};${B}?overview=false`));
  for (const base of endpoints(process.env.VALHALLA_URL, ["https://valhalla1.openstreetmap.de"])) {
    if (base !== "off") probes.push(probe("routing fallback (Valhalla)", `${base}/status`));
  }
  for (const url of endpoints(process.env.OVERPASS_URL, OVERPASS_MIRRORS)) probes.push(probe("street data (Overpass)", url.replace(/\/interpreter$/, "/status")));
  probes.push(probe("street data (map tiles)", process.env.TILES_TILEJSON_URL || "https://tiles.openfreemap.org/planet"));
  probes.push(probe("place search (Photon)", `${process.env.PHOTON_URL || "https://photon.komoot.io"}/api/?q=delhi&limit=1`));
  probes.push(probe("reverse geocoding (Nominatim)", `${process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org"}/status?format=json`));
  probes.push(probe("weather (Open-Meteo)", `${process.env.OPEN_METEO_URL || "https://api.open-meteo.com"}/v1/forecast?latitude=28.6&longitude=77.2&hourly=visibility&forecast_days=1`));
  return Promise.all(probes);
}

/** A service is usable when at least one of its endpoints answers. */
export function summarise(results: ProbeResult[]) {
  const services = new Map<string, boolean>();
  for (const r of results) services.set(r.service, (services.get(r.service) ?? false) || r.ok);
  const walkUsable = services.get("routing (walk)") || services.get("routing fallback (Valhalla)");
  // Scoring works from either Overpass (richer) or the vector tiles.
  const streetUsable = services.get("street data (Overpass)") || services.get("street data (map tiles)");
  const ok = !!walkUsable && !!streetUsable;
  return { ok, services: Object.fromEntries(services) };
}

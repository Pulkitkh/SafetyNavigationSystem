import { z } from "zod";
import { haversine, type LngLat } from "@/lib/geo";
import { searchPlaces } from "@/lib/providers/geocode";
import { weatherAt } from "@/lib/providers/weather";
import type { AreaSafety } from "@/lib/safety/area";
import { checkArea, helpNear, type HelpPlace } from "@/lib/safety/checks";
import { planRoutes, type PlannedRoute, type PlanResult } from "@/lib/safety/plan";
import type { AgentTool } from "./loop";

/** JSON Schema helpers: only the keywords every provider's function calling accepts. */
export const S = {
  obj: (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) => ({ type: "object", properties, required }),
  str: (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra }),
  num: (description: string) => ({ type: "number", description }),
  int: (description: string) => ({ type: "integer", description }),
  bool: (description: string) => ({ type: "boolean", description }),
  arr: (items: Record<string, unknown>, description: string) => ({ type: "array", items, description }),
  enum: (values: readonly string[], description: string) => ({ type: "string", enum: values, description }),
};

const lng = z.coerce.number().min(-180).max(180);
const lat = z.coerce.number().min(-90).max(90);
const pointSchema = S.obj({ lng: S.num("Longitude"), lat: S.num("Latitude") });

const minutes = (s: number) => Math.round(s / 60);
const round = (n: number, step: number) => Math.round(n / step) * step;

/** What the model needs from an area score, without the bulk. */
export function areaBrief(a: AreaSafety) {
  return {
    score: a.confidence === "insufficient" ? null : a.score,
    band: a.band,
    confidence: a.confidence,
    period: a.period,
    neighbourhood: a.place ?? null,
    reasons: a.reasons.slice(0, 5),
    highlights: a.highlights.slice(0, 4),
    litShare: a.stats.litShare == null ? null : Math.round(a.stats.litShare * 100) / 100,
    openPlacesWithin200m: a.openNearby.slice(0, 4).map((p) => ({ name: p.name, kind: p.kind, metres: Math.round(p.distance) })),
    nearestPolice: a.nearestPolice && { name: a.nearestPolice.name, metres: Math.round(a.nearestPolice.distance) },
    nearestHaven: a.nearestHaven && { name: a.nearestHaven.name, kind: a.nearestHaven.kind, metres: Math.round(a.nearestHaven.distance), openNow: a.nearestHaven.openNow },
    communityReports: a.stats.reports,
  };
}

export function routeBrief(r: PlannedRoute) {
  const s = r.safety;
  return {
    routeId: r.id,
    tags: r.tags,
    minutes: minutes(r.duration),
    km: Math.round(r.distance / 100) / 10,
    safetyScore: s && s.confidence.level !== "insufficient" ? s.score : null,
    band: s?.band ?? "unscored",
    confidence: s?.confidence.level ?? "unscored",
    weakStretches: s?.weakStretches.slice(0, 3).map((w) => w.reasons.join("; ")) ?? [],
    highlights: s?.highlights.slice(0, 3) ?? [],
    litShare: s?.stats.litShare == null ? null : Math.round(s.stats.litShare * 100) / 100,
    openPlaces: s?.stats.openPlaces ?? null,
    nearestPoliceMetres: s?.stats.nearestPoliceM ?? null,
    stepsOnRoute: s?.stats.steps ?? null,
    vsFastest: r.vsFastest && { extraMinutes: Math.round(r.vsFastest.extraS / 6) / 10, safetyPointsGained: r.vsFastest.gain, avoids: r.vsFastest.avoids },
  };
}

function helpBrief(p: HelpPlace) {
  return { name: p.name ?? `Unnamed ${p.kind}`, kind: p.kind, metres: p.distance, openNow: p.openNow, lng: p.point[0], lat: p.point[1] };
}

export interface ToolContext {
  /** The traveller's position, if known: biases place search and is the default start. */
  here: LngLat | null;
  now: Date;
  /** Every plan made during the run, by plan id, so the caller can use the full result. */
  plans: Map<string, { plan: PlanResult; from: LngLat; to: LngLat; toLabel: string }>;
  /** Places found during the run, so the final answer can be matched to real coordinates. */
  places: { label: string; detail: string; point: LngLat }[];
}

export function newToolContext(here: LngLat | null, now = new Date()): ToolContext {
  return { here, now, plans: new Map(), places: [] };
}

export function searchPlaceTool(ctx: ToolContext): AgentTool<{ query: string }> {
  return {
    name: "search_place",
    description: "Find a place in India by name or address. Results are ranked by match and by distance from the traveller. Use it to turn a destination the traveller named into coordinates.",
    parameters: S.obj({ query: S.str("Place name or address, e.g. 'Vijay Nagar metro station, Indore'") }),
    args: z.object({ query: z.string().trim().min(2).max(160) }),
    run: async ({ query }) => {
      const { places } = await searchPlaces(query, ctx.here ?? undefined, { deep: true });
      const top = places.slice(0, 5);
      for (const p of top) ctx.places.push({ label: p.label, detail: p.detail, point: [p.lng, p.lat] });
      if (!top.length) return { results: [], note: "Nothing found. Try a shorter or different name, or add the city." };
      return {
        results: top.map((p) => ({
          label: p.label,
          detail: p.detail,
          kind: p.kind ?? null,
          lng: p.lng,
          lat: p.lat,
          kmFromTraveller: ctx.here ? Math.round(haversine(ctx.here, [p.lng, p.lat]) / 100) / 10 : null,
        })),
      };
    },
    describe: ({ query }, r) => `Searched for "${query}": ${(r as { results: unknown[] }).results.length} places found`,
  };
}

export function checkAreaTool(ctx: ToolContext): AgentTool<{ lng: number; lat: number }> {
  return {
    name: "check_area",
    description:
      "Safety right now at one point: street lighting, places open now within 200 m, isolation, nearest police and community reports, scored 0-100 (good ≥ 70, caution 45-69, avoid < 45). Use it for the start, the destination or where the traveller is now.",
    parameters: pointSchema,
    args: z.object({ lng, lat }),
    run: async ({ lng, lat }) => {
      const { area, weather } = await checkArea([lng, lat], ctx.now, { prewarm: false });
      return { ...areaBrief(area), weather };
    },
    describe: (_a, r) => {
      const b = r as ReturnType<typeof areaBrief>;
      return `Checked the area${b.neighbourhood ? ` (${b.neighbourhood})` : ""}: ${b.score == null ? "not enough map data" : `${b.score}/100, ${b.band}`}`;
    },
  };
}

export function weatherTool(ctx: ToolContext): AgentTool<{ lng: number; lat: number; inMinutes?: number }> {
  return {
    name: "get_weather",
    description: "Hourly forecast for a point: rain, heavy rain (underpasses may flood) and fog. Rain empties streets; fog makes lighting count for less.",
    parameters: S.obj({ lng: S.num("Longitude"), lat: S.num("Latitude"), inMinutes: S.int("Minutes from now, 0 for now") }, ["lng", "lat"]),
    args: z.object({ lng, lat, inMinutes: z.coerce.number().int().min(0).max(7 * 24 * 60).optional() }),
    run: async ({ lng, lat, inMinutes }) => {
      const w = await weatherAt([lng, lat], new Date(ctx.now.getTime() + (inMinutes ?? 0) * 60_000));
      if (!w) return { available: false };
      return { available: true, isRaining: w.isRaining, heavyRain: w.heavyRain, foggy: w.foggy, visibilityM: w.visibilityM, precipitationMm: w.precipitationMm };
    },
    describe: (_a, r) => {
      const w = r as { available: boolean; isRaining?: boolean; heavyRain?: boolean; foggy?: boolean };
      if (!w.available) return "Weather forecast unavailable";
      return `Checked the weather: ${w.heavyRain ? "heavy rain" : w.isRaining ? "rain" : w.foggy ? "fog" : "dry, clear"}`;
    },
  };
}

export function planRoutesTool(ctx: ToolContext): AgentTool<{ from: { lng: number; lat: number }; to: { lng: number; lat: number }; toLabel: string; mode: "walk" | "ride"; stepFree?: boolean; departInMinutes?: number }> {
  return {
    name: "plan_routes",
    description:
      "Find and safety-score candidate routes. Every 100 m is scored for lighting, footpaths, open shops at that hour, homes facing the street, isolation, police distance, reports and weather. Walks over 15 km are not scored; suggest a ride instead. Returns a planId and the routes, recommended first.",
    parameters: S.obj(
      {
        from: pointSchema,
        to: pointSchema,
        toLabel: S.str("Short name of the destination, as the traveller would say it"),
        mode: S.enum(["walk", "ride"], "walk, or ride for a cab or auto"),
        stepFree: S.bool("Avoid steps and rough surfaces (wheelchair, walker, stroller, elderly)"),
        departInMinutes: S.int("Minutes from now, 0 to leave now"),
      },
      ["from", "to", "toLabel", "mode"],
    ),
    args: z.object({
      from: z.object({ lng, lat }),
      to: z.object({ lng, lat }),
      toLabel: z.string().trim().min(1).max(120),
      mode: z.enum(["walk", "ride"]),
      stepFree: z.boolean().optional(),
      departInMinutes: z.coerce.number().int().min(0).max(7 * 24 * 60).optional(),
    }),
    run: async (a) => {
      const from: LngLat = [a.from.lng, a.from.lat];
      const to: LngLat = [a.to.lng, a.to.lat];
      const d = haversine(from, to);
      if (d < 30) return { error: "Start and destination are the same place" };
      if (d > 150_000) return { error: "Destination is too far for city navigation" };
      const departAt = new Date(ctx.now.getTime() + (a.departInMinutes ?? 0) * 60_000);
      const plan = await planRoutes(from, to, a.mode, departAt, { stepFree: a.stepFree });
      const planId = `p${ctx.plans.size + 1}`;
      ctx.plans.set(planId, { plan, from, to, toLabel: a.toLabel });
      return {
        planId,
        mode: plan.mode,
        straightLineKm: Math.round(d / 100) / 10,
        routes: plan.routes.map(routeBrief),
        advice: plan.advice ?? null,
        dataNote: plan.dataNote ?? null,
        weather: plan.weather,
      };
    },
    describe: (a, r) => {
      const out = r as { routes?: unknown[]; error?: string };
      if (out.error) return `Route planning: ${out.error}`;
      return `Planned ${a.mode === "ride" ? "ride" : "walking"} routes to ${a.toLabel}: ${out.routes?.length ?? 0} safety-scored`;
    },
  };
}

export function findHelpTool(ctx: ToolContext): AgentTool<{ lng: number; lat: number }> {
  return {
    name: "find_help",
    description: "Nearest police stations, hospitals, pharmacies and petrol pumps to a point, with distance and whether each is open now: places to go for help or to wait safely.",
    parameters: pointSchema,
    args: z.object({ lng, lat }),
    run: async ({ lng, lat }) => {
      const h = await helpNear([lng, lat], ctx.now);
      return { police: h.police.slice(0, 2).map(helpBrief), hospitals: h.hospitals.slice(0, 2).map(helpBrief), pharmacies: h.pharmacies.slice(0, 2).map(helpBrief), fuel: h.fuel.slice(0, 1).map(helpBrief) };
    },
    describe: (_a, r) => {
      const h = r as { police: { name: string; metres: number }[] };
      return h.police[0] ? `Found help nearby: ${h.police[0].name}, ${round(h.police[0].metres, 10)} m` : "Looked for police and hospitals nearby";
    },
  };
}

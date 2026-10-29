"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type Map as MLMap, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LngLat } from "@/lib/geo";
import { scoreColor } from "@/lib/safety/factors";

export interface MapRoute {
  id: string;
  coordinates: LngLat[];
  /** Coloured stretches by safety score; omitted for unscored (ride) routes. */
  segments?: { coordinates: LngLat[]; score: number }[];
}

export interface MapMarker {
  id: string;
  point: LngLat;
  kind: "weak" | "report" | "police" | "hospital" | "dest" | "start" | "safe" | "place" | "person" | "sos";
  label?: string;
}

interface Props {
  routes?: MapRoute[];
  selectedId?: string | null;
  onSelectRoute?: (id: string) => void;
  user?: { point: LngLat; accuracy?: number } | null;
  trail?: LngLat[];
  markers?: MapMarker[];
  onMapClick?: (p: LngLat) => void;
  /** Change this to re-fit the view to the current routes/markers. */
  fitKey?: string | number;
  followUser?: boolean;
  className?: string;
}

const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/positron";
// A dark basemap at night is easier on the eyes and doesn't light up the face in a dark street.
const DARK_STYLE_URL = process.env.NEXT_PUBLIC_MAP_DARK_STYLE_URL || "https://tiles.openfreemap.org/styles/dark";

function isDark() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}
const INDIA_CENTER: LngLat = [78.9629, 22.5937];

// Used if the tile style cannot load (offline), so routes and markers still draw.
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#eef2f5" } }],
};


// Lucide icon paths, so pins match the rest of the interface (no emoji or font glyphs).
const ICON = {
  alert: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  flag: '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.3 2 1.3 0 2.5-.4 3.3-.9a1 1 0 0 1 1.4.9v10a1 1 0 0 1-.4.8 6 6 0 0 1-4.3 1.2c-2.3 0-4.3-2-7.3-2a6 6 0 0 0-4 1.5"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  dest: '<path d="M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  start: '<circle cx="12" cy="12" r="4" fill="currentColor"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  dot: '<circle cx="12" cy="12" r="3" fill="currentColor"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>',
};

const MARKER_STYLE: Record<MapMarker["kind"], { bg: string; icon: string }> = {
  weak: { bg: "#c81e3c", icon: ICON.alert },
  report: { bg: "#7c3aed", icon: ICON.flag },
  police: { bg: "#1f5fbf", icon: ICON.shield },
  hospital: { bg: "#b9173a", icon: ICON.plus },
  dest: { bg: "#5b3fd6", icon: ICON.dest },
  start: { bg: "#0f7a55", icon: ICON.start },
  safe: { bg: "#0f7a55", icon: ICON.check },
  place: { bg: "#6b6884", icon: ICON.dot },
  person: { bg: "#5b3fd6", icon: ICON.user },
  sos: { bg: "#e11d48", icon: ICON.alert },
};

const emptyFC = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });

export default function MapView({
  routes = [],
  selectedId,
  onSelectRoute,
  user,
  trail,
  markers = [],
  onMapClick,
  fitKey,
  followUser,
  className = "",
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markerObjs = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  // Bumped whenever the style is replaced (theme change), so data layers are drawn again.
  const [styleVersion, setStyleVersion] = useState(0);
  const handlers = useRef({ onSelectRoute, onMapClick });
  handlers.current = { onSelectRoute, onMapClick };

  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: isDark() ? DARK_STYLE_URL : STYLE_URL,
      center: INDIA_CENTER,
      zoom: 4,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    let fellBack = false;
    map.on("error", (e) => {
      // A failed style load leaves an empty map; swap in the minimal style once.
      if (!fellBack && !map.isStyleLoaded() && String(e.error?.message ?? "").match(/style|fetch|Failed/i)) {
        fellBack = true;
        map.setStyle(FALLBACK_STYLE);
      }
    });

    const setup = () => {
      if (map.getSource("routes")) return;
      map.addSource("routes", { type: "geojson", data: emptyFC() });
      map.addSource("segments", { type: "geojson", data: emptyFC() });
      map.addSource("trail", { type: "geojson", data: emptyFC() });
      map.addSource("user", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "routes-alt",
        type: "line",
        source: "routes",
        filter: ["!=", ["get", "selected"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#94a3b8", "line-width": 5, "line-opacity": 0.8 },
      });
      map.addLayer({
        id: "routes-casing",
        type: "line",
        source: "routes",
        filter: ["==", ["get", "selected"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 10 },
      });
      map.addLayer({
        id: "routes-selected",
        type: "line",
        source: "routes",
        filter: ["==", ["get", "selected"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#5b3fd6", "line-width": 6 },
      });
      map.addLayer({
        id: "segments",
        type: "line",
        source: "segments",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 6 },
      });
      map.addLayer({
        id: "trail",
        type: "line",
        source: "trail",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#7c5cff", "line-width": 4, "line-dasharray": [1, 1.5] },
      });
      map.addLayer({
        id: "user-accuracy",
        type: "circle",
        source: "user",
        paint: {
          "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 10, ["/", ["get", "acc"], 150], 20, ["*", ["get", "acc"], 6.5]],
          "circle-color": "#2563eb",
          "circle-opacity": 0.12,
        },
      });
      map.addLayer({
        id: "user-dot",
        type: "circle",
        source: "user",
        paint: { "circle-radius": 8, "circle-color": "#2563eb", "circle-stroke-color": "#fff", "circle-stroke-width": 3 },
      });
      map.on("click", "routes-alt", (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) handlers.current.onSelectRoute?.(String(id));
      });
      map.on("mouseenter", "routes-alt", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "routes-alt", () => (map.getCanvas().style.cursor = ""));
      setReady(true);
      setStyleVersion((v) => v + 1);
    };
    map.on("style.load", setup);
    let dark = isDark();
    const onTheme = () => {
      if (isDark() === dark) return;
      dark = isDark();
      map.setStyle(dark ? DARK_STYLE_URL : STYLE_URL);
    };
    window.addEventListener("safenav:theme", onTheme);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => setTimeout(onTheme, 0);
    mq.addEventListener("change", onScheme);
    // Keep the attribution as a small (i) button rather than a panel covering the map.
    map.once("load", () => container.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
    map.on("click", (e) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: ["routes-alt"] });
      if (!hit.length) handlers.current.onMapClick?.([e.lngLat.lng, e.lngLat.lat]);
    });

    return () => {
      window.removeEventListener("safenav:theme", onTheme);
      mq.removeEventListener("change", onScheme);
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Routes and coloured safety segments.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const selected = routes.find((r) => r.id === selectedId) ?? routes[0];
    (map.getSource("routes") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: routes.map((r) => ({
        type: "Feature",
        properties: { id: r.id, selected: r === selected },
        geometry: { type: "LineString", coordinates: r.coordinates },
      })),
    });
    (map.getSource("segments") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: (selected?.segments ?? []).map((s) => ({
        type: "Feature",
        properties: { color: scoreColor(s.score) },
        geometry: { type: "LineString", coordinates: s.coordinates },
      })),
    });
    if (map.getLayer("routes-alt")) map.moveLayer("routes-alt", "routes-casing");
  }, [routes, selectedId, ready, styleVersion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("trail") as GeoJSONSource).setData(
      trail && trail.length > 1
        ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: trail } }
        : emptyFC(),
    );
  }, [trail, ready, styleVersion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("user") as GeoJSONSource).setData(
      user
        ? { type: "Feature", properties: { acc: Math.max(5, user.accuracy ?? 20) }, geometry: { type: "Point", coordinates: user.point } }
        : emptyFC(),
    );
    if (user && followUser) map.easeTo({ center: user.point, zoom: Math.max(map.getZoom(), 16), duration: 600 });
  }, [user, followUser, ready, styleVersion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerObjs.current.forEach((m) => m.remove());
    markerObjs.current = markers.map((m) => {
      const el = document.createElement("div");
      const s = MARKER_STYLE[m.kind];
      el.className = "map-pin";
      el.style.background = s.bg;
      el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${s.icon}</svg>`;
      if (m.label) el.title = m.label;
      el.setAttribute("aria-label", m.label ?? m.kind);
      const marker = new maplibregl.Marker({ element: el }).setLngLat(m.point);
      if (m.label) marker.setPopup(new maplibregl.Popup({ offset: 14, closeButton: false }).setText(m.label));
      return marker.addTo(map);
    });
  }, [markers]);

  // Fit to everything relevant when fitKey changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const pts: LngLat[] = [...routes.flatMap((r) => r.coordinates), ...markers.map((m) => m.point), ...(trail ?? [])];
    if (user) pts.push(user.point);
    if (!pts.length) return;
    if (pts.length === 1) {
      map.jumpTo({ center: pts[0], zoom: 15 });
      return;
    }
    const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
    for (const p of pts) b.extend(p);
    map.fitBounds(b, { padding: { top: 60, bottom: 60, left: 40, right: 40 }, maxZoom: 16, duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, ready]);

  return <div ref={container} className={`h-full w-full ${className}`} role="region" aria-label="Map" />;
}

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
  kind: "weak" | "report" | "police" | "hospital" | "dest" | "start";
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

const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/liberty";
const INDIA_CENTER: LngLat = [78.9629, 22.5937];

// Used if the tile style cannot load (offline), so routes and markers still draw.
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#eef2f5" } }],
};


const MARKER_STYLE: Record<MapMarker["kind"], { bg: string; text: string }> = {
  weak: { bg: "#dc2626", text: "!" },
  report: { bg: "#7c3aed", text: "•" },
  police: { bg: "#1d4ed8", text: "P" },
  hospital: { bg: "#be123c", text: "H" },
  dest: { bg: "#0f172a", text: "◎" },
  start: { bg: "#0f766e", text: "●" },
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
  const handlers = useRef({ onSelectRoute, onMapClick });
  handlers.current = { onSelectRoute, onMapClick };

  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: STYLE_URL,
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
        paint: { "line-color": "#2563eb", "line-width": 6 },
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
        paint: { "line-color": "#7c3aed", "line-width": 4, "line-dasharray": [1, 1.5] },
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
    };
    map.on("style.load", setup);
    map.on("click", (e) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: ["routes-alt"] });
      if (!hit.length) handlers.current.onMapClick?.([e.lngLat.lng, e.lngLat.lat]);
    });

    return () => {
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
  }, [routes, selectedId, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("trail") as GeoJSONSource).setData(
      trail && trail.length > 1
        ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: trail } }
        : emptyFC(),
    );
  }, [trail, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("user") as GeoJSONSource).setData(
      user
        ? { type: "Feature", properties: { acc: Math.max(5, user.accuracy ?? 20) }, geometry: { type: "Point", coordinates: user.point } }
        : emptyFC(),
    );
    if (user && followUser) map.easeTo({ center: user.point, zoom: Math.max(map.getZoom(), 16), duration: 600 });
  }, [user, followUser, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerObjs.current.forEach((m) => m.remove());
    markerObjs.current = markers.map((m) => {
      const el = document.createElement("div");
      const s = MARKER_STYLE[m.kind];
      el.className = "map-pin";
      el.style.background = s.bg;
      el.textContent = s.text;
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

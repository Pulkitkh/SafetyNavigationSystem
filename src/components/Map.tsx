"use client";

import dynamic from "next/dynamic";

/** MapLibre touches `window` on import, so the map only renders in the browser. */
const Map = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-surface-2" aria-label="Loading map" />,
});

export default Map;
export type { MapRoute, MapMarker, MapZone } from "./MapView";

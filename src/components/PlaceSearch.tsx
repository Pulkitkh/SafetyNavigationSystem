"use client";

import { History, LocateFixed, MapPin, Search, Star, type LucideIcon, Building2, BusFront, Hospital, Landmark, ShoppingBag, Utensils, Route as RoadIcon, TrainFront, Shield, GraduationCap } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api, formatDistance } from "@/lib/client/api";
import { store, type SavedPlace } from "@/lib/client/store";
import type { LngLat } from "@/lib/geo";

export interface PlaceValue {
  label: string;
  detail?: string;
  point: LngLat;
  current?: boolean;
  kind?: string;
  distance?: number;
}

interface Props {
  label: string;
  placeholder: string;
  value: PlaceValue | null;
  onChange: (v: PlaceValue | null) => void;
  near?: LngLat | null;
  allowCurrent?: boolean;
  currentPoint?: LngLat | null;
  /** Offer "Choose on map"; the parent then takes a tap on the map. */
  onPickOnMap?: () => void;
  icon?: LucideIcon;
  iconClass?: string;
}

interface ApiPlace {
  label: string;
  detail: string;
  lng: number;
  lat: number;
  kind?: string;
  distance?: number;
}

function kindIcon(kind?: string): LucideIcon {
  if (!kind) return MapPin;
  if (/metro|railway|station|halt/i.test(kind)) return TrainFront;
  if (/bus/i.test(kind)) return BusFront;
  if (/hospital|clinic|pharmacy/i.test(kind)) return Hospital;
  if (/police/i.test(kind)) return Shield;
  if (/mall|shop|market|supermarket/i.test(kind)) return ShoppingBag;
  if (/restaurant|café|food/i.test(kind)) return Utensils;
  if (/road/i.test(kind)) return RoadIcon;
  if (/school|college|university/i.test(kind)) return GraduationCap;
  if (/attraction|worship/i.test(kind)) return Landmark;
  if (/apartment|residence|hotel/i.test(kind)) return Building2;
  return MapPin;
}

type Option =
  | { type: "place"; place: PlaceValue; section?: string; saved?: boolean }
  | { type: "deep" }
  | { type: "map" };

export function PlaceSearch({ label, placeholder, value, onChange, near, allowCurrent, currentPoint, onPickOnMap, icon: InputIcon = Search, iconClass = "text-slate-400" }: Props) {
  const [text, setText] = useState(value?.label ?? "");
  const [results, setResults] = useState<PlaceValue[]>([]);
  const [searchedDeep, setSearchedDeep] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [active, setActive] = useState(-1);
  const [book, setBook] = useState(() => ({ favorites: [] as SavedPlace[], recent: [] as SavedPlace[] }));
  const listId = useId();
  const seq = useRef(0);

  // Sync from the parent, except when the value was cleared by the person typing:
  // then the text they are typing must stay.
  const clearedByTyping = useRef(false);
  useEffect(() => {
    if (value) setText(value.label);
    else if (!clearedByTyping.current) setText("");
    clearedByTyping.current = false;
  }, [value]);
  useEffect(() => {
    const sync = () => setBook(store.places());
    sync();
    window.addEventListener("safenav:places", sync);
    return () => window.removeEventListener("safenav:places", sync);
  }, [open]);

  const run = async (q: string, deep: boolean) => {
    const mine = ++seq.current;
    setBusy(true);
    try {
      const params = new URLSearchParams({ q });
      if (deep) params.set("deep", "1");
      if (near) {
        params.set("lng", String(near[0]));
        params.set("lat", String(near[1]));
      }
      const res = await api<{ places: ApiPlace[]; degraded?: boolean }>(`/api/geocode/search?${params}`);
      if (mine !== seq.current) return;
      setResults(res.places.map((p) => ({ label: p.label, detail: p.detail, point: [p.lng, p.lat], kind: p.kind, distance: p.distance })));
      setDegraded(!!res.degraded);
      setError(null);
      if (deep) setSearchedDeep(q);
    } catch (err) {
      if (mine === seq.current) setError((err as Error).message);
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  };

  // Search as you type (fast index). The full search runs only when asked for.
  useEffect(() => {
    const q = text.trim();
    if (!open || q.length < 2 || q === value?.label) {
      setResults([]);
      setError(null);
      setDegraded(false);
      return;
    }
    const t = setTimeout(() => void run(q, false), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, open, value?.label, near?.[0], near?.[1]]);

  const q = text.trim();
  const typing = q.length >= 2 && q !== value?.label;
  const saved = (p: SavedPlace) => book.favorites.some((f) => Math.abs(f.point[0] - p.point[0]) < 1e-4 && Math.abs(f.point[1] - p.point[1]) < 1e-4);

  const options: Option[] = [];
  if (!typing) {
    if (allowCurrent && currentPoint) options.push({ type: "place", place: { label: "Your current location", point: currentPoint, current: true }, section: "" });
    book.favorites.slice(0, 5).forEach((p, i) => options.push({ type: "place", place: p, section: i === 0 ? "Saved" : undefined, saved: true }));
    book.recent
      .filter((r) => !saved(r))
      .slice(0, 5)
      .forEach((p, i) => options.push({ type: "place", place: p, section: i === 0 ? "Recent" : undefined }));
  } else {
    results.forEach((p) => options.push({ type: "place", place: p, saved: saved(p) }));
    if (searchedDeep !== q) options.push({ type: "deep" });
  }
  if (onPickOnMap) options.push({ type: "map" });

  const pick = (p: PlaceValue) => {
    onChange(p);
    setText(p.label);
    setOpen(false);
    setActive(-1);
    if (!p.current) store.addRecent({ label: p.label, detail: p.detail, point: p.point });
  };

  const choose = (o: Option) => {
    if (o.type === "place") pick(o.place);
    else if (o.type === "deep") void run(q, true);
    else {
      setOpen(false);
      onPickOnMap?.();
    }
  };

  const noResults = typing && !busy && !error && results.length === 0;

  return (
    <div className="relative">
      <label className="sr-only" htmlFor={`${listId}-input`}>
        {label}
      </label>
      <InputIcon className={`pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 ${iconClass}`} aria-hidden />
      <input
        id={`${listId}-input`}
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        enterKeyHint="search"
        className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-10 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-100"
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(-1);
          setSearchedDeep(null);
          if (value) {
            clearedByTyping.current = true;
            onChange(null);
          }
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(options.length - 1, a + 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
          else if (e.key === "Enter") {
            e.preventDefault();
            if (active >= 0 && options[active]) choose(options[active]);
            else if (typing) void run(q, true); // Enter = search everywhere
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {busy ? (
        <span className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-slate-300 border-t-brand-500" aria-hidden />
      ) : (
        text && (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setText("");
              onChange(null);
              setOpen(true);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-lg leading-none text-slate-400 hover:bg-slate-100"
          >
            ×
          </button>
        )
      )}
      {open && (options.length > 0 || error) && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-2 max-h-[min(24rem,60dvh)] w-full overflow-auto rounded-2xl border border-slate-200 bg-white py-1.5 shadow-xl shadow-slate-900/10">
          {error && <li className="px-4 py-2 text-sm text-red-700">{error}</li>}
          {degraded && !error && <li className="px-4 py-2 text-xs text-amber-800">Quick search is busy. Press Enter or “Search all places”.</li>}
          {noResults && !degraded && <li className="px-4 py-2 text-sm text-slate-500">No quick matches. Try a full search, a nearby landmark, or pick it on the map.</li>}
          {options.map((o, i) => {
            const activeCls = i === active ? "bg-brand-50" : "hover:bg-slate-50";
            if (o.type === "deep" || o.type === "map") {
              const Icon = o.type === "deep" ? Search : MapPin;
              return (
                <li
                  key={o.type}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(o);
                  }}
                  className={`flex cursor-pointer items-center gap-3 border-t border-slate-100 px-4 py-2.5 text-sm font-medium text-brand-700 ${activeCls}`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {o.type === "deep" ? <span className="truncate">Search all places for “{q}”</span> : "Choose on map"}
                </li>
              );
            }
            const p = o.place;
            const Icon = p.current ? LocateFixed : o.section === "Recent" || (!typing && !o.saved) ? History : o.saved ? Star : kindIcon(p.kind);
            return (
              <li key={`${p.label}-${p.point.join(",")}-${i}`} role="option" aria-selected={i === active}>
                {o.section && <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{o.section}</p>}
                <div
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(p);
                  }}
                  className={`flex cursor-pointer items-center gap-3 px-4 py-2 ${activeCls}`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${p.current ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-600"}`}>
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-sm font-medium ${p.current ? "text-brand-700" : "text-slate-900"}`}>{p.label}</div>
                    {(p.detail || p.kind) && (
                      <div className="truncate text-xs text-slate-500">{[p.kind, p.detail].filter(Boolean).join(" · ")}</div>
                    )}
                  </div>
                  {p.distance != null && <span className="shrink-0 text-xs tabular-nums text-slate-400">{formatDistance(p.distance)}</span>}
                  {!p.current && (
                    <button
                      type="button"
                      aria-label={o.saved ? `Remove ${p.label} from saved places` : `Save ${p.label}`}
                      aria-pressed={!!o.saved}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        store.toggleFavorite({ label: p.label, detail: p.detail, point: p.point });
                      }}
                      className="shrink-0 rounded-full p-1.5 text-slate-300 hover:bg-amber-50 hover:text-amber-500"
                    >
                      <Star className={`h-4 w-4 ${o.saved ? "fill-amber-400 text-amber-400" : ""}`} aria-hidden />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

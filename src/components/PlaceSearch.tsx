"use client";

import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { LngLat } from "@/lib/geo";

export interface PlaceValue {
  label: string;
  detail?: string;
  point: LngLat;
  current?: boolean;
}

interface Props {
  label: string;
  placeholder: string;
  value: PlaceValue | null;
  onChange: (v: PlaceValue | null) => void;
  near?: LngLat | null;
  allowCurrent?: boolean;
  currentPoint?: LngLat | null;
}

export function PlaceSearch({ label, placeholder, value, onChange, near, allowCurrent, currentPoint }: Props) {
  const [text, setText] = useState(value?.label ?? "");
  const [results, setResults] = useState<PlaceValue[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const seq = useRef(0);

  useEffect(() => setText(value?.label ?? ""), [value]);

  useEffect(() => {
    const q = text.trim();
    if (!open || q.length < 3 || q === value?.label) {
      setResults([]);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const params = new URLSearchParams({ q });
        if (near) {
          params.set("lng", String(near[0]));
          params.set("lat", String(near[1]));
        }
        const { places } = await api<{ places: { label: string; detail: string; lng: number; lat: number }[] }>(`/api/geocode/search?${params}`);
        if (mine === seq.current) {
          setResults(places.map((p) => ({ label: p.label, detail: p.detail, point: [p.lng, p.lat] })));
          setError(null);
        }
      } catch (err) {
        if (mine === seq.current) setError((err as Error).message);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [text, open, near, value?.label]);

  const options: PlaceValue[] = [
    ...(allowCurrent && currentPoint ? [{ label: "Your current location", point: currentPoint, current: true }] : []),
    ...results,
  ];

  const pick = (p: PlaceValue) => {
    onChange(p);
    setText(p.label);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div className="relative">
      <label className="sr-only" htmlFor={`${listId}-input`}>
        {label}
      </label>
      <input
        id={`${listId}-input`}
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[15px] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          if (value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(options.length - 1, a + 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
          else if (e.key === "Enter" && active >= 0 && options[active]) {
            e.preventDefault();
            pick(options[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {busy && <span className="absolute right-3 top-3 h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-500" aria-hidden />}
      {open && (options.length > 0 || error) && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {error && <li className="px-3 py-2 text-sm text-red-700">{error}</li>}
          {options.map((p, i) => (
            <li
              key={`${p.label}-${p.point.join(",")}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              className={`cursor-pointer px-3 py-2 ${i === active ? "bg-brand-50" : "hover:bg-slate-50"}`}
            >
              <div className={`text-sm font-medium ${p.current ? "text-brand-600" : "text-slate-900"}`}>{p.label}</div>
              {p.detail && <div className="truncate text-xs text-slate-500">{p.detail}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

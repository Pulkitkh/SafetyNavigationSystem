"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { store } from "@/lib/client/store";

const ITEMS = [
  { href: "/", label: "Plan", icon: "M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" },
  { href: "/journey", label: "Journey", icon: "M3 12h4l3-8 4 16 3-8h4" },
  { href: "/report", label: "Report", icon: "M4 21V4h11l1 2h4v10h-7l-1-2H6v7z" },
  { href: "/contacts", label: "Contacts", icon: "M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21c0-3.3 3.6-6 8-6s8 2.7 8 6" },
  { href: "/help", label: "Help", icon: "M12 3v18M3 12h18" },
];

export function BottomNav() {
  const path = usePathname();
  const [journey, setJourney] = useState(false);
  useEffect(() => setJourney(!!store.journey()), [path]);
  if (path.startsWith("/t/")) return null;
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Main"
    >
      <ul className="mx-auto flex max-w-lg justify-around">
        {ITEMS.map((item) => {
          const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex flex-col items-center gap-0.5 px-3 py-2 text-[11px] font-medium ${active ? "text-brand-600" : "text-slate-500"}`}
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={item.icon} />
                </svg>
                {item.label}
                {item.href === "/journey" && journey && <span className="absolute right-3 top-1.5 h-2 w-2 rounded-full bg-green-500" aria-label="Journey in progress" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

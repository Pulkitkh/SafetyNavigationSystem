"use client";

import { LifeBuoy, Navigation, Route, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { store } from "@/lib/client/store";

const ITEMS: { href: string; label: string; icon: LucideIcon; match?: string[] }[] = [
  { href: "/", label: "Plan", icon: Navigation },
  { href: "/journey", label: "Journey", icon: Route },
  { href: "/safety", label: "Safety", icon: ShieldCheck, match: ["/safety", "/area", "/timer", "/fake-call", "/report"] },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/help", label: "Help", icon: LifeBuoy },
];

export function BottomNav() {
  const path = usePathname();
  const [journey, setJourney] = useState(false);
  useEffect(() => setJourney(!!store.journey()), [path]);
  if (path.startsWith("/t/")) return null;
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/95 backdrop-blur-md md:inset-x-auto md:bottom-4 md:left-1/2 md:-translate-x-1/2 md:rounded-2xl md:border md:shadow-lg"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Main"
    >
      <ul className="mx-auto flex max-w-lg justify-around px-1 md:gap-2 md:px-3">
        {ITEMS.map(({ href, label, icon: Icon, match }) => {
          const active = href === "/" ? path === "/" : (match ?? [href]).some((m) => path.startsWith(m));
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`relative flex flex-col items-center gap-0.5 px-3 pb-1.5 pt-2 text-[11px] font-medium transition ${active ? "text-brand-700" : "text-slate-500 hover:text-slate-800"}`}
              >
                <span className={`flex h-8 w-14 items-center justify-center rounded-full transition ${active ? "bg-brand-100" : ""}`}>
                  <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.3 : 1.8} aria-hidden />
                </span>
                {label}
                {href === "/journey" && journey && <span className="absolute right-4 top-2 h-2.5 w-2.5 rounded-full border-2 border-white bg-green-500" aria-label="Journey in progress" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** `icon` is a rendered element (e.g. `<Timer />`) so server pages can pass it too. */
export function PageHeader({ title, subtitle, action, icon }: { title: string; subtitle?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3 px-4 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <div className="flex items-start gap-3">
        {icon && (
          <span className="brand-gradient mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white shadow-md shadow-brand-500/30 [&>svg]:h-5 [&>svg]:w-5" aria-hidden>
            {icon}
          </span>
        )}
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
        </div>
      </div>
      {action}
    </header>
  );
}

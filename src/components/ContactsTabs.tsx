"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Switches between the people you trust and the people who trust you. */
export function ContactsTabs({ sosCount = 0 }: { sosCount?: number }) {
  const path = usePathname();
  const tabs = [
    { href: "/contacts", label: "My contacts" },
    { href: "/people", label: "People I protect" },
  ];
  return (
    <nav aria-label="Contacts" className="mx-4 mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1">
      {tabs.map((t) => {
        const on = path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`relative flex min-h-11 items-center justify-center rounded-xl text-sm font-bold transition-colors ${on ? "bg-surface text-brand-ink shadow-card" : "text-ink-2 hover:text-ink"}`}
          >
            {t.label}
            {t.href === "/people" && sosCount > 0 && (
              <span className="ml-1.5 rounded-full bg-sos px-1.5 py-0.5 text-[11px] font-extrabold text-white" aria-label={`${sosCount} SOS`}>
                SOS
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

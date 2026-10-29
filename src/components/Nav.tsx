"use client";

import { ChevronLeft, LifeBuoy, Navigation, Radio, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSos } from "@/components/Sos";
import { store } from "@/lib/client/store";

const ITEMS: { href: string; label: string; icon: LucideIcon; match?: string[] }[] = [
  { href: "/", label: "Plan", icon: Navigation, match: ["/journey"] },
  { href: "/safety", label: "Safety", icon: ShieldCheck, match: ["/safety", "/area", "/timer", "/fake-call", "/report", "/account", "/app"] },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/help", label: "Help", icon: LifeBuoy },
];

/** Pages opened by guardians (live tracking, invite) don't show the traveller's controls. */
export function isGuardianPage(path: string) {
  return path.startsWith("/t/") || path.startsWith("/g/");
}

function NavLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: LucideIcon; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-xs font-semibold transition-colors ${active ? "text-brand-ink" : "text-ink-3 hover:text-ink"}`}
    >
      <span className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors ${active ? "bg-brand-soft" : ""}`}>
        <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 2} aria-hidden />
      </span>
      {label}
    </Link>
  );
}

export function BottomNav() {
  const path = usePathname();
  if (isGuardianPage(path)) return null;
  const isActive = (href: string, match?: string[]) => (href === "/" ? path === "/" || (match ?? []).some((m) => path.startsWith(m)) : (match ?? [href]).some((m) => path.startsWith(m)));
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-xl md:inset-x-auto md:bottom-4 md:left-1/2 md:w-[520px] md:-translate-x-1/2 md:rounded-3xl md:border md:shadow-float"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Main"
    >
      <ul className="mx-auto flex max-w-lg items-end px-2 pb-1 pt-1">
        {ITEMS.slice(0, 2).map((i) => (
          <li key={i.href} className="flex flex-1">
            <NavLink {...i} active={isActive(i.href, i.match)} />
          </li>
        ))}
        <li className="flex w-[84px] shrink-0 justify-center">
          <SosHoldButton />
        </li>
        {ITEMS.slice(2).map((i) => (
          <li key={i.href} className="flex flex-1">
            <NavLink {...i} active={isActive(i.href, i.match)} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

const HOLD_MS = 1000;

/**
 * Press and hold for one second. Holding (rather than tapping) stops pocket
 * and accidental presses; the ring fills so it is clear what's happening.
 * Keyboard: hold Enter or Space.
 */
function SosHoldButton() {
  const { trigger, active } = useSos();
  const [progress, setProgress] = useState(0);
  const [hint, setHint] = useState(false);
  const frame = useRef<number | null>(null);
  const progressRef = useRef(0);

  const start = () => {
    if (active || frame.current != null) return;
    navigator.vibrate?.(30);
    const t0 = performance.now();
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / HOLD_MS);
      progressRef.current = p;
      setProgress(p);
      if (p >= 1) {
        frame.current = null;
        setProgress(0);
        trigger("manual");
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  const cancel = () => {
    if (frame.current != null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
      if (progressRef.current < 0.3) {
        setHint(true);
        setTimeout(() => setHint(false), 2400);
      }
    }
    progressRef.current = 0;
    setProgress(0);
  };

  const C = 2 * Math.PI * 33;
  return (
    <div className="relative -mt-7">
      {hint && (
        <div role="status" className="fade-in absolute bottom-full left-1/2 mb-3 -translate-x-1/2 whitespace-nowrap rounded-xl bg-ink px-3 py-2 text-sm font-semibold text-canvas shadow-float">
          Press and hold to send SOS
        </div>
      )}
      <button
        type="button"
        onPointerDown={start}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
            e.preventDefault();
            start();
          }
        }}
        onKeyUp={cancel}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="SOS. Press and hold for one second to alert your trusted contacts with your live location"
        className={`relative flex h-[72px] w-[72px] select-none flex-col items-center justify-center rounded-full bg-sos text-white shadow-[0_10px_24px_-8px_var(--sos)] ring-4 ring-surface touch-none ${progress === 0 ? "sos-pulse" : ""}`}
        style={{ transform: progress > 0 ? `scale(${1 + progress * 0.06})` : undefined }}
      >
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 72 72" aria-hidden>
          <circle cx="36" cy="36" r="33" fill="none" stroke="rgb(255 255 255 / 0.25)" strokeWidth="4" />
          <circle cx="36" cy="36" r="33" fill="none" stroke="white" strokeWidth="4" strokeDasharray={`${progress * C} ${C}`} strokeLinecap="round" />
        </svg>
        <span className="text-lg font-extrabold leading-none tracking-wide">SOS</span>
        <span className="mt-0.5 text-[10px] font-semibold leading-none opacity-90">hold</span>
      </button>
    </div>
  );
}

/** "Journey in progress" shortcut shown on every page while a journey runs. */
export function JourneyPill() {
  const path = usePathname();
  const [journey, setJourney] = useState<{ dest: string; mode: "walk" | "ride" } | null>(null);
  useEffect(() => {
    const j = store.journey();
    setJourney(j ? { dest: j.destLabel, mode: j.mode } : null);
  }, [path]);
  if (!journey || path.startsWith("/journey") || isGuardianPage(path)) return null;
  return (
    <Link
      href="/journey"
      className="rise fixed left-1/2 z-40 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2.5 rounded-full bg-good px-4 py-2.5 text-sm font-bold text-white shadow-float dark:text-[#062217]"
      style={{ bottom: "calc(6.25rem + env(safe-area-inset-bottom))" }}
    >
      <Radio className="h-4 w-4 shrink-0 animate-pulse" aria-hidden />
      <span className="truncate">
        {journey.mode === "ride" ? "Ride" : "Walk"} to {journey.dest} · live
      </span>
    </Link>
  );
}

/** Page title block. `icon` is a rendered element (e.g. `<Timer />`) so server pages can pass it too. */
export function PageHeader({
  title,
  subtitle,
  action,
  icon,
  back,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  back?: string;
}) {
  return (
    <header className="pt-safe flex items-start justify-between gap-3 px-4 pb-4">
      <div className="flex min-w-0 items-start gap-3">
        {back && (
          <Link href={back} aria-label="Back" className="tap -ml-2 mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2">
            <ChevronLeft className="h-6 w-6" aria-hidden />
          </Link>
        )}
        {icon && !back && (
          <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand-soft-ink [&>svg]:h-[22px] [&>svg]:w-[22px]" aria-hidden>
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-[1.375rem] font-extrabold leading-tight tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="mt-1 text-sm leading-snug text-ink-2">{subtitle}</p>}
        </div>
      </div>
      {action}
    </header>
  );
}

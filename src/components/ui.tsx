"use client";

import { ChevronRight, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { scoreColor } from "@/lib/safety/factors";

/** Tones carry meaning: brand = feature, good = safer, caution = take care, danger = avoid, sos = emergency only. */
export type Tone = "brand" | "good" | "caution" | "danger" | "info" | "neutral" | "sos";

const TILE: Record<Tone, string> = {
  brand: "bg-brand-soft text-brand-soft-ink",
  good: "bg-good-soft text-good",
  caution: "bg-caution-soft text-caution",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutral: "bg-surface-2 text-ink-2",
  sos: "bg-sos text-white",
};

export function IconTile({ icon: Icon, tone = "brand", size = "md" }: { icon: LucideIcon; tone?: Tone; size?: "sm" | "md" | "lg" }) {
  const box = size === "sm" ? "h-9 w-9 rounded-xl" : size === "lg" ? "h-14 w-14 rounded-2xl" : "h-11 w-11 rounded-2xl";
  const ic = size === "sm" ? "h-[18px] w-[18px]" : size === "lg" ? "h-7 w-7" : "h-[22px] w-[22px]";
  return (
    <span className={`flex shrink-0 items-center justify-center ${box} ${TILE[tone]}`} aria-hidden>
      <Icon className={ic} strokeWidth={2.2} />
    </span>
  );
}

const BADGE: Record<Tone, string> = {
  brand: "bg-brand-soft text-brand-soft-ink",
  good: "bg-good-soft text-good",
  caution: "bg-caution-soft text-caution",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutral: "bg-surface-2 text-ink-2",
  sos: "bg-sos text-white",
};

export function Badge({ tone = "neutral", icon: Icon, children }: { tone?: Tone; icon?: LucideIcon; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold leading-none ${BADGE[tone]}`}>
      {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden />}
      {children}
    </span>
  );
}

export function SectionTitle({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-2 mt-1 flex items-end justify-between gap-2 px-1">
      <h2 id={id} className="text-base font-extrabold tracking-tight text-ink">
        {children}
      </h2>
      {action}
    </div>
  );
}

/** A tappable row: icon, title, description, chevron. Renders a link when `href` is set. */
export function ListRow({
  href,
  onClick,
  icon,
  tone = "brand",
  title,
  text,
  trailing,
  external,
}: {
  href?: string;
  onClick?: () => void;
  icon?: LucideIcon;
  tone?: Tone;
  title: ReactNode;
  text?: ReactNode;
  trailing?: ReactNode;
  external?: boolean;
}) {
  const body = (
    <>
      {icon && <IconTile icon={icon} tone={tone} />}
      <span className="min-w-0 flex-1">
        <span className="block font-bold leading-snug text-ink">{title}</span>
        {text && <span className="mt-0.5 block text-sm leading-snug text-ink-2">{text}</span>}
      </span>
      {trailing ?? ((href || onClick) && <ChevronRight className="h-5 w-5 shrink-0 text-ink-3" aria-hidden />)}
    </>
  );
  const cls = "tap flex w-full min-h-16 items-center gap-3 px-4 py-3 text-left";
  if (href)
    return external ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {body}
      </a>
    ) : (
      <Link href={href} className={cls}>
        {body}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cls}>
        {body}
      </button>
    );
  return <div className={cls.replace("tap ", "")}>{body}</div>;
}

/** Accessible on/off switch with a visible label and description. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  icon,
  tone = "brand",
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={`flex min-h-16 items-center gap-3 px-4 py-3 ${disabled ? "opacity-60" : ""}`}>
      {icon && <IconTile icon={icon} tone={tone} />}
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block font-bold leading-snug text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-sm leading-snug text-ink-2">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-8 w-[52px] shrink-0 rounded-full transition-colors ${checked ? "bg-brand" : "bg-surface-3"}`}
      >
        <span className={`absolute left-0 top-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[24px]" : "translate-x-1"}`} />
        <span className="sr-only">{checked ? "On" : "Off"}</span>
      </button>
    </div>
  );
}

/** Segmented control for 2–4 exclusive options. */
export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: LucideIcon }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-1 rounded-2xl bg-surface-2 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-2 text-sm font-bold transition-colors ${on ? "bg-surface text-brand-ink shadow-card" : "text-ink-2 hover:text-ink"}`}
          >
            {o.icon && <o.icon className="h-4 w-4" aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Circular safety score. Colour and the word below both carry the meaning, never colour alone. */
export function ScoreRing({ score, size = 64, label = "safety" }: { score: number | null; size?: number; label?: string }) {
  const color = scoreColor(score);
  const stroke = Math.max(5, size / 11);
  const r = size / 2 - stroke / 2 - 1;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={score == null ? "Not scored" : `Safety score ${score} out of 100`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        {score != null && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={`${(score / 100) * c} ${c}`} strokeLinecap="round" style={{ transition: "stroke-dasharray 600ms var(--ease-out-soft)" }} />
        )}
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-extrabold text-ink" style={{ fontSize: size * 0.3 }}>
          {score ?? "–"}
        </span>
        {score != null && size >= 56 && <span className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-3">{label}</span>}
      </span>
    </div>
  );
}

export function Callout({ tone = "info", icon: Icon, title, children }: { tone?: Tone; icon?: LucideIcon; title?: ReactNode; children?: ReactNode }) {
  const cls: Record<Tone, string> = {
    brand: "bg-brand-soft text-brand-soft-ink",
    good: "bg-good-soft text-ink",
    caution: "bg-caution-soft text-ink",
    danger: "bg-danger-soft text-ink",
    info: "bg-info-soft text-ink",
    neutral: "bg-surface-2 text-ink-2",
    sos: "bg-sos text-white",
  };
  const iconCls: Record<Tone, string> = { brand: "", good: "text-good", caution: "text-caution", danger: "text-danger", info: "text-info", neutral: "text-ink-3", sos: "" };
  return (
    <div className={`flex gap-3 rounded-2xl p-3.5 text-sm leading-snug ${cls[tone]}`} role={tone === "danger" ? "alert" : undefined}>
      {Icon && <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconCls[tone]}`} aria-hidden />}
      <div className="min-w-0 space-y-1">
        {title && <p className="font-bold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: LucideIcon; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-8 text-center">
      <IconTile icon={icon} size="lg" />
      <p className="mt-3 text-lg font-extrabold text-ink">{title}</p>
      {text && <p className="mt-1 max-w-xs text-sm text-ink-2">{text}</p>}
      {action && <div className="mt-4 w-full max-w-xs">{action}</div>}
    </div>
  );
}

/** Bottom sheet dialog on phones, centred dialog on larger screens. Closes on Escape and scrim tap. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button className="fade-in absolute inset-0 cursor-default" style={{ background: "var(--scrim)" }} onClick={onClose} aria-label="Close" tabIndex={-1} />
      <div ref={ref} className="sheet-in relative max-h-[90dvh] w-full overflow-y-auto rounded-t-[1.75rem] bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:max-w-md md:rounded-3xl">
        <div className="mx-auto -mt-2 mb-3 h-1.5 w-10 rounded-full bg-line-strong md:hidden" aria-hidden />
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-extrabold text-ink">
            {title}
          </h2>
          <button onClick={onClose} aria-label="Close" className="tap -mr-2 flex h-11 w-11 items-center justify-center rounded-full text-ink-2">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A progress ring for "x of y done". */
export function ProgressRing({ done, total, size = 56 }: { done: number; total: number; size?: number }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const p = total ? done / total : 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${done} of ${total} done`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.25)" strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="white" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${p * c} ${c}`} style={{ transition: "stroke-dasharray 600ms var(--ease-out-soft)" }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-extrabold">
        {done}/{total}
      </span>
    </div>
  );
}

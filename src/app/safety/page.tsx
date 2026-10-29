"use client";

import { Check, ChevronRight, Download, Info, LifeBuoy, MessageSquareWarning, PhoneCall, PlayCircle, ScanSearch, ShieldCheck, Timer, UserRound, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { DeviceSettings } from "@/components/DeviceSettings";
import { PageHeader } from "@/components/Nav";
import { useSafetyTimer } from "@/components/SafetyTimer";
import { useSos } from "@/components/Sos";
import { Badge, ListRow, ProgressRing, SectionTitle, type Tone } from "@/components/ui";
import { useSession } from "@/lib/client/hooks";
import { isNativeApp } from "@/lib/client/native";
import { useReadiness } from "@/lib/client/readiness";

const TOOLS: { href: string; title: string; text: string; icon: LucideIcon; tone: Tone }[] = [
  { href: "/area", title: "Is it safe here?", text: "Live check of lights, open places, police and reports around you", icon: ScanSearch, tone: "good" },
  { href: "/timer", title: "Safety timer", text: "Check in by a set time, or SafeNav sends SOS for you", icon: Timer, tone: "info" },
  { href: "/fake-call", title: "Fake incoming call", text: "A realistic call with a voice, to leave an uncomfortable situation", icon: PhoneCall, tone: "brand" },
  { href: "/report", title: "Report an unsafe spot", text: "Warn others and improve everyone's routes", icon: MessageSquareWarning, tone: "danger" },
  { href: "/help", title: "Nearby help and helplines", text: "Police, hospitals, pharmacies and India's emergency numbers", icon: LifeBuoy, tone: "caution" },
];

export default function SafetyPage() {
  const timer = useSafetyTimer();
  const { me } = useSession();
  const { drill } = useSos();
  const readiness = useReadiness();

  return (
    <main id="main" className="mx-auto max-w-lg pb-nav">
      <PageHeader
        title="Safety"
        subtitle="Set up once, and help is one hold away."
        icon={<ShieldCheck />}
        action={
          <Link
            href={me ? "/account" : "/login?next=/safety"}
            aria-label={me ? "Account" : "Sign in"}
            className="tap flex h-11 min-w-11 items-center justify-center rounded-full bg-surface px-3 shadow-card ring-1 ring-line"
          >
            {me ? <UserRound className="h-5 w-5 text-ink-2" aria-hidden /> : <span className="text-sm font-bold text-brand-ink">Sign in</span>}
          </Link>
        }
      />
      <div className="space-y-6 px-4">
        <section className="hero-gradient rise overflow-hidden rounded-3xl shadow-card" aria-labelledby="ready-title">
          <div className="flex items-center gap-4 p-5">
            <ProgressRing done={readiness.done} total={readiness.items.length} size={64} />
            <div className="min-w-0">
              <h2 id="ready-title" className="text-xl font-extrabold leading-tight">
                {readiness.ready ? "You're all set" : "Your safety setup"}
              </h2>
              <p className="mt-0.5 text-sm text-white/85">
                {readiness.ready ? "SOS will reach your contacts the moment you need it." : `${readiness.items.length - readiness.done} step${readiness.items.length - readiness.done === 1 ? "" : "s"} left so SOS works at its best.`}
              </p>
            </div>
          </div>
          <ul className="divide-y divide-white/10 bg-black/10">
            {readiness.items.map((i) => (
              <li key={i.id}>
                {i.done ? (
                  <div className="flex min-h-14 items-center gap-3 px-5 py-2.5 text-white/75">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/25" aria-hidden>
                      <Check className="h-4 w-4" strokeWidth={3} />
                    </span>
                    <span className="flex-1 font-semibold line-through decoration-white/40">{i.title}</span>
                    <span className="sr-only">Done</span>
                  </div>
                ) : i.id === "drill" ? (
                  <button onClick={drill} className="flex min-h-14 w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-white/10">
                    <span className="h-7 w-7 shrink-0 rounded-full ring-2 ring-white/60 ring-inset" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold">{i.title}</span>
                      <span className="block text-[13px] text-white/80">{i.text}</span>
                    </span>
                    <ChevronRight className="h-5 w-5 shrink-0" aria-hidden />
                  </button>
                ) : (
                  <Link href={i.href} className="flex min-h-14 items-center gap-3 px-5 py-2.5 hover:bg-white/10">
                    <span className="h-7 w-7 shrink-0 rounded-full ring-2 ring-white/60 ring-inset" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold">{i.title}</span>
                      <span className="block text-[13px] text-white/80">{i.text}</span>
                    </span>
                    <ChevronRight className="h-5 w-5 shrink-0" aria-hidden />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section id="drill" className="card scroll-mt-4 p-4" aria-labelledby="drill-title">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sos text-white" aria-hidden>
              <PlayCircle className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="drill-title" className="font-extrabold text-ink">
                Practise an SOS
              </h2>
              <p className="mt-0.5 text-sm text-ink-2">
                See exactly what happens when you hold the red SOS button, without alerting anyone. Knowing it by heart helps when you&apos;re scared.
              </p>
            </div>
          </div>
          <button onClick={drill} className="btn btn-outline mt-3 w-full">
            Start practice
          </button>
        </section>

        {timer && (
          <Link href="/timer" className="card tap flex items-center gap-3 p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-info-soft text-info" aria-hidden>
              <Timer className="h-[22px] w-[22px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-ink">Safety timer running</span>
              <span className="block text-sm text-ink-2">Check in before {new Date(timer.endsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
            </span>
            <Badge tone="info">Active</Badge>
          </Link>
        )}

        <section aria-labelledby="tools-title">
          <SectionTitle id="tools-title">Tools</SectionTitle>
          <div className="card divide-y divide-line overflow-hidden">
            {TOOLS.map((t) => (
              <ListRow key={t.href} href={t.href} icon={t.icon} tone={t.tone} title={t.title} text={t.text} />
            ))}
            <ListRow href="/contacts" icon={Users} tone="brand" title="Trusted contacts" text="Who gets your SOS, and how they're alerted" />
          </div>
        </section>

        <DeviceSettings />

        {!isNativeApp() && (
          <Link href="/app" className="card tap flex items-center gap-3 p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand-soft-ink" aria-hidden>
              <Download className="h-[22px] w-[22px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-ink">Get the SafeNav app</span>
              <span className="block text-sm text-ink-2">Automatic SMS, shake with the screen locked, and background tracking</span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-ink-3" aria-hidden />
          </Link>
        )}

        <Link href="/about" className="flex items-center justify-center gap-2 py-2 text-sm font-semibold text-brand-ink">
          <Info className="h-4 w-4" aria-hidden />
          How SafeNav works and where its data comes from
        </Link>
      </div>
    </main>
  );
}

"use client";

import { ArrowUp, Check, CircleAlert, CloudSun, Loader2, MapPinned, Mic, Route, ScanSearch, Search, ShieldCheck, Siren, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { askPlanner, type GuardianPlan, type GuardianStep } from "@/lib/client/guardian";
import type { LngLat } from "@/lib/geo";

const EXAMPLES = ["Walk me home to Vijay Nagar, I'm alone", "Safest way to the railway station at 11 pm", "Cab to the airport, I'm travelling alone"];

const STEP_ICON: Record<string, typeof Search> = {
  search_place: Search,
  check_area: ScanSearch,
  get_weather: CloudSun,
  plan_routes: Route,
  find_help: Siren,
};

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function speechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * "Ask SafeNav Guardian": the traveller says where they're going in their own
 * words; the planner agent finds the place, checks the area and weather,
 * compares safety-scored routes and explains its choice, step by step.
 */
export function GuardianAsk({ here, stepFree, onPlanned }: { here: LngLat | null; stepFree: boolean; onPlanned: (p: GuardianPlan) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<GuardianStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [canListen, setCanListen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setCanListen(!!speechRecognition());
    return () => abortRef.current?.abort();
  }, []);

  const ask = async (request: string) => {
    const q = request.trim();
    if (q.length < 3 || busy) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setSteps([]);
    setError(null);
    setQuestion(null);
    try {
      const result = await askPlanner(q, here, stepFree, (s) => setSteps((prev) => [...prev, s]), ctrl.signal);
      if (result.status === "need_more_info") setQuestion(result.question ?? result.summary);
      else onPlanned(result);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(text);
  };

  const listen = () => {
    const Rec = speechRecognition();
    if (!Rec) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new Rec();
    rec.lang = "en-IN";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const said = e.results[0]?.[0]?.transcript ?? "";
      if (said) {
        setText(said);
        void ask(said);
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  return (
    <section className="card overflow-hidden" aria-labelledby="guardian-title">
      <div className="flex items-center gap-2.5 px-3.5 pt-3.5">
        <span className="hero-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" aria-hidden>
          <Sparkles className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 id="guardian-title" className="font-extrabold leading-tight text-ink">
            Ask SafeNav Guardian
          </h2>
          <p className="text-[13px] leading-snug text-ink-2">Say where you&apos;re going. It plans the safest way and keeps watch.</p>
        </div>
      </div>

      <form onSubmit={submit} className="flex items-end gap-2 p-3.5">
        <label htmlFor="guardian-input" className="sr-only">
          Where are you going?
        </label>
        <textarea
          id="guardian-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(text);
            }
          }}
          rows={2}
          maxLength={500}
          placeholder="e.g. Get me home to Vijay Nagar, I'm alone and it's late"
          className="field min-h-[3.25rem] flex-1 resize-none py-2.5 text-[15px] leading-snug"
          disabled={busy}
        />
        {canListen && (
          <button type="button" onClick={listen} aria-pressed={listening} aria-label={listening ? "Stop listening" : "Speak your request"} className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1 ring-line ${listening ? "bg-sos text-white" : "bg-surface text-ink-2"}`} disabled={busy}>
            <Mic className={`h-5 w-5 ${listening ? "animate-pulse" : ""}`} aria-hidden />
          </button>
        )}
        <button type="submit" aria-label="Ask the Guardian" className="btn btn-primary h-12 w-12 shrink-0 rounded-2xl p-0" disabled={busy || text.trim().length < 3}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <ArrowUp className="h-5 w-5" aria-hidden />}
        </button>
      </form>

      {!busy && !steps.length && !error && !question && (
        <div className="-mt-1 flex gap-2 overflow-x-auto px-3.5 pb-3.5" aria-label="Examples">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="chip shrink-0 text-[13px]"
              onClick={() => {
                setText(ex);
                void ask(ex);
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {(busy || steps.length > 0) && (
        <ol className="space-y-1.5 border-t border-line bg-surface-2/60 px-3.5 py-3" aria-live="polite" aria-label="What the Guardian is doing">
          {steps.map((s, i) => {
            const Icon = STEP_ICON[s.tool] ?? Check;
            return (
              <li key={i} className="flex items-start gap-2 text-[13px] leading-snug text-ink-2">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${s.ok ? "text-good" : "text-caution"}`} aria-hidden />
                <span>{s.note}</span>
              </li>
            );
          })}
          {busy && (
            <li className="flex items-center gap-2 text-[13px] font-semibold text-brand-ink">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {steps.length === 0 ? "Understanding your request…" : "Thinking about the safest option…"}
            </li>
          )}
        </ol>
      )}

      {question && !busy && (
        <div className="flex gap-2.5 border-t border-line bg-info-soft px-3.5 py-3 text-sm text-ink">
          <MapPinned className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden />
          <p>{question}</p>
        </div>
      )}
      {error && !busy && (
        <div className="flex gap-2.5 border-t border-line bg-caution-soft px-3.5 py-3 text-sm text-ink" role="alert">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-caution" aria-hidden />
          <p>{error}</p>
        </div>
      )}
    </section>
  );
}

/** The planner's explanation, shown above the routes it compared. */
export function GuardianPlanCard({ plan, onDismiss }: { plan: GuardianPlan; onDismiss: () => void }) {
  return (
    <section id="guardian-plan" className="scroll-mt-3 rounded-3xl bg-brand-soft p-4 text-brand-soft-ink" aria-labelledby="guardian-plan-title">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold uppercase tracking-wider opacity-80">Guardian&apos;s plan</p>
          <h2 id="guardian-plan-title" className="mt-0.5 font-extrabold leading-snug">
            {plan.summary}
          </h2>
        </div>
      </div>
      {plan.reasons.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {plan.reasons.map((r) => (
            <li key={r} className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={3} aria-hidden />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
      {plan.tips.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-current/15 pt-3 text-[13px] opacity-90">
          {plan.tips.map((t) => (
            <li key={t}>• {t}</li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 text-xs opacity-75">
        <span>
          {plan.steps.length} step{plan.steps.length === 1 ? "" : "s"} · {(plan.ms / 1000).toFixed(1)} s
        </span>
        <button type="button" onClick={onDismiss} className="font-bold underline">
          Plan it myself
        </button>
      </div>
    </section>
  );
}

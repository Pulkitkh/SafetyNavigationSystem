import { AbsoluteFill, interpolate } from "remotion";
import { Bokeh } from "../components/Bokeh";
import { Icon } from "../components/Icons";
import { Fist } from "../components/Fist";
import { Phone } from "../components/Phone";
import { At, useT } from "../components/Scene";
import { C, EASE_OUT, FONT, POP } from "../theme";
import { f, LANG, LINES, tr } from "../timeline";
import { NightStreet } from "./NightStreet";

// One hard cut per line: the routine, beat by beat, then the turn.
const at = (id: string) => f(LINES.find((l) => l.id === id)!.at);
const CUTS = [0, at("h02"), at("h03"), at("h04"), at("h05"), at("h06")];
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Big type that is on screen from the cut's first frame and lands with a small punch. */
function Punch({ text, top = 300, size = 96 }: { text: string; top?: number; size?: number }) {
  const t = useT();
  const p = interpolate(t, [0, 7], [0, 1], { ...clamp, easing: EASE_OUT });
  const parts = text.split(/(\*[^*]+\*)/g).filter(Boolean);
  return (
    <div style={{ position: "absolute", left: 60, right: 60, top, textAlign: "center", fontFamily: FONT, fontWeight: 800, fontSize: size, lineHeight: 1.08, letterSpacing: -2, color: C.ink, transform: `scale(${1.05 - 0.05 * p})`, textShadow: "0 6px 30px rgba(0,0,0,0.6)" }}>
      {parts.map((s, i) =>
        s.startsWith("*") ? (
          <span key={i} style={{ color: C.brandInk }}>
            {s.slice(1, -1)}
          </span>
        ) : (
          <span key={i}>{s}</span>
        ),
      )}
    </div>
  );
}

function KeysCut() {
  const t = useT();
  // Lands big and fast on frame 0, then a slow push: movement in the very first second.
  const land = interpolate(t, [0, 8], [1.35, 1], { ...clamp, easing: EASE_OUT });
  const push = interpolate(t, [8, 45], [1, 1.08], clamp);
  const glint = interpolate(t, [10, 26], [-0.3, 1.3], clamp);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 70% 50% at 50% 62%, #2a1c4a 0%, ${C.canvas} 75%)`, overflow: "hidden" }}>
      <Bokeh seed={31} count={14} />
      <div style={{ position: "absolute", left: 540 - 320, top: 700, width: 640, transform: `scale(${land * push})`, transformOrigin: "320px 420px" }}>
        <Fist width={640} />
        {/* One glint travelling up the middle key */}
        <div style={{ position: "absolute", left: 300, top: 60 + (1 - glint) * 180, width: 40, height: 40, borderRadius: 20, background: "radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 70%)", opacity: glint > 0 && glint < 1 ? 1 : 0 }} />
      </div>
      <Punch text={tr("Keys between your *fingers.*", "*उंगलियों* के बीच चाबियाँ।")} />
    </AbsoluteFill>
  );
}

function CallCut() {
  const t = useT();
  const buzz = Math.sin(t * 2.4) * 2.5 * (t % 18 < 10 ? 1 : 0);
  const wave = (t % 24) / 24;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 70% 50% at 50% 62%, #12301f 0%, ${C.canvas} 75%)` }}>
      {[0, 0.5].map((o) => {
        const w = (wave + o) % 1;
        return <div key={o} style={{ position: "absolute", left: 540 - 360, top: 1180 - 360, width: 720, height: 720, borderRadius: "50%", border: `4px solid rgba(74,222,155,${0.5 * (1 - w)})`, transform: `scale(${0.7 + w * 0.8})` }} />;
      })}
      <Phone width={520} style={{ left: 280, top: 640, transform: `rotate(${buzz}deg)` }} glow="rgba(74,222,155,0.3)">
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(#1b2a3a, #0c0b14)", fontFamily: FONT, textAlign: "center" }}>
          <div style={{ marginTop: 150, color: C.ink3, fontSize: 17, fontWeight: 600 }}>mobile</div>
          <div style={{ marginTop: 6, color: C.ink, fontSize: 40, fontWeight: 800 }}>{tr("Papa", "पापा")}</div>
          <div style={{ margin: "40px auto 0", width: 120, height: 120, borderRadius: 60, background: "#2b3d52", color: C.ink, fontSize: 52, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>P</div>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 110, display: "flex", justifyContent: "space-around" }}>
            {[C.sos, "#16a34a"].map((bg, i) => (
              <div key={bg} style={{ width: 72, height: 72, borderRadius: 36, background: bg, display: "flex", alignItems: "center", justifyContent: "center", transform: i ? `scale(${1 + 0.08 * Math.sin(t / 3)})` : "rotate(135deg)" }}>
                <Icon name="phone" size={34} color="#fff" />
              </div>
            ))}
          </div>
        </div>
      </Phone>
      <Punch text={tr("A *fake* phone call.", "*झूठी* फ़ोन कॉल।")} />
    </AbsoluteFill>
  );
}

function WalkCut() {
  const t = useT();
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${1.3 + t * 0.002})`, transformOrigin: "456px 1250px" }}>
        <NightStreet dur={40} speed={1.9} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "linear-gradient(rgba(7,6,13,0.92) 0%, rgba(7,6,13,0.6) 22%, rgba(7,6,13,0) 36%)" }} />
      <Punch text={tr("Walking a little *faster.*", "थोड़ा *तेज़* चलना।")} />
    </AbsoluteFill>
  );
}

function TextCut() {
  const t = useT();
  const typing = t < 9;
  const p = interpolate(t, [8, 16], [0, 1], { ...clamp, easing: POP });
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 70% 50% at 50% 55%, #1e1747 0%, ${C.canvas} 75%)`, fontFamily: FONT }}>
      <div style={{ position: "absolute", left: 90, top: 640, display: "flex", alignItems: "center", gap: 20 }}>
        <div style={{ width: 84, height: 84, borderRadius: 42, background: "#ffe1ea", color: "#8f0f2e", fontWeight: 800, fontSize: 38, display: "flex", alignItems: "center", justifyContent: "center" }}>M</div>
        <div style={{ color: C.ink2, fontSize: 40, fontWeight: 700 }}>{tr("Maa", "माँ")}</div>
      </div>
      {typing ? (
        <div style={{ position: "absolute", left: 90, top: 760, padding: "34px 40px", borderRadius: 48, borderBottomLeftRadius: 12, background: C.surface2, display: "flex", gap: 14 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: 22, height: 22, borderRadius: 11, background: C.ink3, opacity: 0.4 + 0.6 * Math.abs(Math.sin(t / 3 + i)) }} />
          ))}
        </div>
      ) : (
        <div style={{ position: "absolute", left: 90, top: 760, maxWidth: 840, padding: "40px 50px", borderRadius: 56, borderBottomLeftRadius: 14, background: C.surface2, color: C.ink, fontSize: 84, fontWeight: 800, lineHeight: 1.1, letterSpacing: -2, transform: `scale(${0.8 + 0.2 * p})`, transformOrigin: "0 100%", opacity: p }}>
          {tr("Text me when you reach.", "पहुँच कर मैसेज करना।")}
        </div>
      )}
      <div style={{ position: "absolute", left: 90, top: 1200, color: C.ink3, fontSize: 32, fontWeight: 600, opacity: p }}>10:02 pm</div>
    </AbsoluteFill>
  );
}

const ROUTINE = [
  { icon: "key", label: tr("Keys in hand", "हाथ में चाबी") },
  { icon: "phone", label: tr("Fake call", "झूठी कॉल") },
  { icon: "foot", label: tr("Walk faster", "तेज़ चलना") },
  { icon: "message", label: tr("\"Reached?\"", "“पहुँच गई?”") },
] as const;

function RoutineCut() {
  const t = useT();
  return (
    <AbsoluteFill style={{ background: C.canvas, fontFamily: FONT }}>
      <Punch text={tr("If you're a woman, you know *this routine.*", "हर लड़की *ये रूटीन* जानती है।")} size={88} />
      {ROUTINE.map((r, i) => {
        const p = interpolate(t, [4 + i * 7, 14 + i * 7], [0, 1], { ...clamp, easing: POP });
        const tick = interpolate(t, [22 + i * 7, 30 + i * 7], [0, 1], { ...clamp, easing: POP });
        const x = 90 + (i % 2) * 465;
        const y = 720 + Math.floor(i / 2) * 465;
        return (
          <div key={r.label} style={{ position: "absolute", left: x, top: y, width: 435, height: 435, borderRadius: 48, background: C.surface, boxShadow: `0 0 0 2px ${C.line}`, opacity: p, transform: `scale(${0.8 + 0.2 * p})`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 30 }}>
            <Icon name={r.icon} size={130} color={C.ink2} stroke={1.8} />
            <div style={{ color: C.ink, fontSize: 46, fontWeight: 800 }}>{r.label}</div>
            <div style={{ position: "absolute", right: 26, top: 26, width: 70, height: 70, borderRadius: 35, background: C.brand, display: "flex", alignItems: "center", justifyContent: "center", opacity: tick, transform: `scale(${0.5 + 0.5 * tick})` }}>
              <Icon name="check" size={42} color="#fff" stroke={3.2} />
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

function TurnCut() {
  const t = useT();
  const p = interpolate(t, [0, 60], [1, 1.06]);
  return (
    <AbsoluteFill style={{ background: "#000", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ transform: `scale(${p})`, textAlign: "center", color: C.ink, fontWeight: 800, fontSize: 150, lineHeight: 1.02, letterSpacing: -5 }}>
        {LANG === "en" ? (
          <>
            You <span style={{ color: C.brandInk }}>shouldn&apos;t</span>
            <br />
            have to.
          </>
        ) : (
          <>
            आपको ये <span style={{ color: C.brandInk }}>क्यों</span>
            <br />
            करना पड़े?
          </>
        )}
      </div>
    </AbsoluteFill>
  );
}

const PARTS = [KeysCut, CallCut, WalkCut, TextCut, RoutineCut, TurnCut];

/** "10:02 PM · walking home" with four dots that fill one per habit: context plus a reason to keep watching. */
function Context({ i }: { i: number }) {
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 196, display: "flex", justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "12px 26px", borderRadius: 999, background: "rgba(22,21,31,0.85)", boxShadow: `0 0 0 2px ${C.line}`, fontFamily: FONT, fontWeight: 700, fontSize: 34, color: C.ink2 }}>
        <span style={{ width: 12, height: 12, borderRadius: 6, background: C.sos, boxShadow: `0 0 10px ${C.sos}` }} />
        {tr("10:02 PM · walking home", "रात 10:02 · घर की ओर")}
        <span style={{ display: "flex", gap: 8, marginLeft: 6 }}>
          {[0, 1, 2, 3].map((k) => (
            <span key={k} style={{ width: 14, height: 14, borderRadius: 7, background: k <= i ? C.brandInk : "#3a3850" }} />
          ))}
        </span>
      </div>
    </div>
  );
}

/** The hook: the routine every woman knows, in six fast beats, from the very first frame. */
export function Hook() {
  const t = useT();
  const i = CUTS.reduce((last, c, k) => (t >= c ? k : last), 0);
  const Part = PARTS[i];
  const local = t - CUTS[i];
  // A short zoom punch on every hard cut after the first.
  const punch = i > 0 ? interpolate(local, [0, 6], [1.08, 1], { ...clamp, easing: EASE_OUT }) : 1;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${punch})` }}>
        <At from={CUTS[i]}>
          <Part />
        </At>
      </AbsoluteFill>
      {i < 4 && <Context i={i} />}
    </AbsoluteFill>
  );
}

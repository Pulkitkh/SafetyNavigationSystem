import { interpolate, useCurrentFrame } from "remotion";
import { captionChunks } from "../timeline";
import { C, EASE_OUT, FONT } from "../theme";

const CHUNKS = captionChunks();

/** "*word*" segments are highlighted. */
function Rich({ text, accent }: { text: string; accent: string }) {
  const parts = text.split(/(\*[^*]+\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("*") ? (
          <span key={i} style={{ color: accent }}>
            {p.slice(1, -1)}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/**
 * Burned-in narration captions, phrase by phrase, in the top third (the
 * bottom of a Reel is covered by the platform's own buttons and text).
 */
export function Captions({ accentFor, hide }: { accentFor: (frame: number) => string; hide?: Set<string> }) {
  const frame = useCurrentFrame();
  const c = CHUNKS.find((x) => frame >= x.from && frame <= x.to);
  if (!c || hide?.has(c.line)) return null;
  const t = frame - c.from;
  const inP = interpolate(t, [0, 7], [0, 1], { extrapolateRight: "clamp", easing: EASE_OUT });
  const outP = interpolate(frame, [c.to - 4, c.to], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        left: 70,
        right: 70,
        top: 250,
        display: "flex",
        justifyContent: "center",
        opacity: Math.min(inP, outP),
        transform: `translateY(${(1 - inP) * 18}px)`,
        filter: `blur(${(1 - inP) * 6}px)`,
      }}
    >
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 66,
          lineHeight: 1.16,
          letterSpacing: -1,
          color: C.ink,
          textAlign: "center",
          textShadow: "0 2px 6px rgba(0,0,0,0.45)",
          maxWidth: 940,
          padding: "16px 30px 20px",
          borderRadius: 32,
          background: "rgba(12,11,20,0.84)",
        }}
      >
        <Rich text={c.text} accent={accentFor(frame)} />
      </div>
    </div>
  );
}

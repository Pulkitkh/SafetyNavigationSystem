import { AbsoluteFill } from "remotion";
import { C } from "../theme";
import { Bokeh } from "./Bokeh";

/** Backdrop for the app scenes: the app's night canvas with a soft brand glow. */
export function AppBg({ tint = "rgba(91,63,214,0.32)", seed = 9 }: { tint?: string; seed?: number }) {
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 80% 55% at 50% 62%, ${tint} 0%, rgba(12,11,20,0) 70%), ${C.canvas}` }}>
      <div style={{ position: "absolute", inset: 0, opacity: 0.28 }}>
        <Bokeh seed={seed} count={10} warm={false} />
      </div>
    </AbsoluteFill>
  );
}

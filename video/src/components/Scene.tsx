import { createContext, useContext, type ReactNode } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { f, SCENES, type SceneKey } from "../timeline";

const SceneT = createContext(0);

/** Frame within the current scene (0 at the scene's start; negative while it fades in early). */
export const useT = () => useContext(SceneT);

/**
 * Renders a scene over its own span. The next scene fades in on top of it,
 * so each scene keeps drawing (fully opaque) for `tail` frames past its end,
 * and fades itself in over `fadeIn` frames either side of its start. Times
 * inside a scene stay relative to the scene's nominal start.
 */
export function Scene({ k, children, fadeIn = 8, tail = 10 }: { k: SceneKey; children: ReactNode; fadeIn?: number; tail?: number }) {
  const frame = useCurrentFrame();
  const from = f(SCENES[k].from);
  const to = f(SCENES[k].to);
  if (frame < from - fadeIn || frame >= to + tail) return null;
  const t = frame - from;
  const o = fadeIn ? interpolate(t, [-fadeIn, fadeIn], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  return (
    <SceneT.Provider value={t}>
      <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>
    </SceneT.Provider>
  );
}

/** Re-bases scene time for a part of a scene, so the part can count from its own start. */
export function At({ from, children }: { from: number; children: ReactNode }) {
  const t = useT();
  return <SceneT.Provider value={t - from}>{children}</SceneT.Provider>;
}

import { useCurrentFrame } from "remotion";
import { rand } from "../util";

/** Out-of-focus street lights drifting slowly: a night backdrop for close-ups. */
export function Bokeh({ count = 16, seed = 5, warm = true }: { count?: number; seed?: number; warm?: boolean }) {
  const frame = useCurrentFrame();
  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const r = 40 + rand(seed + i) * 110;
        const x = rand(seed * 3 + i) * 1180 - 50 + Math.sin(frame / 90 + i) * 12;
        const y = 300 + rand(seed * 7 + i) * 1400 + Math.cos(frame / 110 + i) * 10;
        const hue = warm ? (rand(i + seed) > 0.3 ? "255,207,122" : "178,165,255") : "178,165,255";
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x - r,
              top: y - r,
              width: r * 2,
              height: r * 2,
              borderRadius: "50%",
              background: `radial-gradient(circle, rgba(${hue},${0.22 + rand(i * 9) * 0.25}) 0%, rgba(${hue},0.08) 60%, rgba(${hue},0) 72%)`,
              filter: "blur(2px)",
            }}
          />
        );
      })}
    </>
  );
}

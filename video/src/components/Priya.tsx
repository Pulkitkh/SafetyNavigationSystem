/**
 * Priya, as a side-view silhouette (facing right) in a kurta and dupatta,
 * with a ponytail, a shoulder bag and her phone in hand. `phase` drives the
 * walk cycle (radians); `walking=false` stands her still with a gentle sway.
 * Drawn at 300×760 (feet at y=740) and scaled by the caller.
 */
export function Priya({
  phase,
  walking = true,
  fill = "#05040b",
  rim = "rgba(150,124,255,0.75)",
  phoneGlow = 1,
}: {
  phase: number;
  walking?: boolean;
  fill?: string;
  rim?: string;
  phoneGlow?: number;
}) {
  const deg = (r: number) => (r * 180) / Math.PI;
  const s = Math.sin(phase);
  const amp = walking ? 1 : 0.08;
  const bob = walking ? 3.5 * Math.cos(2 * phase) : 1.2 * Math.sin(phase * 0.5);
  // Legs: thigh swings ±24°, the knee bends while the leg swings forward.
  const leg = (p: number) => {
    const thigh = 24 * amp * Math.sin(p);
    const knee = walking ? Math.max(0, 38 * Math.sin(p + 1.4)) : 2;
    return { thigh, knee };
  };
  const a = leg(phase);
  const b = leg(phase + Math.PI);
  const backArm = -20 * amp * s;
  const pony = 7 * Math.sin(phase + 0.6) * (walking ? 1 : 0.4);
  const scarf = 5 * Math.sin(phase + 1.1) * (walking ? 1 : 0.4);

  const Leg = ({ thigh, knee, back }: { thigh: number; knee: number; back?: boolean }) => (
    <g transform={`rotate(${thigh} 152 448)`} opacity={back ? 0.82 : 1}>
      {/* Churidar: tapered thigh, rounded knee, slimmer shin */}
      <path d="M134 436 Q152 428 170 436 L164 590 Q153 598 142 590 Z" fill={fill} />
      <circle cx="153" cy="588" r="12" fill={fill} />
      <g transform={`rotate(${-knee} 153 588)`}>
        <path d="M141 586 L165 586 L160 726 Q152 732 145 726 Z" fill={fill} />
        <path d="M141 720 L166 720 Q186 724 188 736 Q170 742 141 740 Z" fill={fill} />
      </g>
    </g>
  );

  return (
    <svg viewBox="0 0 300 760" width="100%" height="100%" style={{ overflow: "visible", filter: `drop-shadow(-3px -1px 0 ${rim}) drop-shadow(0 0 22px rgba(124,92,255,0.22))` }}>
      <defs>
        <radialGradient id="phoneLight" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="rgba(178,165,255,0.55)" />
          <stop offset="1" stopColor="rgba(178,165,255,0)" />
        </radialGradient>
      </defs>
      <g transform={`translate(0 ${bob})`}>
        {/* Far leg and arm sit behind the body. */}
        <Leg {...b} back />
        <g transform={`rotate(${backArm} 138 168)`} opacity={0.85}>
          <path d="M128 160 Q138 154 148 162 L142 300 Q136 312 128 300 Z" fill={fill} />
        </g>
        {/* Ponytail */}
        <g transform={`rotate(${pony} 128 78)`}>
          <path d="M132 70 Q104 80 104 120 Q104 168 92 196 Q118 176 126 132 Q132 100 140 80 Z" fill={fill} />
        </g>
        {/* Neck and head */}
        <path d="M150 118 L170 118 L172 150 L148 150 Z" fill={fill} />
        <ellipse cx="160" cy="88" rx="31" ry="35" fill={fill} />
        <path d="M128 82 Q130 46 162 50 Q190 52 192 80 Q178 64 160 66 Q140 70 134 92 Z" fill={fill} />
        {/* Nose and chin profile */}
        <path d="M189 82 L197 98 L188 101 Z" fill={fill} />
        {/* Kurta */}
        <path d="M130 150 Q154 140 182 152 Q192 200 188 262 Q186 300 196 360 Q212 430 214 476 L100 476 Q100 430 114 360 Q122 300 120 262 Q116 200 130 150 Z" fill={fill} />
        {/* Near leg */}
        <Leg {...a} />
        {/* Shoulder bag and strap */}
        <path d="M182 152 L122 382 L128 384 L188 156 Z" fill={fill} />
        <rect x="96" y="372" width="44" height="56" rx="8" fill={fill} />
        {/* Dupatta, flowing behind */}
        <g transform={`rotate(${scarf} 180 154)`}>
          <path d="M184 150 Q150 200 120 250 Q100 300 86 352 Q110 320 128 290 Q160 236 190 168 Z" fill={fill} />
        </g>
        {/* Near arm, bent, holding the phone in front of her */}
        <path d="M168 156 Q182 158 186 176 L190 262 Q186 274 176 270 L166 180 Z" fill={fill} />
        <path d="M178 254 Q186 248 194 252 L232 226 Q240 232 236 240 L196 272 Q184 276 178 266 Z" fill={fill} />
        <rect x="226" y="208" width="18" height="30" rx="4" fill="#0d0b17" transform="rotate(-18 235 223)" />
        <rect x="229" y="211" width="12" height="23" rx="2" fill={`rgba(190,178,255,${0.55 + 0.45 * phoneGlow})`} transform="rotate(-18 235 223)" />
        <circle cx="222" cy="196" r="70" fill="url(#phoneLight)" opacity={phoneGlow} />
      </g>
    </svg>
  );
}

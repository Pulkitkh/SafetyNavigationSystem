/**
 * A clenched fist seen from the front, with key blades pushed out between the
 * knuckles: the grip women are taught for walking alone at night. Silhouette
 * style to match Priya, keys in bright metal so they read first.
 */
export function Fist({ width = 600, rim = "rgba(150,124,255,0.9)" }: { width?: number; rim?: string }) {
  const fill = "#140f26";
  const fingers = [
    { x: 40, top: 168 },
    { x: 124, top: 150 },
    { x: 208, top: 156 },
    { x: 292, top: 178 },
  ];
  // Blades between the fingers: index-middle, middle-ring, ring-little.
  const blades = [
    { x: 120, tilt: -9, len: 150 },
    { x: 204, tilt: 0, len: 175 },
    { x: 288, tilt: 9, len: 140 },
  ];
  return (
    <svg viewBox="0 0 420 520" width={width} height={(width * 520) / 420} style={{ overflow: "visible", filter: `drop-shadow(-4px -3px 0 ${rim}) drop-shadow(0 0 40px rgba(124,92,255,0.35))` }}>
      <defs>
        <linearGradient id="bladeG" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7d8299" />
          <stop offset="0.45" stopColor="#f4f5fb" />
          <stop offset="1" stopColor="#8b90a8" />
        </linearGradient>
        <linearGradient id="knuckleG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2148" />
          <stop offset="1" stopColor={fill} />
        </linearGradient>
      </defs>
      {blades.map((b, i) => (
        <g key={i} transform={`rotate(${b.tilt} ${b.x} 230)`}>
          <path
            d={`M${b.x - 11} 230 L${b.x - 11} ${230 - b.len + 14} L${b.x} ${230 - b.len} L${b.x + 11} ${230 - b.len + 14} L${b.x + 11} ${230 - b.len * 0.55} L${b.x + 19} ${230 - b.len * 0.5} L${b.x + 11} ${230 - b.len * 0.42} L${b.x + 11} ${230 - b.len * 0.3} L${b.x + 17} ${230 - b.len * 0.25} L${b.x + 11} ${230 - b.len * 0.18} L${b.x + 11} 230 Z`}
            fill="url(#bladeG)"
          />
        </g>
      ))}
      {/* Back of the hand and wrist */}
      <rect x="44" y="250" width="332" height="170" rx="60" fill={fill} />
      <rect x="120" y="390" width="190" height="130" rx="30" fill={fill} />
      {/* Curled fingers, knuckles up */}
      {fingers.map((g, i) => (
        <g key={i}>
          <rect x={g.x} y={g.top} width="84" height={300 - g.top} rx="40" fill="url(#knuckleG)" stroke="#0a0716" strokeWidth="5" />
          <path d={`M${g.x + 16} ${g.top + 60} Q${g.x + 42} ${g.top + 72} ${g.x + 68} ${g.top + 60}`} stroke="#0a0716" strokeWidth="5" fill="none" strokeLinecap="round" />
        </g>
      ))}
      {/* Thumb across the front */}
      <path d="M26 300 Q40 282 90 284 L232 290 Q268 292 270 322 Q270 352 234 354 L96 354 Q40 352 26 330 Z" fill={fill} stroke="#0a0716" strokeWidth="5" />
      <path d="M232 296 Q252 304 252 322" stroke="#2a2148" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M150 300 L150 346" stroke="#0a0716" strokeWidth="4" strokeLinecap="round" />
      {/* Key ring hanging below the grip */}
      <circle cx="150" cy="440" r="34" fill="none" stroke="url(#bladeG)" strokeWidth="9" />
      <rect x="172" y="452" width="40" height="46" rx="10" fill="#3b2f8f" transform="rotate(-18 192 475)" />
    </svg>
  );
}

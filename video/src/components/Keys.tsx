import type { CSSProperties } from "react";

/** A key ring with two keys, drawn in brushed metal. */
export function Keys({ width = 300, style }: { width?: number; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 260 360" width={width} height={(width * 360) / 260} style={style}>
      <defs>
        <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#eef0f7" />
          <stop offset="0.5" stopColor="#9da2b8" />
          <stop offset="1" stopColor="#5d6178" />
        </linearGradient>
      </defs>
      <circle cx="130" cy="58" r="44" fill="none" stroke="url(#metal)" strokeWidth="9" />
      <g transform="rotate(14 130 100)">
        <circle cx="118" cy="128" r="30" fill="url(#metal)" />
        <circle cx="118" cy="128" r="10" fill="#0c0b14" />
        <path d="M108 150 L128 150 L128 300 L118 316 L108 300 L108 284 L96 284 L96 268 L108 268 L108 246 L98 246 L98 232 L108 232 Z" fill="url(#metal)" />
      </g>
      <g transform="rotate(-22 130 100)">
        <rect x="132" y="96" width="44" height="52" rx="10" fill="#3b2f8f" />
        <path d="M146 146 L162 146 L162 286 L154 298 L146 286 L146 270 L136 270 L136 256 L146 256 Z" fill="url(#metal)" />
      </g>
    </svg>
  );
}

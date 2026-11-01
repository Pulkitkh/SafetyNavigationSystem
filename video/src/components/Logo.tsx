/** SafeNav's mark: the shield and pin from the app icon. */
export function Logo({ size, radius = 0.24 }: { size: number; radius?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" style={{ borderRadius: size * radius, display: "block" }}>
      <defs>
        <radialGradient id="logoG" cx="0" cy="0" r="1.45" gradientUnits="objectBoundingBox">
          <stop offset="0" stopColor="#7c5cff" />
          <stop offset="0.45" stopColor="#5b3fd6" />
          <stop offset="1" stopColor="#3a2aa8" />
        </radialGradient>
      </defs>
      <rect width="512" height="512" fill="url(#logoG)" />
      <g transform="translate(56 56) scale(0.78125)">
        <path d="M256 64 L416 124 V244 C416 342 348 418 256 452 C164 418 96 342 96 244 V124 Z" fill="#ffffff" />
        <path d="M256 150 C212 150 180 182 180 224 C180 280 256 352 256 352 C256 352 332 280 332 224 C332 182 300 150 256 150 Z" fill="#5b3fd6" />
        <circle cx="256" cy="224" r="30" fill="#ffffff" />
      </g>
    </svg>
  );
}

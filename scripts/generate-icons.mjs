// Renders the SafeNav icon to every size the web manifest, iOS, push
// notifications and the Android app need. Run with `npm run icons`.
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const GRADIENT = `
  <defs>
    <radialGradient id="g" cx="0" cy="0" r="1.45" gradientUnits="objectBoundingBox">
      <stop offset="0" stop-color="#7c5cff"/>
      <stop offset="0.45" stop-color="#5b3fd6"/>
      <stop offset="1" stop-color="#3a2aa8"/>
    </radialGradient>
  </defs>`;

// Shield with a location pin cut out: protection plus navigation.
const MARK = `
  <path d="M256 64 L416 124 V244 C416 342 348 418 256 452 C164 418 96 342 96 244 V124 Z" fill="#ffffff"/>
  <path d="M256 150 C212 150 180 182 180 224 C180 280 256 352 256 352 C256 352 332 280 332 224 C332 182 300 150 256 150 Z" fill="#5b3fd6"/>
  <circle cx="256" cy="224" r="30" fill="#ffffff"/>`;

/** Full-bleed icon; `padding` shrinks the mark for maskable and adaptive icons. */
const icon = (padding, { rounded = false, background = true } = {}) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${GRADIENT}
  ${background ? `<rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="url(#g)"/>` : ""}
  <g transform="translate(${padding} ${padding}) scale(${(512 - 2 * padding) / 512})">${MARK}</g>
</svg>`;

// Monochrome shield for the Android notification badge (white on transparent).
const badge = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <path fill-rule="evenodd" fill="#ffffff" d="M256 40 L432 106 V238 C432 346 357 430 256 468 C155 430 80 346 80 238 V106 Z M256 140 C208 140 172 176 172 222 C172 284 256 362 256 362 C256 362 340 284 340 222 C340 176 304 140 256 140 Z M256 192 A30 30 0 1 1 256 252 A30 30 0 1 1 256 192 Z"/>
</svg>`;

const splash = (w, h) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  ${GRADIENT}
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <g transform="translate(${w / 2 - Math.min(w, h) * 0.18} ${h / 2 - Math.min(w, h) * 0.18}) scale(${(Math.min(w, h) * 0.36) / 512})">${MARK}</g>
</svg>`;

const png = (svg, size, file) => sharp(Buffer.from(svg)).resize(size, size).png().toFile(file);

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon.svg", icon(56).trim());
await png(icon(56), 192, "public/icons/icon-192.png");
await png(icon(56), 512, "public/icons/icon-512.png");
await png(icon(112), 512, "public/icons/maskable-512.png");
await png(icon(64), 180, "public/icons/apple-touch-icon.png");
await png(badge, 72, "public/icons/badge-72.png");

// Android launcher icons (legacy square/round) and adaptive-icon foregrounds.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const res = "android/app/src/main/res";
for (const [d, k] of Object.entries(DENSITIES)) {
  await png(icon(72, { rounded: true }), Math.round(48 * k), `${res}/mipmap-${d}/ic_launcher.png`);
  await sharp(Buffer.from(icon(72)))
    .resize(Math.round(48 * k), Math.round(48 * k))
    .composite([{ input: Buffer.from(`<svg width="${48 * k}" height="${48 * k}"><circle cx="${24 * k}" cy="${24 * k}" r="${24 * k}"/></svg>`), blend: "dest-in" }])
    .png()
    .toFile(`${res}/mipmap-${d}/ic_launcher_round.png`);
  // Adaptive icons are 108dp with the visible part in the middle 72dp.
  await png(icon(112, { background: false }), Math.round(108 * k), `${res}/mipmap-${d}/ic_launcher_foreground.png`);
}
writeFileSync(
  `${res}/values/ic_launcher_background.xml`,
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#5B3FD6</color>\n</resources>\n`,
);

// Splash screens shown while the app connects.
const SPLASH = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
for (const [d, [w, h]] of Object.entries(SPLASH)) {
  await sharp(Buffer.from(splash(w, h))).png().toFile(`${res}/drawable-port-${d}/splash.png`);
  await sharp(Buffer.from(splash(h, w))).png().toFile(`${res}/drawable-land-${d}/splash.png`);
}
await sharp(Buffer.from(splash(480, 800))).png().toFile(`${res}/drawable/splash.png`);
console.log("icons written");

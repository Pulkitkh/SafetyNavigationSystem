// Renders the app icon SVG to the PNG sizes the web manifest and iOS need.
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const icon = (padding) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#1d4ed8"/>
  <g transform="translate(${padding} ${padding}) scale(${(512 - 2 * padding) / 512})">
    <path d="M256 64 L416 124 V244 C416 342 348 418 256 452 C164 418 96 342 96 244 V124 Z" fill="#ffffff"/>
    <path d="M256 150 C212 150 180 182 180 224 C180 280 256 352 256 352 C256 352 332 280 332 224 C332 182 300 150 256 150 Z" fill="#1d4ed8"/>
    <circle cx="256" cy="224" r="30" fill="#ffffff"/>
  </g>
</svg>`;

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon.svg", icon(0).trim());
const targets = [
  ["icon-192.png", 192, 0],
  ["icon-512.png", 512, 0],
  ["maskable-512.png", 512, 64],
  ["apple-touch-icon.png", 180, 24],
];
for (const [name, size, pad] of targets) {
  await sharp(Buffer.from(icon(pad))).resize(size, size).png().toFile(`public/icons/${name}`);
}
console.log("icons written");

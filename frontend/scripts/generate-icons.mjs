#!/usr/bin/env node
/**
 * Render the three variants of the app icon (light / dark / tinted) to
 * the PNG sizes browsers and iOS look for.
 *
 * Safari Web-Apps ("Add to Home Screen") needs a real PNG for
 * apple-touch-icon — SVG falls back to rendering the app initial ("P").
 *
 * Run:  node scripts/generate-icons.mjs
 */
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const publicDir = new URL("../public/", import.meta.url);

const variants = [
  { src: "app-icon-dark.svg", prefix: "icon-dark" },
  { src: "app-icon-light.svg", prefix: "icon-light" },
  { src: "app-icon-tinted.svg", prefix: "icon-tinted" },
];

const sizes = [180, 192, 512];

if (!existsSync(publicDir)) mkdirSync(publicDir);

for (const { src, prefix } of variants) {
  const svg = readFileSync(new URL(src, publicDir), "utf-8");
  for (const size of sizes) {
    const resvg = new Resvg(svg, { fitTo: { mode: "width", value: size } });
    const png = resvg.render().asPng();
    writeFileSync(new URL(`${prefix}-${size}.png`, publicDir), png);
    console.log(`✓ ${prefix}-${size}.png (${size}×${size})`);
  }
}

// The default apple-touch-icon / favicon.ico-replacement is the dark
// variant at 180px — iOS uses this whenever media-query lookup fails.
writeFileSync(
  new URL("apple-touch-icon.png", publicDir),
  readFileSync(new URL("icon-dark-180.png", publicDir))
);
writeFileSync(
  new URL("icon-192.png", publicDir),
  readFileSync(new URL("icon-dark-192.png", publicDir))
);
writeFileSync(
  new URL("icon-512.png", publicDir),
  readFileSync(new URL("icon-dark-512.png", publicDir))
);
console.log("✓ default apple-touch-icon.png / icon-192.png / icon-512.png → dark variant");

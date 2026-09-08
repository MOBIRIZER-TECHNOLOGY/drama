/**
 * Renders every icon slot from the one vector mark.
 *
 * The brand arrived as a 1024px JPEG with its background baked in, which cannot be an Android adaptive icon
 * (the foreground has to be transparent, with the mark inside the central 66% or the circular mask clips it)
 * and shows compression artifacts around the glow at large sizes. `apps/web/public/logo-mark.svg` is the
 * source of truth; everything below is generated from it, so a change to the mark is one edit and one command.
 *
 * Run: node scripts/build-icons.mjs
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sharp = require(join(root, "node_modules/.pnpm/sharp@0.35.4_@types+node@20.19.43/node_modules/sharp"));

const MARK = readFileSync(join(root, "apps/web/public/logo-mark.svg"), "utf8");
/** The app's own ground, so an opaque icon and the splash screen are the same colour. */
const GROUND = "#0A0A0A";

/**
 * The mark already sits at ~60% of its viewBox, which is exactly the Android adaptive safe zone. A plain icon
 * wants it larger or it looks lost in the rounded square, so each slot says how much of the canvas to fill.
 */
async function render({ size, fill, background, monochrome = false }) {
  const inner = Math.round(size * fill);
  let svg = MARK;
  if (monochrome) {
    // Android's monochrome layer is a silhouette; the system tints it. Flatten the gradients to white and drop
    // the knockout mask's colour so the play triangle stays a hole rather than becoming white too.
    svg = svg
      .replace(/url\(#katha-page-[lr]\)/g, "#FFFFFF")
      .replace(/stop-color="#[0-9A-Fa-f]{6}"/g, 'stop-color="#FFFFFF"');
  }
  const mark = await sharp(Buffer.from(svg), { density: 800 }).resize(inner, inner).png().toBuffer();

  const canvas = sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
  return canvas.composite([{ input: mark, gravity: "centre" }]).png().toBuffer();
}

const out = (relative, buffer) => {
  writeFileSync(join(root, relative), buffer);
  console.log("  ", relative);
};

const jobs = [
  // ---- web ----
  // Favicon and the plain PWA icons: opaque, mark generous inside the tile.
  ["apps/web/public/icon.png", { size: 64, fill: 0.86, background: GROUND }],
  ["apps/web/public/icon-192.png", { size: 192, fill: 0.86, background: GROUND }],
  ["apps/web/public/icon-512.png", { size: 512, fill: 0.86, background: GROUND }],
  // Maskable: the launcher crops to a circle or squircle, so the mark stays inside the safe zone.
  ["apps/web/public/icon-maskable-512.png", { size: 512, fill: 0.62, background: GROUND }],
  // iOS never applies transparency and rounds the corners itself.
  ["apps/web/public/apple-icon.png", { size: 180, fill: 0.82, background: GROUND }],

  // ---- mobile ----
  ["apps/mobile/assets/images/icon.png", { size: 1024, fill: 0.84, background: GROUND }],
  ["apps/mobile/assets/images/favicon.png", { size: 96, fill: 0.86, background: GROUND }],
  // Adaptive icon: three separate layers, composed by the launcher.
  ["apps/mobile/assets/images/android-icon-foreground.png", { size: 1024, fill: 0.62 }],
  ["apps/mobile/assets/images/android-icon-background.png", { size: 1024, fill: 0, background: GROUND }],
  ["apps/mobile/assets/images/android-icon-monochrome.png", { size: 1024, fill: 0.62, monochrome: true }],
  // Splash sits on the configured background colour, so the mark itself is transparent.
  ["apps/mobile/assets/images/splash-icon.png", { size: 1024, fill: 0.55 }],
];

console.log("Rendering icons from apps/web/public/logo-mark.svg");
for (const [path, options] of jobs) {
  // fill 0 means a plain colour field (the adaptive background layer), which needs no mark at all.
  const buffer =
    options.fill === 0
      ? await sharp({
          create: { width: options.size, height: options.size, channels: 4, background: options.background },
        })
          .png()
          .toBuffer()
      : await render(options);
  out(path, buffer);
}
console.log("Done.");

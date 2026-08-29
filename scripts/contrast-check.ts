#!/usr/bin/env tsx
/**
 * One-shot contrast checker for the Notion color palette in src/export/styles.ts.
 *
 * Computes WCAG 2.x contrast ratios for every `.t-<color>` text over every
 * `.b-<color>_background` AND over `--bg`, in BOTH light and dark themes.
 * Prints a table and exits 1 if any combo falls below 4.5:1 (AA body text).
 *
 * Run via:  pnpm contrast
 */
import { STYLE_CSS } from "../src/export/styles.js";

const HEX_RE = /^#([0-9a-fA-F]{6})$/;
type Rgb = { r: number; g: number; b: number };

function hexToRgb(hex: string): Rgb {
  const m = HEX_RE.exec(hex);
  if (!m) throw new Error(`bad hex: ${hex}`);
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrast(fg: string, bg: string): number {
  const L1 = relativeLuminance(hexToRgb(fg));
  const L2 = relativeLuminance(hexToRgb(bg));
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

const COLORS = [
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const;

type ColorName = (typeof COLORS)[number];

interface Palette {
  bg: string; // --bg
  t: Record<ColorName, string>;
  bBg: Record<ColorName, string>;
}

/**
 * Extract the palette from styles.ts by scanning the template literal.
 * Selectors we look for (last occurrence wins — explicit dark override sits
 * after the @media block):
 *
 * Light:
 *   :root { --bg: #...; }
 *   .t-<color> { color: #...; }
 *   .b-<color>_background { background: #...; }
 *
 * Dark (explicit override, not the @media one):
 *   :root[data-theme="dark"] { --bg: #...; }
 *   :root[data-theme="dark"] .t-<color> { color: #...; }
 *   :root[data-theme="dark"] .b-<color>_background { background: #...; }
 */
function extractPalettes(css: string): { light: Palette; dark: Palette } {
  const light: Palette = {
    bg: "",
    t: {} as Record<ColorName, string>,
    bBg: {} as Record<ColorName, string>,
  };
  const dark: Palette = {
    bg: "",
    t: {} as Record<ColorName, string>,
    bBg: {} as Record<ColorName, string>,
  };

  // --bg in :root baseline (light)
  const lightBgMatch = /:root\s*{[^}]*?--bg:\s*(#[0-9a-fA-F]{6})/m.exec(css);
  if (!lightBgMatch) throw new Error("could not find light --bg");
  light.bg = lightBgMatch[1];

  // --bg in :root[data-theme="dark"] block
  const darkBgMatch = /:root\[data-theme="dark"\]\s*{[^}]*?--bg:\s*(#[0-9a-fA-F]{6})/m.exec(css);
  if (!darkBgMatch) throw new Error("could not find dark --bg");
  dark.bg = darkBgMatch[1];

  for (const color of COLORS) {
    // Light .t-<color>: last match in file before any dark override section
    const tLight = new RegExp(`^\\.t-${color}\\s*{\\s*color:\\s*(#[0-9a-fA-F]{6})`, "m").exec(css);
    if (!tLight) throw new Error(`missing light .t-${color}`);
    light.t[color] = tLight[1];

    // Dark .t-<color> via :root[data-theme="dark"]
    const tDark = new RegExp(
      `:root\\[data-theme="dark"\\]\\s*\\.t-${color}\\s*{\\s*color:\\s*(#[0-9a-fA-F]{6})`,
      "m",
    ).exec(css);
    if (!tDark) throw new Error(`missing dark .t-${color}`);
    dark.t[color] = tDark[1];

    // Light .b-<color>_background (background only, not the combined declaration block)
    const bLight = new RegExp(
      `^\\.b-${color}_background\\s*{\\s*background:\\s*(#[0-9a-fA-F]{6})`,
      "m",
    ).exec(css);
    if (!bLight) throw new Error(`missing light .b-${color}_background`);
    light.bBg[color] = bLight[1];

    // Dark .b-<color>_background via :root[data-theme="dark"]
    const bDark = new RegExp(
      `:root\\[data-theme="dark"\\]\\s*\\.b-${color}_background\\s*{\\s*background:\\s*(#[0-9a-fA-F]{6})`,
      "m",
    ).exec(css);
    if (!bDark) throw new Error(`missing dark .b-${color}_background`);
    dark.bBg[color] = bDark[1];
  }

  return { light, dark };
}

const MIN = 4.5; // WCAG AA body text
const PAD = (s: string, n: number) => s.padEnd(n);

function checkTheme(name: string, p: Palette): { failures: number; rows: string[] } {
  const rows: string[] = [];
  let failures = 0;
  const bgs: Array<{ label: string; hex: string }> = [
    { label: "--bg", hex: p.bg },
    ...COLORS.map((c) => ({ label: `.b-${c}_background`, hex: p.bBg[c] })),
  ];

  rows.push(`\n=== ${name} ===`);
  rows.push(`${PAD("text", 12)}${PAD("fg", 10)}${PAD("bg-class", 24)}${PAD("bg", 10)}ratio  AA`);
  for (const color of COLORS) {
    const fg = p.t[color];
    for (const bg of bgs) {
      const ratio = contrast(fg, bg.hex);
      const ok = ratio >= MIN;
      if (!ok) failures++;
      rows.push(
        `${PAD(`.t-${color}`, 12)}${PAD(fg, 10)}${PAD(bg.label, 24)}${PAD(bg.hex, 10)}${ratio.toFixed(2).padStart(5)}  ${ok ? "ok " : "FAIL"}`,
      );
    }
  }
  return { failures, rows };
}

function main() {
  const { light, dark } = extractPalettes(STYLE_CSS);

  let totalFail = 0;
  for (const [name, p] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    const { failures, rows } = checkTheme(name, p);
    for (const r of rows) console.log(r);
    totalFail += failures;
  }

  console.log(`\nTotal failures (< ${MIN}:1): ${totalFail}`);
  if (totalFail > 0) process.exit(1);
}

main();

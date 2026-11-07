// design-check: the WCAG contrast ratio of two colours, and whether it meets each level AA threshold.
// Node 22 or newer, no packages. It reads its arguments only: it opens no file, no connection and no process.
//   node contrast.mjs <foreground> <background> [--json]
// A colour is #RGB, #RRGGBB or rgb(r, g, b) with each value from 0 to 255, and opaque: blend a colour with
// transparency on its background first. Exit codes: 0 the result was printed, 2 usage error.
// Thresholds: WCAG 2.2 success criterion 1.4.3 (text, level AA) and 1.4.11 (non-text, level AA). The ratio is compared
// unrounded, as WCAG asks, and printed rounded down, so a printed 4.49 never hides a pass or a fail.

import { pathToFileURL } from 'node:url';

export const AA = Object.freeze({ text: 4.5, largeText: 3, nonText: 3 });

export function parseColour(value) {
  const text = String(value ?? '').trim();
  const short = text.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) return short.slice(1).map((digit) => parseInt(digit + digit, 16));
  const long = text.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (long) return long.slice(1).map((pair) => parseInt(pair, 16));
  const rgb = text.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (rgb) {
    const values = rgb.slice(1).map(Number);
    if (values.every((channel) => channel <= 255)) return values;
  }
  throw new Error(`not a colour: ${text || '(empty)'}. Use #RGB, #RRGGBB or rgb(r, g, b).`);
}

// Relative luminance as WCAG 2.2 defines it. The threshold 0.03928 below, from older WCAG texts, and the sRGB 0.04045
// give the same result for 8-bit values, so the ratios equal those of earlier WCAG versions.
export function luminance([red, green, blue]) {
  const linear = (channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

export function contrast(foreground, background) {
  const [lighter, darker] = [luminance(parseColour(foreground)), luminance(parseColour(background))].sort((left, right) => right - left);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  return {
    foreground: String(foreground).trim(),
    background: String(background).trim(),
    ratio,
    shown: Math.floor(ratio * 100) / 100,
    text: { criterion: '1.4.3', level: 'AA', needs: AA.text, pass: ratio >= AA.text },
    largeText: { criterion: '1.4.3', level: 'AA', needs: AA.largeText, pass: ratio >= AA.largeText },
    nonText: { criterion: '1.4.11', level: 'AA', needs: AA.nonText, pass: ratio >= AA.nonText },
  };
}

export function describe(result) {
  const word = (check) => (check.pass ? 'passes' : 'fails');
  return [
    `Contrast ${result.shown.toFixed(2)}:1 (${result.foreground} on ${result.background})`,
    `Text, WCAG 2.2 SC 1.4.3 level AA, needs ${result.text.needs}:1: ${word(result.text)}`,
    `Large text (at least 24 CSS px, or 18.66 CSS px bold), SC 1.4.3 level AA, needs ${result.largeText.needs}:1: ${word(result.largeText)}`,
    `Non-text (control borders, focus rings, icons that carry meaning), SC 1.4.11 level AA, needs ${result.nonText.needs}:1: ${word(result.nonText)}`,
  ].join('\n');
}

const USAGE = 'Usage: node contrast.mjs <foreground> <background> [--json]\nA colour is #RGB, #RRGGBB or rgb(r, g, b). Exit 0 printed, 2 usage error.';

export function main(argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  const colours = argv.filter((argument) => argument !== '--json');
  if (colours.length !== 2 || colours.some((argument) => argument.startsWith('--'))) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  let result;
  try {
    result = contrast(colours[0], colours[1]);
  } catch (error) {
    process.stderr.write(`contrast: ${error.message}\n${USAGE}\n`);
    return 2;
  }
  process.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : `${describe(result)}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}

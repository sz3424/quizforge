/**
 * Verify WCAG contrast for the QUIZFORGE answer-option and text states.
 *
 * Reads the real token values out of src/styles/globals.css, composites the
 * actual backgrounds produced by the answer-option classes, and reports the
 * contrast ratio of every text/background pair the UI renders.
 *
 * Run:  node scripts/check-contrast.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'src', 'styles', 'globals.css'), 'utf8');

/** Pull `--token: r g b;` pairs out of a given selector block. */
function readTokens(selector) {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`selector ${selector} not found in globals.css`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const block = css.slice(open + 1, close);

  const tokens = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*(\d+)\s+(\d+)\s+(\d+);/gi)) {
    tokens[match[1]] = [Number(match[2]), Number(match[3]), Number(match[4])];
  }
  return tokens;
}

const dark = readTokens(':root {');
const light = readTokens('.light {');

/** WCAG relative luminance. */
function luminance([r, g, b]) {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite an `rgb(var(--x) / a)` tint over an opaque backdrop. */
function tintOver(token, alpha, tokens, backdrop) {
  const [r, g, b] = tokens[token];
  return [
    Math.round(r * alpha + backdrop[0] * (1 - alpha)),
    Math.round(g * alpha + backdrop[1] * (1 - alpha)),
    Math.round(b * alpha + backdrop[2] * (1 - alpha)),
  ];
}

/**
 * Every (label, foreground, background) the question cards actually render.
 * Backgrounds mirror the composite values in globals.css / tailwind.config.js.
 */
function scenarios(tokens) {
  const card = tokens.card;
  const elevated = tokens.elevated;
  const accent = tokens.accent;

  const primaryOver = 0.16;
  const successOver = 0.14;
  const destructiveOver = 0.14;

  const selectedBg = tintOver('primary', primaryOver, tokens, card);
  const hoverBg = accent;
  const correctBg = tintOver('success', successOver, tokens, elevated);
  const incorrectBg = tintOver('destructive', destructiveOver, tokens, elevated);

  return [
    // The bug that was reported: plain options in the review screen.
    ['MCQ option (plain)', tokens['content-primary'], elevated],
    ['MCQ option (hover)', tokens['content-primary'], hoverBg],
    ['MCQ option (selected)', tokens['content-primary'], selectedBg],
    ['MCQ correct answer', tokens['content-primary'], correctBg],
    ['MCQ incorrect answer', tokens['content-primary'], incorrectBg],
    ['Option index badge', tokens['content-muted'], elevated],
    ['Correct badge text on success', tokens['success-foreground'], tokens.success],
    ['Your-pick badge on error', tokens['destructive-foreground'], tokens.destructive],
    ['Success badge text', tokens['success'], elevated],
    ['Destructive badge text', tokens['destructive'], elevated],
    // Explanation / supporting prose.
    ['Explanation text', tokens['content-secondary'], elevated],
    ['Secondary text on card', tokens['content-secondary'], card],
    ['Muted hint on card', tokens['content-muted'], card],
    ['Muted hint on elevated', tokens['content-muted'], elevated],
    // Status colours used by Badges / nav dots.
    ['Success text on elevated', tokens.success, elevated],
    ['Warning text on elevated', tokens.warning, elevated],
    ['Info text on elevated', tokens.info, elevated],
    ['Error text on elevated', tokens.destructive, elevated],
    ['Error text on card', tokens.destructive, card],
    // Body copy.
    ['Body text on background', tokens['content-primary'], tokens.background],
    ['Body text on card', tokens['content-primary'], card],
    ['Primary accent link on card', tokens.primary, card],
    // Chrome.
    ['Sidebar text', tokens['content-primary'], tokens.sidebar],
  ];
}

let failures = 0;

for (const [themeName, tokens] of [
  ['DARK', dark],
  ['LIGHT', light],
]) {
  console.log(`\n=== ${themeName} THEME ===`);
  const rows = scenarios(tokens);
  for (const [label, fg, bg] of rows) {
    const ratio = contrast(fg, bg);
    const small = ratio >= 4.5;
    const large = ratio >= 3;
    const ok = ratio >= 4.5;
    if (!ok) failures += 1;
    const verdict = ok ? 'PASS AA' : ratio >= 3 ? 'AA-large only' : 'FAIL';
    console.log(
      `  ${label.padEnd(32)} ${ratio.toFixed(2).padStart(6)}:1  ${verdict}` +
        (small ? '' : large ? '  (large text only)' : '')
    );
  }
}

console.log('');
if (failures > 0) {
  console.log(`${failures} contrast check(s) failed.`);
  process.exit(1);
}
console.log('All contrast checks meet WCAG AA (4.5:1) for normal text.');
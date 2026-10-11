/**
 * Read the *computed* colours of the rendered answer options and explanation
 * blocks in a real browser, and report their contrast ratios.
 *
 * Usage: node scripts/measure-options.mjs <url>
 */

const url = process.argv[2];
const DEBUG_PORT = 9333;

async function getTarget() {
  const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  return page.webSocketDebuggerUrl;
}

let id = 0;
const pending = new Map();

function send(ws, method, params = {}) {
  const messageId = ++id;
  return new Promise((resolve, reject) => {
    pending.set(messageId, { resolve, reject });
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });
}

const ws = new WebSocket(await getTarget());
await new Promise((r) => ws.addEventListener('open', r));

const MEASURE = `(() => {
  function parse(color) {
    const m = color.match(/[\\d.]+/g);
    if (!m) return null;
    return { r: +m[0], g: +m[1], b: +m[2], a: m[3] === undefined ? 1 : +m[3] };
  }
  function over(fg, bg) {
    return {
      r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
      g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
      b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
      a: 1,
    };
  }
  function lum(c) {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function ratio(a, b) {
    const l1 = lum(a), l2 = lum(b);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  const results = [];
  const nodes = [...document.querySelectorAll('.answer-option, .explanation-block')];

  // Resolve a node's effective background by compositing every semi-transparent
  // layer up the ancestor chain onto the first fully opaque ancestor.
  function resolveBg(node) {
    const layers = [];
    let el = node;
    while (el) {
      const c = parse(getComputedStyle(el).backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 1) {
          let base = c;
          for (let i = layers.length - 2; i >= 0; i -= 1) base = over(layers[i], base);
          return base;
        }
      }
      el = el.parentElement;
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i -= 1) base = over(layers[i], base);
    return base;
  }

  for (const node of nodes) {
    const bg = resolveBg(node);
    // Check every element that actually renders text inside this block.
    const carriers = [node, ...node.querySelectorAll('span')];
    let worst = { ratio: Infinity, fg: '', text: '' };

    for (const carrier of carriers) {
      const hasOwnText = [...carrier.childNodes].some(
        (n) => n.nodeType === 3 && n.textContent.trim().length > 0
      );
      if (!hasOwnText) continue;
      const fg = parse(getComputedStyle(carrier).color);
      if (!fg) continue;
      const effective = fg.a < 1 ? over(fg, bg) : fg;
      const r = ratio(effective, bg);
      if (r < worst.ratio) {
        worst = {
          ratio: Math.round(r * 100) / 100,
          fg: getComputedStyle(carrier).color,
          text: (carrier.textContent || '').trim().slice(0, 44),
        };
      }
    }

    if (!isFinite(worst.ratio)) continue;

    results.push({
      cls: node.className.split(' ').slice(0, 2).join(' '),
      text: worst.text,
      fg: worst.fg,
      bg: 'rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')',
      ratio: worst.ratio,
      pass: worst.ratio >= 4.5,
    });
  }
  return JSON.stringify({ count: results.length, results }, null, 1);
})()`;

ws.addEventListener('message', async (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});

await send(ws, 'Page.enable');
await send(ws, 'Runtime.enable');
await send(ws, 'Page.navigate', { url });
await new Promise((r) => setTimeout(r, 7000));

const { result } = await send(ws, 'Runtime.evaluate', { expression: MEASURE, returnByValue: true });
const data = JSON.parse(result.value);

console.log(`measured ${data.count} rendered option/explanation blocks\n`);
let failures = 0;
for (const r of data.results) {
  if (!r.pass) failures += 1;
  console.log(
    `  ${r.ratio.toFixed(2).padStart(6)}:1  ${r.pass ? 'PASS' : 'FAIL'}  ${r.cls.padEnd(30)} ${r.fg} on ${r.bg}  | ${r.text}`
  );
}
console.log('');
console.log(failures === 0 ? 'All rendered blocks meet WCAG AA (4.5:1).' : `${failures} rendered block(s) below 4.5:1.`);
process.exit(failures === 0 ? 0 : 1);
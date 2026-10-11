/**
 * Navigate, force a theme, then capture a full-page screenshot.
 * Usage: node shot.mjs <url> <light|dark> <output.png> [height]
 */
import { writeFileSync } from 'node:fs';

const [url, theme, out, heightArg] = process.argv.slice(2);
const height = Number(heightArg ?? 1600);
const port = 9333;

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);

let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const messageId = ++id;
    pending.set(messageId, { resolve, reject });
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});

await new Promise((r) => ws.addEventListener('open', r));
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1400,
  height,
  deviceScaleFactor: 1,
  mobile: false,
});

await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, 3500));

await send('Runtime.evaluate', {
  expression: `localStorage.setItem('theme','${theme}')`,
  returnByValue: true,
});
await send('Page.navigate', { url: 'about:blank' });
await new Promise((r) => setTimeout(r, 500));
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, 5000));

const { data } = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(data, 'base64'));
console.log(`wrote ${out}`);
process.exit(0);
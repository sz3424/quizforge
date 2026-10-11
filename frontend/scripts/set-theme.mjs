/** Set the stored theme preference in the running page. Usage: node set-theme.mjs <light|dark> */
const theme = process.argv[2] ?? 'dark';
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
await send('Page.navigate', { url: 'http://localhost:5173/settings' });
await new Promise((r) => setTimeout(r, 4000));

const expression = `localStorage.setItem('theme', '${theme}'); location.reload(); 'set:${theme}'`;
const { result } = await send('Runtime.evaluate', { expression, returnByValue: true });
console.log(result.value);
process.exit(0);
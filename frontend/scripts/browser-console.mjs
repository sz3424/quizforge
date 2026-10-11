/**
 * Capture browser console output and uncaught exceptions for a URL using the
 * Chrome DevTools Protocol. Node 24 ships a global WebSocket, so no packages.
 *
 * Usage: node scripts/browser-console.mjs <url>
 */

const url = process.argv[2];
if (!url) {
  console.error('usage: node scripts/browser-console.mjs <url>');
  process.exit(1);
}

const DEBUG_PORT = 9333;

async function getTarget() {
  const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target found');
  return page.webSocketDebuggerUrl;
}

let id = 0;
const pending = new Map();
const logs = [];

function send(ws, method, params = {}) {
  const messageId = ++id;
  return new Promise((resolve, reject) => {
    pending.set(messageId, { resolve, reject });
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });
}

const ws = new WebSocket(await getTarget());

ws.addEventListener('open', async () => {
  await send(ws, 'Runtime.enable');
  await send(ws, 'Log.enable');
  await send(ws, 'Page.enable');
  await send(ws, 'Page.navigate', { url });
});

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);

  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    return;
  }

  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = (msg.params.args ?? [])
      .map((a) => a.value ?? a.description ?? a.type)
      .join(' ');
    logs.push(`[console.${msg.params.type}] ${text}`);
  }

  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    logs.push(`[exception] ${d.exception?.description ?? d.text}`);
  }

  if (msg.method === 'Log.entryAdded') {
    logs.push(`[log.${msg.params.entry.level}] ${msg.params.entry.text}`);
  }
});

setTimeout(async () => {
  try {
    const { result } = await send(ws, 'Runtime.evaluate', {
      expression: 'JSON.stringify({ rootChildren: document.getElementById("root")?.children.length ?? -1, bg: getComputedStyle(document.body).backgroundColor })',
      returnByValue: true,
    });
    console.log('--- page state ---');
    console.log(result.value);
  } catch (e) {
    console.log('evaluate failed:', e.message);
  }

  console.log('--- console output ---');
  console.log(logs.length ? logs.join('\n') : '(no console output captured)');
  process.exit(0);
}, 6000);
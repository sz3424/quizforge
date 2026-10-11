/**
 * End-to-end test of the PDF processing flow in a real browser.
 *
 * Drives the actual UI (file input -> "Process document" -> generate) against
 * the built bundle, which is what Netlify serves. Run the static server and the
 * API on two different origins first so CORS is genuinely exercised.
 *
 * Usage: node scripts/e2e-upload.mjs <appUrl> <pdfPath>
 */

import { writeFileSync } from 'node:fs';

const appUrl = process.argv[2] ?? 'http://127.0.0.1:5174';
const pdfPath = process.argv[3] ?? '../test.pdf';
const port = 9333;

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);

let id = 0;
const pending = new Map();
const logs = [];

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
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = (msg.params.args ?? []).map((a) => a.value ?? a.description).join(' ');
    if (/error|fail|blocked|CORS/i.test(text)) logs.push(`[console.${msg.params.type}] ${text}`);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    logs.push(`[exception] ${msg.params.exceptionDetails.exception?.description ?? ''}`);
  }
  if (msg.method === 'Network.loadingFailed') {
    logs.push(`[network] ${msg.params.errorText} (${msg.params.type})`);
  }
});

const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) {
    throw new Error(`${exceptionDetails.text} ${exceptionDetails.exception?.description ?? ''}`);
  }
  return result.value;
};

const waitFor = async (expression, label, timeoutMs = 45000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for: ${label}`);
};

const bodyText = 'document.body.innerText';
const reachErrExpr = `/couldn['’]t reach the backend|network error|failed to fetch/i.test(${bodyText})`;

await new Promise((r) => ws.addEventListener('open', r));
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('DOM.enable');

// --- 1. App loads and can reach the API cross-origin ---------------------------
await send('Page.navigate', { url: `${appUrl}/create` });
await new Promise((r) => setTimeout(r, 4500));

const mounted = await evaluate(`
  (() => {
    const el = document.getElementById('root');
    return el && el.children.length > 0 ? 'mounted' : 'blank-root';
  })()
`);
console.log(`1. app root: ${mounted}`);
if (mounted !== 'mounted') {
  console.log('FAILED: app did not mount');
  process.exit(1);
}

// --- 2. Attach the PDF ---------------------------------------------------------
const { root } = await send('DOM.getDocument');
const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
if (!nodeId) {
  console.log('FAILED: no file input on /create');
  process.exit(1);
}
await send('DOM.setFileInputFiles', { nodeId, files: [pdfPath] });

// setFileInputFiles does not reliably fire React's onChange; dispatch it.
await evaluate(`
  (() => {
    const input = document.querySelector('input[type=file]');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()
`);
console.log(`2. attached ${pdfPath}`);

await waitFor(`${bodyText}.includes('ready to upload')`, 'file accepted by app state');
console.log('   app state shows "ready to upload"');

// --- 3. Process document -------------------------------------------------------
const clicked = await evaluate(`
  (() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => /process document/i.test(b.textContent || ''));
    if (!btn) return 'no-button';
    if (btn.disabled) return 'disabled';
    btn.click();
    return 'clicked';
  })()
`);
console.log(`3. process button -> ${clicked}`);
if (clicked !== 'clicked') {
  console.log('FAILED: could not click process button');
  process.exit(1);
}

// --- 4. Preview step (proves the PDF reached the backend) ----------------------
// Wait for the real preview UI, not the upload step's static copy.
await waitFor(
  `/Continue to quiz configuration/i.test(${bodyText})`,
  'upload response rendered as preview'
);
const preview = await evaluate(`
  (() => {
    const text = ${bodyText};
    return JSON.stringify({
      pages: (text.match(/\\b\\d+\\s+pages?\\b/i) || [])[0] || null,
      words: (text.match(/\\b\\d+\\s+words?\\b/i) || [])[0] || null,
      reachErr: ${reachErrExpr},
      hasExtracted: /extracted/i.test(text),
    });
  })()
`);
const pv = JSON.parse(preview);
console.log(`4. preview rendered; ${pv.pages ?? '?'}, ${pv.words ?? '?'}, extracted=${pv.hasExtracted}; reachErr=${pv.reachErr}`);
if (pv.reachErr) {
  console.log('FAILED: backend-unreachable error shown');
  process.exit(1);
}

// --- 5. Continue to the configuration step ------------------------------------
const continued = await evaluate(`
  (() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => /continue to quiz configuration/i.test(b.textContent || '') && !b.disabled);
    if (!btn) return 'no-button';
    btn.click();
    return 'clicked';
  })()
`);
console.log(`5. continue -> ${continued}`);
if (continued !== 'clicked') {
  console.log('FAILED: could not reach the configuration step');
  process.exit(1);
}

// --- 6. Generate the quiz ------------------------------------------------------
await waitFor(
  `new RegExp('Generate|Create quiz|Build quiz', 'i').test(${bodyText})`,
  'configuration form to render'
);
const gen = await evaluate(`
  (() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => /generate|create quiz|build quiz/i.test(b.textContent || '') && !b.disabled);
    if (!btn) return 'no-button';
    btn.click();
    return 'clicked';
  })()
`);
console.log(`6. generate button -> ${gen}`);
if (gen !== 'clicked') {
  console.log('FAILED: no enabled generate button');
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('e2e-upload-result.png', Buffer.from(shot.data, 'base64'));
  const dump = await evaluate(bodyText);
  console.log('--- page text ---');
  console.log(String(dump).replace(/\s+/g, ' ').slice(0, 900));
  process.exit(1);
}

// --- 6. Quiz rendered ----------------------------------------------------------
await waitFor(`location.pathname.includes('/review')`, 'navigation to review screen');
console.log('7. navigated to review screen');

const summary = await evaluate(`
  (() => {
    const text = ${bodyText};
    return JSON.stringify({
      path: location.pathname,
      offline: /offline/i.test(text),
      reachErr: ${reachErrExpr},
      count: (text.match(/Question\\s*\\d+\\s*of\\s*(\\d+)/i) || [])[1] ?? null,
      snippet: text.replace(/\\s+/g, ' ').slice(0, 260),
    });
  })()
`);
const parsed = JSON.parse(summary);
console.log(`   url            : ${parsed.path}`);
console.log(`   questions      : ${parsed.count ?? 'unknown'}`);
console.log(`   offline label  : ${parsed.offline}`);
console.log(`   reach error    : ${parsed.reachErr ? 'YES (BAD)' : 'no'}`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('e2e-upload-result.png', Buffer.from(shot.data, 'base64'));

if (logs.length) {
  console.log('\nconsole/network issues:');
  console.log(logs.join('\n'));
}

const ok = !parsed.reachErr && parsed.offline;
console.log(ok ? '\nE2E UPLOAD FLOW: PASS' : '\nE2E UPLOAD FLOW: FAIL');
process.exit(ok ? 0 : 1);
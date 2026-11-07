// レンダラーの計測（headless Chrome を CDP で操作）。
// 使い方: python3 -m http.server 8123 を起動してから
//   node dev/render-bench.mjs '[{"q":"theme=seaside&hour=11&zoom=1","throttle":6,"dpr":2}]'
// q は dev/render-preview.html のクエリ（bench=60 を自動で付ける）。結果は ms/frame（render() の時間）。
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9300 + ((Math.random() * 90) | 0);
const prof = mkdtempSync(join(tmpdir(), 'rbench-'));
const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, '--enable-precise-memory-info', '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(path) { for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: path.startsWith('/json/new') ? 'PUT' : 'GET' }); return await r.json(); } catch { await sleep(200); } } throw new Error('cdp'); }
async function run(url, { throttle = 1, dpr = 1, w = 1400, h = 900 } = {}) {
  const t = await json('/json/new?about:blank');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d.result); pend.delete(d.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
  await send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await send('Page.navigate', { url });
  let res = null;
  for (let i = 0; i < 900; i++) { await sleep(500); const r = await send('Runtime.evaluate', { expression: 'window.__bench || window.__stress || ""', returnByValue: true }); if (r && r.result && r.result.value) { res = r.result.value; break; } }
  ws.close(); try { await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`); } catch {}
  return res;
}
const base = process.env.BASE || 'http://localhost:8123/dev/render-preview.html?hud=0&speed=0&bomb=0&santa=0';
for (const c of JSON.parse(process.argv[2])) console.log(JSON.stringify({ q: c.q, throttle: c.throttle, dpr: c.dpr, r: await run(`${base}&${c.q}${c.n === 0 ? "" : "&bench=" + (c.n || 60)}`, c) }));
proc.kill();

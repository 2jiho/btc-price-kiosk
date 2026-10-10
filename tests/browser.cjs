// node tests/browser.cjs; optional real exchange smoke: LIVE_NETWORK=1
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { waitForAsyncState } = require('./browser-utils.cjs');
const root = path.join(__dirname, '..');
const baseline = '0348caff88ddf8880d50aaaaca58fc2855abbf93';
let baselineRef = baseline;
const original = name => execFileSync('git', ['show', baselineRef + ':' + name], { cwd: root });
let old = false, htmlRevision = false, swRevision = false;
const serverHistory = [];
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const name = pathname.replace(/^\/btc-price-kiosk\//, '') || 'index.html';
  if (!['index.html', 'service-worker.js', 'manifest.json', 'bitcoin-btc-logo.svg', 'wake-lock.js', 'market-data.js', 'icons/apple-touch-icon-152.png', 'icons/apple-touch-icon-167.png', 'icons/apple-touch-icon-180.png', 'icons/home-icon-192.png', 'icons/home-icon-512.png'].includes(name)) {
    res.writeHead(404); res.end(); return;
  }
  const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.html') ? 'text/html' : name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.png') ? 'image/png' : 'application/json';
  res.setHeader('Content-Type', type + '; charset=utf-8'); res.setHeader('Cache-Control', 'no-cache');
  let content = old && !name.startsWith('icons/') && !['wake-lock.js', 'market-data.js'].includes(name) ? original(name) : fs.readFileSync(path.join(root, name));
  serverHistory.push({ pathname, old, swRevision, htmlNew: name === 'index.html' ? content.toString().includes('id="currency-controls"') : null });
  if (htmlRevision && name === 'index.html') content = content.toString().replace('</body>', '<div id="html-only-update" hidden></div></body>');
  if (swRevision && name === 'service-worker.js') content = content.toString().replace(' + "v7"', ' + "v8"');
  res.end(content);
});
async function deterministicNetwork(context) {
  await context.route('https://**/*', route => route.abort());
  await context.addInitScript(() => {
    window.sockets = []; window.sent = []; window.suppressTicks = false;
    window.WebSocket = class {
      static OPEN = 1;
      constructor(url) {
        this.url = url; this.readyState = 0;
        this.market = url.includes('upbit') ? 'KRW-BTC' : url.includes('/ws/') ? url.split('/ws/')[1].split('@')[0].toUpperCase() : 'BTCUSDT';
        window.sockets.push(this);
        setTimeout(() => {
          if (this.readyState === 3) return;
          this.readyState = 1; this.onopen?.();
          if (!url.includes('upbit') && !url.includes('ws-api')) this.emit();
          this.timer = setInterval(() => this.emit(), 1000);
        }, 0);
      }
      emit(values = {}) {
        if (this.readyState !== 1 || window.suppressTicks) return;
        const upbit = this.url.includes('upbit');
        const data = upbit ? { type: 'ticker', code: this.market, trade_price: 98000000,
          signed_change_rate: -0.025, timestamp: Date.now(), ...values } :
          { e: '24hrTicker', s: this.market, c: '70000.10', P: '2.5', E: Date.now(), ...values };
        this.onmessage?.({ data: upbit ? new TextEncoder().encode(JSON.stringify(data)).buffer : JSON.stringify(data) });
      }
      send(text) {
        window.sent.push(text);
        if (text === 'PING') { this.onmessage?.({ data: '{"status":"UP"}' }); return; }
        const request = JSON.parse(text);
        if (Array.isArray(request)) { this.market = request[1].codes[0]; this.emit(); }
        else if (request.method) {
          const result = request.method === 'ping' ? {} : { symbol: request.params.symbol, lastPrice: '70000', priceChangePercent: '2.5' };
          this.onmessage?.({ data: JSON.stringify({ result }) });
        }
      }
      close() { this.readyState = 3; clearInterval(this.timer); this.onclose?.({ code: 1000, reason: '' }); }
    };
    if (!localStorage.getItem('btc-kiosk-settings')) localStorage.setItem('btc-kiosk-settings', JSON.stringify({ ticker: 'BTC', interval: 5000, brightness: 100 }));
    localStorage.setItem('btc-last-exchange-rate', JSON.stringify({ rate: 1400 }));
    const nativeRequest = navigator.wakeLock?.request.bind(navigator.wakeLock);
    window.wakeRequests = 0;
    if (nativeRequest) navigator.wakeLock.request = async (...args) => {
      window.wakeRequests++; window.testSentinel = await nativeRequest(...args); return window.testSentinel;
    };
  });
}
async function live(page) {
  await page.waitForFunction(() => document.getElementById('status-indicator').className === 'connected');
}
async function validateIcons(page) {
  const report = await page.evaluate(async () => {
    const manifest = await (await fetch('manifest.json')).json();
    const sources = [...document.querySelectorAll('link[rel="apple-touch-icon"]')].map(el => el.href)
      .concat(manifest.icons.map(icon => new URL(icon.src, location.href).href));
    const result = [];
    for (const src of sources) {
      const image = new Image(); image.src = src; await image.decode();
      const size = image.naturalWidth;
      if (size !== image.naturalHeight) throw new Error('Non-square icon');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, size, size).data;
      let radius = 0, symbolPixels = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] !== 255 || pixels[i] < 247 || pixels[i + 1] < 147 || pixels[i + 2] < 26) throw new Error('Transparent/dark icon pixel');
        if (pixels[i] !== 247 || pixels[i + 1] !== 147 || pixels[i + 2] !== 26) {
          symbolPixels++; const n = i / 4;
          radius = Math.max(radius, Math.hypot(n % size + 0.5 - size / 2, Math.floor(n / size) + 0.5 - size / 2));
        }
      }
      if (!symbolPixels || radius > size * 0.4) throw new Error('Invalid maskable safe area');
      const corners = [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
      result.push({ src, size, corners, opaquePixels: size * size, symbolPixels, radius, safeRadius: size * 0.4 });
    }
    if (getComputedStyle(document.body).backgroundColor !== 'rgb(0, 0, 0)') throw new Error('Kiosk background changed');
    return result;
  });
  assert.deepEqual(report.map(item => item.size), [180, 167, 152, 192, 512]);
  for (const item of report) for (const corner of item.corners) assert.deepEqual(corner, [247, 147, 26, 255]);
  return report;
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://localhost:${server.address().port}/btc-price-kiosk/`;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  try {
    const probeContext = await browser.newContext(); const probePage = await probeContext.newPage();
    const falseHandle = await probePage.waitForFunction(async () => false, null, { timeout: 1000 });
    assert.equal(await falseHandle.jsonValue(), false); await falseHandle.dispose();
    await waitForAsyncState(probePage, async () => {
      await Promise.resolve(); window.stateProbe = (window.stateProbe || 0) + 1; return window.stateProbe === 3;
    });
    assert.equal(await probePage.evaluate(() => stateProbe), 3);
    console.log('PASS wait regression: installed SDK async false returns immediately; corrected helper awaits three actual evaluations');
    await probeContext.close();
    if (process.env.SW_ONLY !== '1') {
      await require('./kiosk-ui.cjs')(browser, base, root, deterministicNetwork, value => { swRevision = value; });
      const iconsContext = await browser.newContext(); const iconsPage = await iconsContext.newPage();
      await deterministicNetwork(iconsContext); await iconsPage.goto(base);
      const iconReport = await validateIcons(iconsPage);
      fs.writeFileSync(path.join(root, '../evidence/icon-pixel-checks.json'), JSON.stringify(iconReport, null, 2));
      await iconsContext.close();
    }
    for (const sourceRef of [baseline, '0282223d45a32e418f1ce8b3c3b36de7af164d5e', '616f8c48af4c9a64eb5085cc876e7f83476b484f', '563526c230610c3be4cd073d662e3be20867248e']) {
    baselineRef = sourceRef;
    for (const entry of ['', 'index.html']) {
      old = true; htmlRevision = false;
      const c = await browser.newContext(); await deterministicNetwork(c);
      const p = await c.newPage(); await p.goto(base + entry);
      await p.evaluate(async () => { await navigator.serviceWorker.ready; });
      // v1 calls clients.claim outside waitUntil: being controlled does not
      // prove its activation/cache cleanup has finished. Settle it first.
      await waitForAsyncState(p, async () => {
        const r = await navigator.serviceWorker.getRegistration();
        return !!navigator.serviceWorker.controller && r.active?.state === 'activated' && !r.installing;
      });
      await p.reload({ waitUntil: 'domcontentloaded' });
      await p.evaluate(async () => { const cache = await caches.open('another-app-v1'); await cache.put('/another-app/', new Response('keep')); });
      if (sourceRef === baseline) assert.equal(await p.locator('#currency-controls').count(), 0);
      else assert.equal(await p.locator('#currency-controls').isVisible(), sourceRef === '0282223d45a32e418f1ce8b3c3b36de7af164d5e');
      old = false;
      await p.evaluate(async () => {
        window.previousController = navigator.serviceWorker.controller;
        await (await navigator.serviceWorker.getRegistration()).update();
      });
      await waitForAsyncState(p, async () => {
        const r = await navigator.serviceWorker.getRegistration();
        if (r.active?.state !== 'activated' || r.installing || r.waiting || !navigator.serviceWorker.controller) return false;
        const version = await new Promise(resolve => {
          const channel = new MessageChannel();
          const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 500);
          channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
          navigator.serviceWorker.controller.postMessage({ type: 'GET_APP_VERSION' }, [channel.port2]);
        });
        return version?.cacheName.endsWith(':v7');
      });
      await p.reload({ waitUntil: 'domcontentloaded' });
      try { await p.waitForSelector('#currency-controls', { state: 'attached', timeout: 10000 }); }
      catch (error) {
        console.log('MIGRATION DIAGNOSTIC', entry || 'root', serverHistory.slice(-20), await p.evaluate(async () => {
          const records = [];
          for (const name of await caches.keys()) {
            const cache = await caches.open(name);
            for (const request of await cache.keys()) {
              if (request.url.endsWith('index.html')) records.push({ name, url: request.url, htmlNew: (await (await cache.match(request)).text()).includes('id="currency-controls"') });
            }
          }
          return { records, controller: navigator.serviceWorker.controller?.state, documentNew: !!document.getElementById('currency-controls') };
        }));
        throw error;
      }
      assert.equal(await p.evaluate(async () => (await caches.keys()).includes('another-app-v1')), true);
      htmlRevision = true;
      await p.goto(base); assert.equal(await p.locator('#html-only-update').count(), 1);
      await p.goto(base + 'index.html'); assert.equal(await p.locator('#html-only-update').count(), 1);
      const keys = await p.evaluate(async () => { const n = (await caches.keys()).find(n => n.endsWith(':v7')); return (await (await caches.open(n)).keys()).map(r => r.url); });
      assert.equal(keys.length, 10); assert.equal(keys.some(url => url === base), false);
      await waitForAsyncState(p, async () => {
        const name = (await caches.keys()).find(n => n.endsWith(':v7'));
        const response = await (await caches.open(name)).match(new URL('index.html', location.href).href);
        return (await response.text()).includes('id="html-only-update"');
      });
      await c.setOffline(true); await p.goto(base); assert.equal(await p.locator('#html-only-update').count(), 1);
      await validateIcons(p);
      assert.match(await p.locator('#status-indicator').textContent(), /오프라인/);
      await p.goto(base + 'index.html'); assert.equal(await p.locator('#html-only-update').count(), 1);
      console.log(`PASS ${sourceRef === baseline ? 'v1' : sourceRef === '0282223d45a32e418f1ce8b3c3b36de7af164d5e' ? 'v3' : sourceRef === '616f8c48af4c9a64eb5085cc876e7f83476b484f' ? 'v5' : 'v6'} -> v7 from ${entry || 'root'}: upgrade, root/index HTML refresh, offline shell (no cached market price), unrelated cache preserved`);
      await c.close();
    }
    }
    old = false; htmlRevision = false;
    if (process.env.LIVE_NETWORK === '1' && process.env.SW_ONLY !== '1') {
      const c = await browser.newContext({ viewport: { width: 1024, height: 768 } });
      const p = await c.newPage(); const socketErrors = [];
      p.on('console', msg => { if (msg.type() === 'error') socketErrors.push(msg.text()); });
      await p.goto(base);
      await p.keyboard.press('Tab'); await p.locator('#settings-toggle').click();
      for (const currency of ['KRW', 'USDT']) {
        await p.locator(`[data-currency="${currency}"]`).click();
        try {
          await p.waitForFunction(() => document.getElementById('status-indicator').className === 'connected', null, { timeout: 25000 });
          console.log('LIVE PASS', currency, await p.locator('#price-main').textContent(), await p.locator('#price-source').textContent());
          await p.screenshot({ path: path.join(root, `../evidence/live-${currency.toLowerCase()}.png`) });
          if (currency === 'KRW') {
            await p.waitForTimeout(32000);
            assert.equal(await p.locator('#status-indicator').getAttribute('class'), 'connected');
            console.log('LIVE PASS KRW: still receiving tickers after first 30-second text PING');
          }
        } catch (_) { console.log('LIVE NOT VERIFIED', currency, await p.locator('#status-indicator').textContent(), socketErrors.slice(-2)); }
      }
      await c.close();
    }
  } finally {
    fs.mkdirSync(path.join(root, '../evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, '../evidence/browser-server-history.json'), JSON.stringify(serverHistory, null, 2));
    await browser.close(); server.close();
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });

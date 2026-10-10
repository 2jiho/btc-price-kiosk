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
const original = name => execFileSync('git', ['show', baseline + ':' + name], { cwd: root });
let old = false, htmlRevision = false, swRevision = false;
const serverHistory = [];
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const name = pathname.replace(/^\/btc-price-kiosk\//, '') || 'index.html';
  if (!['index.html', 'service-worker.js', 'manifest.json', 'bitcoin-btc-logo.svg', 'wake-lock.js', 'market-data.js'].includes(name)) {
    res.writeHead(404); res.end(); return;
  }
  const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.html') ? 'text/html' : name.endsWith('.svg') ? 'image/svg+xml' : 'application/json';
  res.setHeader('Content-Type', type + '; charset=utf-8'); res.setHeader('Cache-Control', 'no-cache');
  let content = old && !['wake-lock.js', 'market-data.js'].includes(name) ? original(name) : fs.readFileSync(path.join(root, name));
  serverHistory.push({ pathname, old, swRevision, htmlNew: name === 'index.html' ? content.toString().includes('id="currency-controls"') : null });
  if (htmlRevision && name === 'index.html') content = content.toString().replace('</body>', '<div id="html-only-update" hidden></div></body>');
  if (swRevision && name === 'service-worker.js') content = content.toString().replace(' + "v3"', ' + "v4"');
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
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    await deterministicNetwork(context);
    const page = await context.newPage(); const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
    await page.clock.install();
    await page.goto(base); await live(page);
    assert.match(await page.locator('#price-main').textContent(), /98,000,000/);
    assert.equal(await page.locator('#change-label').textContent(), '전일 대비');
    assert.equal(await page.evaluate(() => sockets.length), 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('btc-last-exchange-rate')), null);
    await page.waitForFunction(() => document.getElementById('wake-lock-status').textContent.includes('활성'));
    await page.evaluate(() => testSentinel.release());
    await page.getByRole('button', { name: '화면 켜짐 유지 다시 시도' }).click();
    await page.waitForFunction(() => wakeRequests === 2 && document.getElementById('wake-lock-status').textContent.includes('활성'));
    fs.mkdirSync(path.join(root, '../evidence'), { recursive: true });
    await page.screenshot({ path: path.join(root, '../evidence/kiosk-krw.png') });
    await page.evaluate(() => { suppressTicks = true; window.lateMessage = sockets[0].onmessage; window.lateClose = sockets[0].onclose; });
    await page.getByRole('button', { name: 'USDT · 바이낸스' }).click();
    assert.equal(await page.locator('#price-main').textContent(), '—');
    assert.equal(await page.locator('#price-source').textContent(), '바이낸스 · BTC/USDT');
    await page.evaluate(() => {
      lateMessage({ data: JSON.stringify({ type: 'ticker', code: 'KRW-BTC', trade_price: 1, signed_change_rate: 0, timestamp: Date.now() }) });
      lateClose(); suppressTicks = false; sockets.at(-1).emit();
    });
    await live(page); assert.equal(await page.locator('#price-main').textContent(), '70,000.10 USDT');
    assert.equal(await page.locator('#change-label').textContent(), '24h');
    await page.screenshot({ path: path.join(root, '../evidence/kiosk-usdt.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await page.locator('#container').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    assert.ok((await page.locator('[data-currency="USDT"]').boundingBox()).height >= 44);
    await page.screenshot({ path: path.join(root, '../evidence/kiosk-mobile.png') });
    await page.setViewportSize({ width: 1024, height: 768 });
    for (let i = 0; i < 10; i++) {
      await page.locator('[data-currency="KRW"]').click(); await page.locator('[data-currency="USDT"]').click();
    }
    await page.clock.fastForward(11000); await live(page);
    assert.equal(await page.evaluate(() => sockets.filter(s => s.readyState !== 3).length), 1);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('btc-kiosk-settings')).currency), 'USDT');
    await page.reload(); await page.clock.fastForward(3000); await live(page);
    assert.equal(await page.locator('[data-currency="USDT"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#price-source').textContent(), '바이낸스 · BTC/USDT');
    await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); });
    assert.equal(await page.evaluate(() => sockets.filter(s => s.readyState !== 3).length), 0);
    await page.evaluate(() => { suppressTicks = true; window.dispatchEvent(new Event('pageshow')); });
    await page.clock.fastForward(3000);
    assert.notEqual(await page.locator('#status-indicator').getAttribute('class'), 'connected');
    await page.evaluate(() => { suppressTicks = false; sockets.at(-1).emit(); }); await live(page);
    await page.evaluate(() => { suppressTicks = true; }); await page.clock.fastForward(16000);
    assert.match(await page.locator('#status-indicator').textContent(), /시세 업데이트 지연/);
    assert.match(await page.locator('#overlay-msg').textContent(), /마지막 시세: 70,000.10 USDT/);
    await page.evaluate(() => { suppressTicks = false; }); await page.clock.fastForward(3000); await live(page);
    await page.locator('#status-indicator').focus(); await page.keyboard.press('Enter');
    await page.locator('#admin-symbol').fill('bad!'); await page.locator('#admin-save').click();
    assert.equal(await page.evaluate(() => document.getElementById('admin-panel').style.display), 'flex');
    await page.locator('#admin-symbol').fill('ETH'); await page.locator('#admin-save').click();
    assert.equal(await page.locator('#price-main').textContent(), '—');
    await page.clock.fastForward(3000); await live(page);
    assert.equal(await page.locator('#price-source').textContent(), '바이낸스 · ETH/USDT');
    // Raw stream's symbol is derived from its URL, as the real exchange does.
    await page.evaluate(() => sockets.at(-1).emit({ c: 'Infinity' }));
    assert.equal(await page.locator('#price-main').textContent(), '70,000.10 USDT');
    await page.evaluate(() => sockets.at(-1).onmessage({ data: JSON.stringify({ error: { name: 'INVALID_PARAM' } }) }));
    await page.waitForFunction(() => !document.getElementById('market-retry').hidden);
    await page.getByRole('button', { name: '시세 다시 연결' }).click();
    await page.clock.fastForward(3000); await live(page);
    assert.equal(requests.some(url => /frankfurter|currency-api|manana/.test(url)), false);
    assert.deepEqual(errors, []);
    console.log('PASS Chrome mock feeds: KRW/USDT prices and labels, repeated switches, late events, saved choice, background/resume, stale data, ticker validation, keyboard settings, no FX requests, no page errors');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    swRevision = true;
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
    await page.waitForFunction(() => !document.getElementById('app-update').hidden);
    await page.getByRole('button', { name: '새 버전 적용 (새로고침)' }).click();
    await page.waitForFunction(() => document.getElementById('app-update').hidden);
    console.log('PASS native Wake Lock acquire/release/retry and user-applied SW refresh');
    await context.close(); swRevision = false;
    }
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
      assert.equal(await p.locator('#currency-controls').count(), 0); old = false;
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
        return version?.cacheName.endsWith(':v3');
      });
      await p.reload({ waitUntil: 'domcontentloaded' });
      try { await p.waitForSelector('#currency-controls', { timeout: 10000 }); }
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
      const keys = await p.evaluate(async () => { const n = (await caches.keys()).find(n => n.endsWith(':v3')); return (await (await caches.open(n)).keys()).map(r => r.url); });
      assert.equal(keys.length, 5); assert.equal(keys.some(url => url === base), false);
      await waitForAsyncState(p, async () => {
        const name = (await caches.keys()).find(n => n.endsWith(':v3'));
        const response = await (await caches.open(name)).match(new URL('index.html', location.href).href);
        return (await response.text()).includes('id="html-only-update"');
      });
      await c.setOffline(true); await p.goto(base); assert.equal(await p.locator('#html-only-update').count(), 1);
      assert.match(await p.locator('#status-indicator').textContent(), /오프라인/);
      await p.goto(base + 'index.html'); assert.equal(await p.locator('#html-only-update').count(), 1);
      console.log(`PASS v1 -> v3 from ${entry || 'root'}: upgrade, root/index HTML refresh, offline shell (no cached market price), unrelated cache preserved`);
      await c.close();
    }
    old = false; htmlRevision = false;
    if (process.env.LIVE_NETWORK === '1' && process.env.SW_ONLY !== '1') {
      const c = await browser.newContext({ viewport: { width: 1024, height: 768 } });
      const p = await c.newPage(); const socketErrors = [];
      p.on('console', msg => { if (msg.type() === 'error') socketErrors.push(msg.text()); });
      await p.goto(base);
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

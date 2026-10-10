const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
module.exports = async function (browser, base, root, network, setUpdate) {
  const live = page => page.waitForFunction(() => document.getElementById('status-indicator').className === 'connected');
  async function open(page) {
    if (await page.locator('#admin-panel').isVisible()) return;
    if (!await page.locator('#settings-toggle').isVisible()) await page.keyboard.press('Tab');
    await page.locator('#settings-toggle').click();
    assert.equal(await page.locator('#admin-panel').isVisible(), true);
  }
  fs.mkdirSync(path.join(root, '../evidence'), { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await network(context);
  const page = await context.newPage(); const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('request', req => requests.push(req.url()));
  await page.clock.install(); await page.goto(base); await live(page);
  assert.match(await page.locator('#price-main').textContent(), /98,000,000/);
  assert.equal(await page.locator('#change-label').textContent(), '전일 대비');
  assert.equal(await page.evaluate(() => sockets.length), 1);
  assert.equal(await page.evaluate(() => localStorage.getItem('btc-last-exchange-rate')), null);
  assert.equal(await page.locator('#top-controls').count(), 0);
  assert.equal(await page.locator('#settings-toggle').isVisible(), false);
  assert.equal(await page.locator('#admin-panel').isVisible(), false);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-toggle');
  await page.clock.fastForward(6000);
  assert.equal(await page.locator('#settings-toggle').isVisible(), true);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'admin-close');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'admin-save');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'admin-close');
  await page.waitForFunction(() => document.getElementById('app-version').textContent === '버전 v7 · 캐시 v7');
  await page.waitForFunction(() => document.getElementById('wake-lock-status').textContent.includes('활성'));
  await page.evaluate(() => testSentinel.release());
  await page.getByRole('button', { name: '화면 켜짐 유지 다시 시도' }).click();
  await page.waitForFunction(() => wakeRequests === 2 && document.getElementById('wake-lock-status').textContent.includes('활성'));
  await page.evaluate(() => { suppressTicks = true; window.lateMessage = sockets.at(-1).onmessage; window.lateClose = sockets.at(-1).onclose; });
  await page.getByRole('button', { name: 'USDT · 바이낸스', exact: true }).click();
  assert.equal(await page.locator('#price-main').textContent(), '—');
  await page.evaluate(() => {
    lateMessage({ data: JSON.stringify({ type: 'ticker', code: 'KRW-BTC', trade_price: 1, signed_change_rate: 0, timestamp: Date.now() }) });
    lateClose(); suppressTicks = false; sockets.at(-1).emit();
  });
  await live(page); assert.equal(await page.locator('#price-main').textContent(), '70,000.10 USDT');
  assert.equal(await page.locator('#change-label').textContent(), '24h');
  for (let i = 0; i < 10; i++) {
    await page.locator('[data-currency="KRW"]').click(); await page.locator('[data-currency="USDT"]').click();
  }
  await page.clock.fastForward(11000); await live(page);
  assert.equal(await page.evaluate(() => sockets.filter(s => s.readyState !== 3).length), 1);
  await page.clock.fastForward(6000);
  assert.equal(await page.locator('#admin-panel').isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-toggle');
  assert.equal(await page.locator('#settings-toggle').getAttribute('aria-expanded'), 'false');
  await page.locator('#price-main').tap(); await page.clock.fastForward(6000);
  assert.equal(await page.locator('#settings-toggle').isVisible(), false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(root, '../evidence/v7-mobile-clean.png') });
  const point = await page.locator('#settings-toggle').evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.touchscreen.tap(point.x, point.y);
  assert.equal(await page.locator('#admin-panel').isVisible(), false);
  assert.equal(await page.locator('#settings-toggle').isVisible(), true);
  const visible = await page.locator('button').evaluateAll(buttons => buttons.filter(el => getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length).map(el => el.id));
  assert.deepEqual(visible, ['settings-toggle']);
  await page.screenshot({ path: path.join(root, '../evidence/v7-mobile-toggle.png') });
  await page.locator('#settings-toggle').tap();
  assert.equal(await page.locator('#settings-toggle').isVisible(), false);
  for (let i = 0; i < 5; i++) await page.locator('[data-currency="USDT"]').tap();
  assert.equal(await page.evaluate(() => sockets.filter(s => s.readyState !== 3).length), 1);
  await page.screenshot({ path: path.join(root, '../evidence/v7-mobile-settings.png') });
  await page.locator('#admin-close').tap();
  await page.clock.fastForward(6000);
  assert.equal(await page.locator('#settings-toggle').isVisible(), true);
  await page.locator('#price-main').tap(); await page.clock.fastForward(6000);
  assert.equal(await page.locator('#settings-toggle').isVisible(), false);
  await page.reload(); await page.clock.fastForward(3000); await live(page);
  assert.equal(await page.locator('#price-source').textContent(), '바이낸스 · BTC/USDT');
  assert.equal(await page.locator('#settings-toggle').isVisible(), false);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  assert.equal(await page.evaluate(() => sockets.filter(s => s.readyState !== 3).length), 0);
  await page.evaluate(() => { suppressTicks = true; window.dispatchEvent(new Event('pageshow')); });
  await page.clock.fastForward(3000);
  assert.notEqual(await page.locator('#status-indicator').getAttribute('class'), 'connected');
  await page.evaluate(() => { suppressTicks = false; sockets.at(-1).emit(); }); await live(page);
  await page.evaluate(() => { suppressTicks = true; }); await page.clock.fastForward(16000);
  assert.match(await page.locator('#status-indicator').textContent(), /시세 업데이트 지연/);
  assert.match(await page.locator('#overlay-title').textContent(), /시세 지연.*마지막 가격/);
  assert.equal(await page.locator('#overlay-title').isVisible(), true);
  assert.equal(await page.locator('#overlay-msg').isVisible(), false);
  assert.equal(await page.locator('#settings-toggle').isVisible(), false);
  assert.equal(await page.locator('#container').getAttribute('class'), 'price-unavailable');
  await page.screenshot({ path: path.join(root, '../evidence/v7-mobile-stale.png') });
  await page.evaluate(() => { suppressTicks = false; }); await page.clock.fastForward(3000); await live(page);
  assert.equal(await page.locator('#overlay-title').isVisible(), false);
  await open(page);
  await page.locator('#admin-symbol').fill('bad!'); await page.locator('#admin-save').click();
  assert.equal(await page.locator('#admin-panel').isVisible(), true);
  await page.evaluate(() => { suppressTicks = true; });
  await page.locator('#admin-symbol').fill('ETH'); await page.locator('#admin-save').click();
  assert.equal(await page.locator('#price-main').textContent(), '—');
  await page.evaluate(() => { suppressTicks = false; }); await page.clock.fastForward(3000); await live(page);
  assert.equal(await page.locator('#price-source').textContent(), '바이낸스 · ETH/USDT');
  await page.evaluate(() => sockets.at(-1).emit({ c: 'Infinity' }));
  assert.equal(await page.locator('#price-main').textContent(), '70,000.10 USDT');
  await page.evaluate(() => sockets.at(-1).onmessage({ data: JSON.stringify({ error: { name: 'INVALID_PARAM' } }) }));
  await open(page); await page.getByRole('button', { name: '시세 다시 연결' }).click();
  await page.clock.fastForward(3000); await live(page);
  assert.equal(requests.some(url => /frankfurter|currency-api|manana/.test(url)), false);
  assert.deepEqual(errors, []);
  setUpdate(true);
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
  await page.waitForFunction(() => !document.getElementById('app-update').hidden);
  await page.waitForFunction(() => document.getElementById('app-version').textContent === '버전 v7 · 캐시 v8');
  await page.getByRole('button', { name: '새 버전 적용', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('app-update').hidden);
  assert.equal(await page.locator('#settings-toggle').isVisible(), false);
  console.log('PASS v7 UI: bottom-only reveal, first-tap safety, repeated taps, keyboard focus/trap, close/Escape, idle hide, settings hold, prices/currency/late events/background/stale, wake retry, actual HTML/cache versions and update reload');
  await context.close(); setUpdate(false);

  const layoutContext = await browser.newContext({ hasTouch: true }); await network(layoutContext);
  const p = await layoutContext.newPage(); await p.clock.install(); await p.goto(base); await live(p);
  const records = [];
  for (const s of [
    { name: 'ipad-portrait', width: 768, height: 1024, top: 24, right: 0, bottom: 20, left: 0 },
    { name: 'ipad-landscape', width: 1024, height: 768, top: 24, right: 24, bottom: 20, left: 24 },
    { name: 'asymmetric', width: 1194, height: 834, top: 32, right: 16, bottom: 21, left: 44 },
    { name: 'ipad-portrait-zero', width: 768, height: 1024, top: 0, right: 0, bottom: 0, left: 0 },
    { name: 'ipad-landscape-zero', width: 1024, height: 768, top: 0, right: 0, bottom: 0, left: 0 },
    { name: 'desktop-zero', width: 1440, height: 900, top: 0, right: 0, bottom: 0, left: 0 },
    { name: 'phone', width: 390, height: 844, top: 44, right: 0, bottom: 34, left: 0 },
    { name: 'short-landscape', width: 1024, height: 360, top: 0, right: 24, bottom: 20, left: 24 },
  ]) {
    await p.setViewportSize({ width: s.width, height: s.height });
    await p.evaluate(s => {
      for (const side of ['top', 'right', 'bottom', 'left']) document.documentElement.style.setProperty('--safe-' + side, s[side] + 'px');
      document.getElementById('wake-lock-retry').hidden = false; document.getElementById('app-update').hidden = false;
    }, s);
    await p.locator('#price-main').tap();
    const toggle = await p.locator('#settings-toggle').boundingBox();
    assert.equal(toggle.width, 48); assert.equal(toggle.height, 48);
    assert.equal(toggle.y + toggle.height, s.height - s.bottom - 16);
    assert.equal(toggle.x + toggle.width, s.width - s.right - 16);
    await p.locator('#settings-toggle').tap();
    const dialog = await p.locator('#admin-panel').boundingBox();
    const inside = b => {
      assert.ok(b.x >= s.left + 15, s.name + ' left'); assert.ok(b.x + b.width <= s.width - s.right - 15, s.name + ' right');
      assert.ok(b.y >= Math.max(48, s.top + 16) - 1, s.name + ' top'); assert.ok(b.y + b.height <= s.height - s.bottom - 15, s.name + ' bottom');
    };
    inside(dialog);
    await p.locator('#app-version').scrollIntoViewIfNeeded();
    inside(await p.locator('#admin-close').boundingBox());
    await p.clock.fastForward(6000); assert.equal(await p.locator('#admin-panel').isVisible(), true);
    assert.equal(await p.locator('#settings-toggle').isVisible(), false);
    await p.locator('#admin-close').scrollIntoViewIfNeeded();
    if (s.name.startsWith('ipad-') && !s.name.endsWith('zero')) await p.screenshot({ path: path.join(root, `../evidence/v7-${s.name}-settings.png`) });
    await p.locator('#admin-close').tap();
    assert.equal(await p.evaluate(() => document.activeElement.id), 'settings-toggle');
    await p.locator('#price-main').tap(); await p.clock.fastForward(6000);
    assert.equal(await p.locator('#settings-toggle').isVisible(), false);
    records.push({ scenario: s, toggle, dialog });
  }
  fs.writeFileSync(path.join(root, '../evidence/v7-layouts.json'), JSON.stringify(records, null, 2));
  console.log('PASS v7 layout: 8 portrait/landscape/zero/asymmetric/short scenarios; bottom 48px target, no top controls, panel minimum 48px top clearance, sticky close visible after scrolling (Chrome inset simulation, not iPad OS)');
  await layoutContext.close();
};

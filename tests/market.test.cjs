const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMarketFeed } = require('../market-data.js');
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(extra = {}) {
  let time = 1800000000000, id = 0;
  const timers = new Map(), sockets = [], states = [], ticks = [];
  const clock = {
    now: () => time,
    setTimeout(cb, ms) { const key = ++id; timers.set(key, { cb, at: time + ms }); return key; },
    clearTimeout(key) { timers.delete(key); },
    setInterval(cb, ms) { const key = ++id; timers.set(key, { cb, at: time + ms, interval: ms }); return key; },
    clearInterval(key) { timers.delete(key); },
  };
  function advance(ms) {
    const end = time + ms;
    for (let count = 0; count < 10000; count++) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) { time = end; return; }
      const [key, timer] = next; time = timer.at;
      if (timer.interval) timer.at += timer.interval; else timers.delete(key);
      timer.cb();
    }
    throw new Error('Timer loop');
  }
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.sent = []; this.readyState = 0; this.createdAt = time; sockets.push(this); }
    open() { this.readyState = 1; this.onopen?.(); }
    send(text) { this.sent.push(text); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const feed = createMarketFeed({ WebSocket: Socket, clock, onState: state => states.push(state),
    onTick: tick => ticks.push(tick), random: () => 0, attemptStore: null, ...extra });
  function tick(currency = 'KRW', values = {}) {
    return currency === 'KRW' ? { type: 'ticker', code: 'KRW-BTC', trade_price: 98000000,
      signed_change_rate: -0.025, timestamp: time, ...values } :
      { e: '24hrTicker', s: 'BTCUSDT', c: '70000.10', P: '2.5', E: time, ...values };
  }
  async function message(data, connection = sockets.at(-1), binary = false) {
    let payload = JSON.stringify(data);
    if (binary) payload = new TextEncoder().encode(payload).buffer;
    await connection.onmessage?.({ data: payload }); await flush();
  }
  return { feed, clock, timers, sockets, states, ticks, advance, tick, message, now: () => time, state: () => states.at(-1) };
}
test('Upbit KRW-BTC subscription and binary ticker use actual KRW and signed daily change', async () => {
  const f = fixture(); f.feed.select('KRW', 'BTC'); f.sockets[0].open();
  assert.equal(f.sockets[0].url, 'wss://api.upbit.com/websocket/v1');
  assert.deepEqual(JSON.parse(f.sockets[0].sent[0])[1], { type: 'ticker', codes: ['KRW-BTC'] });
  assert.equal(f.state().kind, 'waiting'); await f.message(f.tick(), undefined, true);
  assert.equal(f.ticks[0].price, 98000000); assert.equal(f.ticks[0].change, -2.5);
  assert.equal(f.ticks[0].selection.changeLabel, '전일 대비'); assert.equal(f.state().kind, 'live');
});
test('Binance pushed ticker uses USDT and 24h change; no price requests or JSON ping', async () => {
  const f = fixture(); f.feed.select('USDT', 'BTC'); f.sockets[0].open();
  assert.equal(f.sockets[0].url, 'wss://stream.binance.com:443/ws/btcusdt@ticker');
  await f.message(f.tick('USDT')); assert.equal(f.ticks[0].price, 70000.1);
  assert.equal(f.ticks[0].selection.currency, 'USDT'); assert.equal(f.ticks[0].selection.changeLabel, '24h');
  assert.deepEqual(f.sockets[0].sent, []);
});
test('switch clears data and ignores delayed Blob decode and old socket events', async () => {
  const f = fixture(); f.feed.select('KRW', 'BTC'); const old = f.sockets[0]; old.open(); await f.message(f.tick());
  let resolve; const oldMessage = old.onmessage, oldClose = old.onclose, oldOpen = old.onopen;
  const delayed = oldMessage({ data: { text: () => new Promise(r => { resolve = r; }) } });
  f.feed.select('USDT', 'BTC'); f.sockets[1].open(); assert.equal(f.state().last, null); assert.equal(old.readyState, 3);
  resolve(JSON.stringify(f.tick())); await delayed; oldClose(); oldOpen();
  assert.equal(f.ticks.length, 1); assert.equal(f.sockets.length, 2);
  await f.message(f.tick('USDT')); assert.equal(f.ticks.at(-1).selection.currency, 'USDT');
});
test('rapid repeated switches obey source limits and connect only final selection', () => {
  const f = fixture(); f.feed.select('KRW', 'BTC'); f.feed.select('USDT', 'BTC');
  for (let n = 0; n < 100; n++) { f.feed.select('KRW', 'BTC'); f.feed.select('USDT', 'BTC'); }
  f.feed.select('KRW', 'BTC'); assert.equal(f.sockets.length, 2);
  f.advance(9999); assert.equal(f.sockets.length, 2); f.advance(1); assert.equal(f.sockets.length, 3);
  assert.equal(f.sockets[2].createdAt - f.sockets[0].createdAt, 10000);
  assert.equal(f.sockets.filter(s => s.readyState !== 3).length, 1);
});
test('network errors schedule one capped backoff; old close cannot duplicate it', () => {
  const f = fixture(); f.feed.select('USDT', 'BTC'); const oldError = f.sockets[0].onerror, oldClose = f.sockets[0].onclose;
  oldError(); oldClose(); assert.equal(f.timers.size, 1); f.advance(2000); assert.equal(f.sockets.length, 2);
  for (let n = 0; n < 10; n++) {
    f.sockets.at(-1).onerror();
    const delay = f.state().retryAt - f.now(); assert.ok(delay <= 30000); f.advance(delay);
  }
});
test('malformed, wrong-pair and nonfinite values do not prove freshness', async () => {
  const f = fixture(); f.feed.select('USDT', 'BTC'); f.sockets[0].open();
  for (const bad of [{ s: 'ETHUSDT' }, { c: 'Infinity' }, { c: '-1' }, { c: true }, { P: 'NaN' }, { P: null }, { P: '' }, { E: f.now() + 100000 }, { E: null }]) await f.message(f.tick('USDT', bad));
  await f.sockets[0].onmessage({ data: 'not-json' }); assert.equal(f.ticks.length, 0); assert.equal(f.state().kind, 'waiting');
  f.advance(15000); assert.equal(f.state().kind, 'backoff'); assert.match(f.state().reason, /시간 초과/);
});
test('stale exchange timestamp is displayed as old and never marked live', async () => {
  const f = fixture(); f.feed.select('KRW', 'BTC'); f.sockets[0].open();
  await f.message(f.tick('KRW', { timestamp: f.now() - 30000 }));
  assert.equal(f.ticks.length, 1); assert.equal(f.state().kind, 'backoff');
  assert.equal(f.states.some(s => s.kind === 'live'), false); assert.match(f.state().reason, /데이터/);
});
test('price watchdog reconnects even when heartbeat UP keeps arriving', async () => {
  const f = fixture(); f.feed.select('KRW', 'BTC'); f.sockets[0].open(); await f.message(f.tick());
  f.advance(14000); await f.message({ status: 'UP' }); f.advance(1000);
  assert.equal(f.state().kind, 'backoff'); assert.match(f.state().reason, /업데이트 지연/); assert.equal(f.state().last.price, 98000000);
});
test('out-of-order ticker cannot overwrite newer price', async () => {
  const f = fixture(); f.feed.select('USDT', 'BTC'); f.sockets[0].open(); await f.message(f.tick('USDT'));
  await f.message(f.tick('USDT', { E: f.now() - 1000, c: '1' })); assert.equal(f.ticks.length, 1);
});
test('background/offline cancel timers and resume waits for new data', async () => {
  const f = fixture(); f.feed.select('KRW', 'BTC'); f.sockets[0].open(); await f.message(f.tick());
  f.feed.setActive(false); assert.equal(f.timers.size, 0); assert.equal(f.state().kind, 'paused');
  f.advance(60000); assert.equal(f.sockets.length, 1);
  f.feed.setActive(true); f.feed.setActive(true); f.sockets[1].open(); assert.equal(f.state().kind, 'waiting');
  f.feed.setOnline(false); assert.equal(f.timers.size, 0); f.advance(60000); assert.equal(f.sockets.length, 2);
  f.feed.setOnline(true); f.sockets[2].open(); await f.message(f.tick()); assert.equal(f.state().kind, 'live');
  f.feed.dispose(); assert.equal(f.timers.size, 0); f.advance(60000); assert.equal(f.sockets.length, 3);
});
test('Upbit text PING after 30s, no repeated subscription', async () => {
  const f = fixture({ staleMs: 45000 }); f.feed.select('KRW', 'BTC'); f.sockets[0].open(); await f.message(f.tick());
  f.advance(30000); assert.equal(f.sockets[0].sent.length, 2); assert.equal(f.sockets[0].sent[1], 'PING');
});
test('parameter error stops retries; rate limit waits at least 30 seconds', async () => {
  const f = fixture(); f.feed.select('KRW', 'BTC'); f.sockets[0].open();
  await f.message({ error: { name: 'INVALID_PARAM' } }); assert.equal(f.state().kind, 'error');
  f.advance(60000); assert.equal(f.sockets.length, 1); assert.equal(f.timers.size, 0);
  f.feed.retry(); f.sockets[1].open(); await f.message({ error: { name: 'TOO_MANY_REQUEST' } });
  assert.equal(f.state().retryAt - f.now(), 30000);
});
test('Binance server shutdown reconnects; unchanged selection does not', async () => {
  const f = fixture(); f.feed.select('USDT', 'BTC'); f.sockets[0].open(); f.feed.select('USDT', 'BTC');
  assert.equal(f.sockets.length, 1); await f.message({ e: 'serverShutdown' }); f.advance(2000); assert.equal(f.sockets.length, 2);
});
test('constructor failure and reload cooldown do not loop', () => {
  const broken = fixture({ WebSocket: class { constructor() { throw new Error('Blocked'); } } });
  broken.feed.select('KRW', 'BTC'); assert.equal(broken.timers.size, 1); assert.equal(broken.state().kind, 'backoff');
  const f = fixture({ attemptStore: { getItem: () => '1800000000000', setItem() {} } });
  f.feed.select('KRW', 'BTC'); assert.equal(f.sockets.length, 0); f.advance(10000); assert.equal(f.sockets.length, 1);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../service-worker.js'), 'utf8');
const scope = 'https://example.test/btc-price-kiosk/';
function fixture(open, fetch) {
  const handlers = {}, writes = [];
  vm.runInNewContext(source, {
    self: { registration: { scope }, addEventListener: (name, cb) => { handlers[name] = cb; } },
    caches: { open }, fetch, URL, Request, Response, AbortController, setTimeout, clearTimeout,
    console: { warn() {} },
  });
  function request(url, method = 'GET') {
    let result;
    handlers.fetch({ request: new Request(url, { method }), respondWith(promise) { result = promise; },
      waitUntil(promise) { writes.push(promise); } });
    return result;
  }
  return { request, writes, handlers };
}
test('successful network response is delivered even while opening cache is unresolved', async () => {
  let resolve;
  const f = fixture(() => new Promise(r => { resolve = r; }), async () => new Response('fresh HTML'));
  const response = await Promise.race([f.request(scope), new Promise((_, reject) => setImmediate(() => reject(new Error('Cache blocked network'))))]);
  assert.equal(await response.text(), 'fresh HTML');
  resolve({ put: async () => {} }); await Promise.all(f.writes);
});
test('cache-open failure does not discard a successful HTTP response', async () => {
  const f = fixture(async () => { throw new Error('Storage disabled'); }, async () => new Response('fresh HTML'));
  assert.equal(await (await f.request(scope + 'index.html')).text(), 'fresh HTML'); await Promise.all(f.writes);
});
test('offline root/index use the same cached HTML; external APIs and other apps are untouched', async () => {
  const keys = [];
  const f = fixture(async () => ({ match: async key => { keys.push(key); return new Response('offline shell'); } }),
    async () => { throw new Error('offline'); });
  for (const url of [scope, scope + 'index.html?standalone=1']) assert.equal(await (await f.request(url)).text(), 'offline shell');
  assert.deepEqual(keys, [scope + 'index.html', scope + 'index.html']);
  assert.equal(f.request('https://api.upbit.com/v1/ticker'), undefined);
  assert.equal(f.request('https://example.test/another-app/index.html'), undefined);
  assert.equal(f.request(scope + 'index.html', 'POST'), undefined);
});
test('SW version probe identifies the actual controlling build', () => {
  const f = fixture(() => {}, () => {}); let answer;
  f.handlers.message({ data: { type: 'GET_APP_VERSION' }, ports: [{ postMessage(value) { answer = value; } }] });
  assert.equal(answer.type, 'APP_VERSION'); assert.equal(answer.cacheName, 'btc-price-kiosk:/btc-price-kiosk/:v7');
  f.handlers.message({ data: { type: 'unrelated' }, ports: [] });
});

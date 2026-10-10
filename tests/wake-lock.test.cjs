const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../wake-lock.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(request, supported = true, visible = true) {
  const events = {}, windowEvents = {}, clicks = {};
  const status = {}, retry = {};
  retry.addEventListener = (name, cb) => { clicks[name] = cb; };
  const document = {
    visibilityState: visible ? 'visible' : 'hidden',
    getElementById: id => id === 'wake-lock-status' ? status : retry,
    addEventListener: (name, cb) => { events[name] = cb; },
  };
  vm.runInNewContext(source, {
    document, navigator: supported ? { wakeLock: { request } } : {},
    window: { isSecureContext: true, addEventListener: (name, cb) => { windowEvents[name] = cb; } },
    console: { warn() {} },
  });
  return { status, retry, click: () => clicks.click(), page: name => windowEvents[name](),
    visibility(state) { document.visibilityState = state; events.visibilitychange(); } };
}
function lock() {
  let handler;
  return { released: false, releases: 0,
    addEventListener(name, cb) { handler = cb; },
    async release() { this.releases++; this.released = true; if (handler) handler(); },
  };
}
test('initial lock, system release, explicit retry; no automatic release loop', async () => {
  let calls = 0; const locks = [];
  const f = fixture(async () => { calls++; const l = lock(); locks.push(l); return l; });
  await flush(); assert.match(f.status.textContent, /활성/);
  await locks[0].release(); await flush();
  assert.equal(calls, 1); assert.equal(f.retry.hidden, false);
  await f.click(); assert.equal(calls, 2);
  await f.click(); assert.equal(calls, 2);
});
test('initial denial and synchronous failure permit explicit retry only', async () => {
  for (const synchronous of [false, true]) {
    let calls = 0;
    const f = fixture(() => {
      calls++; const error = Object.assign(new Error('Denied'), { name: 'NotAllowedError' });
      if (synchronous) throw error;
      return Promise.reject(error);
    });
    await flush(); assert.match(f.status.textContent, /NotAllowedError/);
    await flush(); assert.equal(calls, 1);
    await f.click(); assert.equal(calls, 2);
  }
});
test('pending acquisition deduplicates clicks and disposes stale hide/show lock', async () => {
  let resolve, calls = 0; const fresh = lock(), stale = lock();
  const f = fixture(() => { calls++; return calls === 1 ? new Promise(r => { resolve = r; }) : Promise.resolve(fresh); });
  await flush(); f.click(); f.click(); assert.equal(calls, 1);
  f.visibility('hidden'); f.visibility('visible');
  resolve(stale); await flush();
  assert.equal(stale.releases, 1); assert.equal(calls, 2); assert.match(f.status.textContent, /활성/);
  f.visibility('hidden'); await flush(); assert.equal(fresh.releases, 1);
});
test('hidden launch, pageshow restoration and duplicate lifecycle events', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return lock(); }, true, false);
  await flush(); assert.equal(calls, 0);
  f.visibility('visible'); f.page('pageshow'); await flush(); assert.equal(calls, 1);
  f.page('pagehide'); f.visibility('hidden'); f.visibility('visible'); f.page('pageshow');
  await flush(); assert.equal(calls, 2);
});
test('unsupported API and already released sentinel show truthful status', async () => {
  const unsupported = fixture(null, false); await flush();
  assert.match(unsupported.status.textContent, /미지원/); assert.equal(unsupported.retry.hidden, true);
  const released = lock(); released.released = true;
  const f = fixture(async () => released); await flush();
  assert.match(f.status.textContent, /해제됨/); assert.equal(f.retry.hidden, false);
});
test('release rejection is handled during suspension', async () => {
  const l = lock(); l.release = () => Promise.reject(new Error('release denied'));
  const f = fixture(async () => l); await flush(); f.visibility('hidden'); await flush();
  assert.match(f.status.textContent, /대기/);
});

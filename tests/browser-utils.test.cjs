const { test } = require('node:test');
const assert = require('node:assert/strict');
const { waitForAsyncState } = require('./browser-utils.cjs');
test('async state poll awaits false results and continues until true', async () => {
  let evaluations = 0;
  const page = { async evaluate() { await Promise.resolve(); return ++evaluations === 3; } };
  await waitForAsyncState(page, () => {}, { pollMs: 1 });
  assert.equal(evaluations, 3);
});
test('async predicate errors are reported instead of passing on a truthy Promise', async () => {
  const page = { async evaluate() { throw new Error('state query failed'); } };
  await assert.rejects(waitForAsyncState(page, () => {}), /state query failed/);
});

// waitForFunction tests the predicate's immediate truthiness. An async
// predicate returns a truthy Promise even when it later resolves to false.
// Evaluate and await each result in Node before deciding whether to continue.
async function waitForAsyncState(page, predicate, options = {}) {
  const timeout = options.timeout || 30000;
  const deadline = Date.now() + timeout;
  const pollMs = options.pollMs || 100;
  while (Date.now() < deadline) {
    let timer;
    try {
      const result = await Promise.race([
        page.evaluate(predicate, options.arg),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Async state evaluation timed out')), Math.max(1, deadline - Date.now())); }),
      ]);
      if (result) return;
    } finally { clearTimeout(timer); }
    await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
  }
  throw new Error('Async state did not become true within ' + timeout + 'ms');
}
module.exports = { waitForAsyncState };

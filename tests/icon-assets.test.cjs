const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
test('home icon preserves the original white Bitcoin path on a full square orange background', () => {
  const old = fs.readFileSync(path.join(root, 'bitcoin-btc-logo.svg'), 'utf8');
  const icon = fs.readFileSync(path.join(root, 'icons/home-icon.svg'), 'utf8');
  assert.ok(icon.includes(old.match(/<path fill="white"[^>]*\/>/)[0]));
  assert.match(icon, /<rect width="4091.73" height="4091.73" fill="#F7931A"\/>/);
  assert.equal((icon.match(/<path/g) || []).length, 1);
});
test('Apple links and manifest describe existing correctly sized PNGs', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const assets = [152, 167, 180].map(size => ({ size, src: `./icons/apple-touch-icon-${size}.png` }));
  for (const { size, src } of assets) assert.ok(html.includes(`rel="apple-touch-icon" sizes="${size}x${size}" href="${src}"`));
  for (const entry of manifest.icons) {
    assert.equal(entry.type, 'image/png'); assert.equal(entry.purpose, 'any maskable');
    const [width, height] = entry.sizes.split('x').map(Number); assert.equal(width, height);
    assets.push({ size: width, src: entry.src });
  }
  for (const { size, src } of assets) {
    const png = fs.readFileSync(path.join(root, src));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
  }
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512']);
  assert.equal(manifest.background_color, '#000000'); assert.equal(manifest.theme_color, '#000000');
});
